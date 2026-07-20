# BloodChain POC: implementation walkthrough

This is a working Node.js project implementing the vein-to-vein custody tracking system described in the BloodChain design doc: an HTS NFT per blood unit, an HCS event log for every custody step, and a Solidity contract on Hedera Smart Contract Service that blocks release of untested or failed units. It follows the proof-of-concept scope exactly: mint, log, test-gate a transfer, close, and batch-flag.

On top of that base sits an **oversight layer** (see `OVERSIGHT.md` for the full design): stale-unit fraud detection, bonds and slashing for guilty organizations, nurse/staff traceability, and a weighted DAO election that chooses which organization holds oversight authority.

Everything below is written in the order you should build and understand it, matching the 14 pieces from the design doc. Each section says what the piece does, why it exists, and points at the actual file.

## Before you start

You need Node.js 18+ (for native `fetch`) and a funded Hedera testnet account. If you don't have one yet: go to the Hedera Developer Portal, create a testnet account, and you'll get an account ID (`0.0.xxxxx`) and a DER-encoded private key. Fund it from the built-in testnet faucet.

```
npm install
cp .env.example .env
# fill in OPERATOR_ID and OPERATOR_KEY in .env
```

You'll also want three more testnet accounts to stand in for the lab, hospital, and transport company (create them the same way, or reuse test accounts). Put their IDs/keys in `.env` too.

---

## 1-3. Setup and infrastructure

### 1. Client connection & config — `src/hederaConfig.js`

Every other file imports `client` from here and nowhere else builds its own `Client` or reads `process.env` directly. That's a deliberate constraint: if credential handling is scattered across files, a rewrite later (say, swapping testnet for mainnet, or moving keys into a secrets manager) turns into a search-and-replace across the whole codebase instead of a one-file change.

The file does three things: reads `OPERATOR_ID`/`OPERATOR_KEY` from `.env`, builds a `Client` pointed at testnet or mainnet, and calls `client.setOperator(...)` so every transaction you build later automatically knows who's paying the fee and signing as the default party.

### 2. Token creation — `scripts/01-createToken.js`

Run once, ever (per environment): `node scripts/01-createToken.js`

This is a `TokenCreateTransaction` that defines the blood-unit NFT *class* — not an individual unit, the type itself, the way you'd define a database table before inserting rows. Three settings matter:

- `setTreasuryAccountId(operatorId)` — new units get minted into the blood bank's account.
- `setSupplyKey(operatorKey)` — only whoever holds this key can mint or burn units. This is "who's allowed to create/destroy blood-unit tokens" encoded as a rule the network itself enforces, not a policy someone could quietly ignore.
- `setWipeKey(operatorKey)` — a separate key that can forcibly pull one specific unit out of circulation (used later by `closeUnit`).

It prints a `TOKEN_ID` — paste it into `.env`.

### 3. Party registration — `src/registerParty.js` + `scripts/registerAllParties.js`

Hedera requires an account to explicitly *associate* with a token before it can hold it — a network-level anti-spam rule, not something specific to this project. Skip this step and `transferCustody()` will fail later with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`, which is not an obvious error if you don't know this rule exists.

`registerParty(accountId, privateKey, tokenId)` runs a `TokenAssociateTransaction` signed by the *party's own key* (the treasury can't associate on someone else's behalf). `registerAllParties.js` just loops this over the lab, hospital, and transport accounts. Run it once, after token creation, before the demo:

```
node scripts/01-createToken.js      # -> paste TOKEN_ID into .env
node scripts/02-createTopic.js      # -> paste TOPIC_ID into .env
node scripts/compileContract.js
node scripts/03-deployContract.js   # -> paste CONTRACT_ID into .env
node scripts/registerAllParties.js
```

---

## 4-9. The five core functions (plus the log helper they all share)

### 4. `mintUnit()` — `src/mintUnit.js`

Step one of a unit's life: a barcode scan at collection becomes a `TokenMintTransaction`. The serial number Hedera hands back is the unit's permanent ID for everything downstream.

One real constraint worth knowing before you hit it as a bug: HTS caps NFT metadata at **100 bytes**. That's not enough for a full donation record, so this function only embeds `donorBatchId` and `collectionCenterId` — the two fields needed to trace a unit back to its batch. Everything else (timestamps, test results, handling notes) lives in HCS instead, which has no such limit. This is why the architecture has *two* Hedera services doing different jobs rather than stuffing everything into token metadata.

### 5. `logEvent()` — `src/logEvent.js`

The shared HCS helper. Every other event-producing function (`mintUnit`, `submitTestResult`, `transferCustody`, `closeUnit`, `flagBatch`) calls this instead of building its own `TopicMessageSubmitTransaction`. One choke point keeps the message shape consistent across the whole log.

The tamper-proof property doesn't come from the JSON payload — it comes from HCS: the network orders and timestamps every message via consensus, and once a message lands, nobody (including the blood bank) can quietly edit or reorder it. The mirror node (piece 10) is what makes that ordered history queryable after the fact.

### 6. `submitTestResult()` — `src/submitTestResult.js`

Records a lab's pass/fail result in two places at once: on the `BloodUnitGate` contract (piece 7, so the transfer gate can actually enforce it) and on HCS via `logEvent()` (so it's part of the permanent audit trail). It also updates the local index so a status check doesn't need a live chain read.

Worth noting honestly: this POC calls the contract using the *operator* account, which the contract already trusts as an authorized lab by default. A real deployment would have each lab sign with its own key, added via `authorizeLab()` — the contract already has that method, it's just not exercised by this demo to keep the two-week scope manageable.

### 7. `transferCustody()` + smart contract — `src/transferCustody.js` + `contracts/BloodUnitGate.sol`

This is the enforcement point, and it's worth reading closely because it's the part that makes the difference between "we recorded that a test happened" and "the system will not physically let an untested unit move."

`BloodUnitGate.sol` is deployed once (compiled with `scripts/compileContract.js`, deployed with `scripts/03-deployContract.js`). It holds a mapping from serial number to test status, plus one function that matters most: `requireClearance(serial)`, which **reverts** unless that serial's status is `Passed`.

`transferCustody()` calls `requireClearance()` first. If that call reverts, the SDK's `getReceipt()` throws — caught, logged as `TRANSFER_BLOCKED` on HCS, and the function returns `{ blocked: true }` without ever touching the token. Only if clearance succeeds does it build the actual `TransferTransaction`. The JS code never decides pass/fail itself; it only relays the contract's verdict. That distinction is the whole point of using a smart contract instead of an `if` statement in JavaScript — an `if` statement can be edited or skipped by whoever controls the server; a deployed contract's logic can't be quietly changed by one party after the fact.

### 8. `closeUnit()` — `src/closeUnit.js`

Burns the NFT via `TokenWipeTransaction`, signed with the wipe key from step 2 — not the current holder's key, which is exactly the point of a wipe key: the platform, not whoever's physically holding the unit, has the authority to retire it. This keeps the "still active" token set matching blood that's actually still in circulation, so "does this token still exist" doubles as "is this unit still out there."

### 9. `flagBatch()` — `src/flagBatch.js`

The recall mechanism. Given one flagged unit, it looks up every other unit sharing that `donorBatchId` in the local index, quarantines all of them, and logs a `BATCH_ALERT` event to HCS for each sibling — the same pattern as a physical product recall pulling every unit from an affected production run, except instant instead of taking days.

---

## 10-14. Supporting pieces

### 10. Mirror node query layer — `src/mirrorNode.js`

The SDK can submit transactions and read the receipt of a transaction you just submitted, but it can't page back through history — "give me every message ever posted to this topic" isn't something a consensus node answers. That's what mirror nodes are for: they replay the ledger and expose it over a plain REST API. This file is the only place in the project that talks to `https://testnet.mirrornode.hedera.com`. You'd reach for this to rebuild the local index from scratch, or to prove to an outside auditor that the local index matches what's actually on-chain.

### 11. Lightweight off-chain index — `src/localIndex.js`

A JSON file (`data/index.json`) mirroring on-chain events as they happen, so status checks and batch lookups are instant local reads instead of a live mirror-node call every time. Hedera stays the source of truth; this is a cache, and it's built so every other file only calls its exported functions (`upsertUnit`, `getUnit`, `getUnitsByBatch`) rather than touching the JSON directly — swapping this for SQLite later means editing one file, not every file that reads unit status.

### 12. Demo/orchestration — `demo.js`

Runs the exact sequence from the design doc: mint unit A → pass its test → transfer it → mint sibling unit B from the same batch → fail B's test → attempt to transfer B anyway (blocked) → flag B → confirm `flagBatch` catches A even though A already left the building. Run with `node demo.js` once all four setup scripts have been run and `.env` is filled in.

### 13. The deliberately-failing test case

This is built into `demo.js` itself (unit B) rather than a separate script — steps 4-6 exist specifically to prove the contract's block actually triggers, not just to test the happy path. If you comment out `submitTestResult` for unit B, `demo.js` should print `Blocked as expected: false` and fail loudly, which is the point: a demo that only shows things working doesn't prove the gate works.

### 14. Basic unit tests — `test/bloodchain.test.js`

Three tests using Node's built-in `node:test`, matching the design doc's list: mint succeeds, transfer is blocked on a failed test, and `flagBatch` finds siblings correctly. These run against real testnet (there's no free local Hedera simulator, unlike Hardhat for Ethereum), so they're closer to integration tests — they'll skip with a clear message if `.env` isn't fully configured. Run with `npm test`.

---

## 15-19. The oversight layer (anti-fraud, punishment, DAO governance)

Full design rationale, threat model, and honest limitations live in `OVERSIGHT.md`. The short version of what each new piece does:

### 15. Stale-unit monitor — `src/checkStaleUnits.js`

The chain cannot see a hospital secretly trading a unit away. What it can see is the absence of the event that should exist: every legitimate unit ends with `TRANSFUSED` or `DISPOSED`. `transferCustody()` now stamps `heldSince` on every custody change, and this monitor flags any unit held past `STALE_THRESHOLD_DAYS` (default 10) with no closing event, logging a permanent `STALE_ALERT` to HCS.

### 16. Bonds, investigations, and slashing — `contracts/BloodOversight.sol` + `src/oversight.js`

Every organization registers by posting a 10 HBAR bond from its own account. A stale alert (or anything else) can open an on-chain investigation; the elected authority delivers the verdict, and a guilty finding slashes the bond (capped at 20% of what remains per case) and increments a public scandal counter. Suspension only follows a sustained pattern: 5 guilty verdicts or a bond below a quarter of the minimum. A suspended org can be rehabilitated: restore the bond via `topUpBond()`, then the authority calls `reinstateOrg()`, which also forgives one scandal. Deploy with `node scripts/compileContract.js BloodOversight` then `node scripts/04-deployOversight.js`.

### 17. Staff traceability — `submitTestResult()` + the staff registry

Every test result now records the `staffId` of the nurse or technician who ran it, in HCS and the local index. On-chain, staff are registered as SHA-256 hashes only (no personal data on the ledger). When a unit is implicated, one lookup answers who tested it, and the authority can suspend that staff hash permanently.

### 18. Weighted DAO election

All registered orgs elect the oversight authority. Vote weight is computed on-chain at voting time: base 10, plus 2 per month of tenure, plus reviewScore/10, minus 5 per scandal. A hospital with a fresh fraud finding votes with a visibly smaller voice. Note the handover is real: once a new org wins, the old authority genuinely loses its powers, which is why `demo-oversight.js` asks the contract who currently holds authority before making authority-only calls.

### 19. Oversight demo — `demo-oversight.js`

Plays the full fraud story: registration with real bonds, a nurse-tagged test, transfer to the hospital, silence past the (compressed) holding window, stale alert, investigation, 5 HBAR slash, staff suspension, then the election. Requires `OVERSIGHT_CONTRACT_ID` in `.env`.

---

## Running the whole thing

```
npm install
cp .env.example .env        # fill in OPERATOR_ID, OPERATOR_KEY, and the 3 party accounts
node scripts/01-createToken.js      # -> TOKEN_ID
node scripts/02-createTopic.js      # -> TOPIC_ID
node scripts/compileContract.js
node scripts/03-deployContract.js   # -> CONTRACT_ID
node scripts/registerAllParties.js
node demo.js
npm test

# oversight layer
node scripts/compileContract.js BloodOversight
node scripts/04-deployOversight.js  # -> OVERSIGHT_CONTRACT_ID
node demo-oversight-elect-first.js
```

## Known gaps (worth naming, not hiding)

This matches the design doc's own honesty section: the system proves a record wasn't changed *after* it was written, not that it was correct when written. A lab can still submit a wrong pass/fail through `submitTestResult()` and the contract will faithfully store and enforce that wrong result.

The oversight layer narrows, but does not close, the diversion gap: the stale-unit monitor catches a hospital that lets a unit go unaccounted for, and bond slashing makes getting caught expensive, but a hospital that fakes a `TRANSFUSED` event and diverts the unit anyway can only be caught by off-chain reconciliation against patient records. Review scores for vote weighting are off-chain facts written on-chain by the authority acting as an oracle, which shifts trust rather than removing it. See `OVERSIGHT.md` for the full list.
