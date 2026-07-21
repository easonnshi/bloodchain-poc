# BloodChain: the complete technical and theoretical explainer

This is the definitive A-to-Z reference for the BloodChain project — the
system, the platform it runs on, every layer of the code, the fraud/oversight
design, and the limitations we accept and name. It assumes general computer
science knowledge but **zero prior blockchain knowledge**: every term is
explained the first time it appears, and again in the glossary at the end.

For hands-on setup instructions, see `TEAM_RUNBOOK.md`. For the audit trail
of what was reviewed and fixed, see `AUDIT_NOTES.md`. For the course's
required discussion answers, see `COURSE_ANSWERS.md`.

---

## 1. The problem: vein-to-vein blood custody

"Vein-to-vein" is the industry term for the full journey of donated blood:
from the donor's vein (collection), through testing, storage, and transport,
into a patient's vein (transfusion) — or, if anything goes wrong, into
documented disposal. Tracking custody along that journey means being able to
answer, for any single unit of blood, at any time: *where is it, who has
touched it, what was done to it, and is it safe to use?*

### Why this is hard today

The journey crosses **organizational boundaries**. A typical unit passes
through a collection center, an independent testing laboratory, a logistics
company, and a hospital — four organizations with four separate record
systems, different software, different incentives, and no shared owner.
The specific failure modes this project targets:

1. **Untested or failed units moving anyway.** The rule "no unit may be
   released without a passing infectious-disease panel" is usually enforced
   by *policy* — a checkbox in one organization's software, a step in a
   standard operating procedure. Policy can be skipped, by mistake or on
   purpose, and the other organizations in the chain have no way to see
   that it was skipped.
2. **Slow, manual batch recalls.** One donation is often separated into
   several products (red cells, plasma, platelets) — sibling units sharing
   one donor. If one unit turns out to be contaminated, *every* sibling
   must be found and quarantined, including ones already shipped elsewhere.
   Today that means phone calls and record cross-checks across
   organizations, taking hours to days. Patients can be transfused in the
   gap.
3. **Diversion.** Blood has black-market value in some health systems. A
   hospital employee who takes a unit "off the books" leaves at most a
   discrepancy between two internal records — records the same
   organization controls and can quietly amend.
4. **After-the-fact record tampering.** When something goes wrong and an
   investigation starts, each party's records are self-serving evidence.
   There is no neutral log everyone already agreed to while events were
   happening.

### Why a distributed ledger, specifically

A **distributed ledger** (the family that includes blockchains) is a
record-keeping system replicated across many computers, where entries are
added by a consensus process and, once added, cannot be edited or deleted by
anyone — including the operators. That is precisely the artifact this
problem needs and no participant can provide alone:

- The failure modes above are all variations of *one party controlling the
  record*. A shared database fixes fragmentation but not control — someone
  must own and administer the database, and that someone can edit it. A
  public ledger has no such owner.
- The core safety rule ("no passing test → no movement") is **binary and
  mechanically checkable**, which makes it enforceable by a *smart
  contract* (a program on the ledger that all parties can inspect and no
  single party can alter or bypass — explained fully in §2). This upgrades
  the rule from "logged" to "physically enforced": the token that
  represents the unit *cannot move* until the rule is satisfied.
- The stakes justify the overhead. Per-unit tracking with cryptographic
  provenance would be absurd for office supplies. For a substance
  transfused into human beings, where one bad donation can reach several
  patients, it is proportionate.

This is the honest version of the argument: not "blockchain makes it
trustworthy" (it doesn't, and §6 details what it cannot do), but "the
specific properties a public ledger has — no single owner, append-only
history, mechanically enforced rules — map one-to-one onto the specific
failure modes of this domain."

---

## 2. Hedera fundamentals, from scratch

BloodChain runs on **Hedera**, a public distributed ledger. This section
explains everything about the platform the project relies on.

### 2.1 What a hashgraph is, and how it differs from a blockchain

A **blockchain** (Bitcoin, Ethereum) orders transactions by grouping them
into *blocks*, each cryptographically linked to the previous one, forming a
chain. Some mechanism (mining, staking) selects who produces the next
block.

A **hashgraph** achieves the same goal — a network of computers agreeing on
one order of events without trusting each other — through a different
structure. Hedera's nodes constantly share what they know with randomly
chosen other nodes ("**gossip**"), and crucially they also share *the
history of who told what to whom* ("gossip about gossip"). Because every
node eventually holds this full communication graph, each node can
*calculate* how every other node would vote on transaction order, without
actually sending votes. This is called **virtual voting**. The result:

- **No blocks, no miners, no leader.** Transactions are ordered
  individually and continuously.
- **Fast finality.** A transaction reaches consensus in a few seconds, and
  once final it is final — there is no "wait for 6 confirmations" as in
  Bitcoin, because there are no competing forks to resolve.
- **Fair ordering with consensus timestamps.** Every transaction gets a
  **consensus timestamp** — the median of the times at which nodes
  received it, with nanosecond resolution. This timestamp is *agreed by
  the network*, not claimed by the submitter, which is why this project
  leans on it so heavily: two custody events have a definite, agreed
  order.
- **aBFT security.** The consensus algorithm is *asynchronous Byzantine
  fault tolerant* — mathematically proven to reach correct agreement even
  if up to one-third of nodes are malicious and the network is unreliable.
- **Fixed, tiny fees.** Fees are denominated in USD and paid in HBAR
  (Hedera's currency; 1 HBAR = 100,000,000 **tinybars**). An HCS message
  costs a fraction of a cent — cheap enough to log *every* custody event.

Hedera's consensus nodes are run by a governing council of large
organizations rather than by anonymous miners. That is a trust trade-off
worth knowing about, but for this project the relevant properties —
append-only history, agreed ordering, public verifiability — hold.

### 2.2 Accounts and key pairs

To act on Hedera you need an **account**: an identifier like `0.0.9628733`
(the `0.0.` is shard/realm addressing; the last number is yours), holding
an HBAR balance to pay fees, and controlled by a **key pair** — a private
key you keep secret and use to *sign* transactions, and a public key the
network uses to verify your signatures. A transaction is only valid if
signed by the right private keys; this is how "only the lab can submit as
the lab" is enforced at the network level.

Hedera supports two signature algorithms:

- **ED25519** — Hedera's original default; fast and compact.
- **ECDSA (secp256k1)** — the algorithm Ethereum uses. An ECDSA account
  gets, for free, an **Ethereum-style address** (20 bytes, `0x…`) derived
  from its public key, called its **alias**.

This distinction matters here because smart contracts identify callers by
Ethereum-style address (`msg.sender`, see §2.5). An ECDSA account appears
in a contract as its proper alias address; an ED25519 account appears as a
synthetic "**long-zero**" address (its account number padded with zeros).
**This project's four team accounts use ECDSA keys** (you can see the
secp256k1 curve identifier inside the DER-encoded private keys, and the
alias-form addresses like `0x32d0bae9…` in the demo output) — the natural
choice for a contract-heavy design. The *code*, however, is deliberately
key-type agnostic: deriving the contract-visible address locally is
unreliable across the two types, so `src/mirrorNode.js#getEvmAddress()`
asks the network's own records instead, and works for either.

Keys in `.env` are stored **DER-encoded** — a standard binary format for
cryptographic keys, written as hex text.

### 2.3 HTS — Hedera Token Service

**HTS** lets you create tokens as *native network objects*: the token's
rules (who may mint, who may destroy, who holds what) are enforced by the
network itself, not by a contract you wrote. Concepts used by this project:

- A **token class** is defined once (`TokenCreateTransaction`) with a
  token ID like `0.0.9663839`. Ours is named "BloodChain Unit", symbol
  `BLOOD`.
- It is a **non-fungible token (NFT)** class. *Fungible* tokens are
  interchangeable like coins; *non-fungible* tokens are individually
  distinct — each minted instance gets a unique, network-assigned
  **serial number** (1, 2, 3, …). One NFT = one physical blood unit; the
  serial is the unit's identity everywhere in the system.
- The **treasury** is the account new tokens are minted into — here, the
  blood bank (operator) account.
- The **supply key** controls minting/burning: only transactions signed
  with it can create or destroy units. "Who may create a blood unit" is
  thus a network-enforced rule, not a policy.
- The **wipe key** can forcibly remove a specific serial from *any*
  account. `closeUnit()` uses it to burn (destroy) a unit at end of life
  — deliberately an authority of the platform, not of whoever happens to
  hold the unit.
- **Association**: a Hedera-specific anti-spam rule — an account must
  explicitly opt in (`TokenAssociateTransaction`, signed by *its own*
  key) before it can receive a given token. Forgetting this produces the
  infamous `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` error
  (`scripts/registerAllParties.js` handles it once at setup).
- NFT **metadata** (a small data field attached at mint) is capped at
  **100 bytes**. That is far too small for a medical record — which is
  why this architecture pairs HTS with HCS: the token carries only
  `donorBatchId` and `collectionCenterId` (enough to trace a unit to its
  donation), and everything else lives in the event log.

### 2.4 HCS — Hedera Consensus Service

**HCS** is a consensus-ordered message log. You create a **topic** (ID
like `0.0.9663848`), and anyone holding the topic's **submit key** can
publish small messages to it. The network assigns each message a
**sequence number** (1, 2, 3, … within the topic) and a consensus
timestamp. Messages are:

- **Append-only** — nothing can be edited or deleted, by anyone, ever.
- **Ordered** — the sequence is agreed by network consensus, so "the test
  result was recorded *before* the transfer" is a fact, not a claim.
- **Public** — anyone can read the full history (via mirror nodes, §2.6).

BloodChain writes one JSON message per custody event (`COLLECTED`,
`TEST_RESULT`, `CUSTODY_TRANSFER`, `TRANSFER_BLOCKED`, `TRANSFUSED`,
`DISPOSED`, `FLAGGED`, `BATCH_ALERT`, `POST_USE_ALERT`, `STALE_ALERT`,
plus oversight bookkeeping events). The topic *is* the audit trail; the
tamper-evidence comes from HCS itself, not from anything in the payload.

### 2.5 HSCS — Hedera Smart Contract Service, and the EVM

A **smart contract** is a program deployed onto the ledger. Its code is
public, its stored data is public, and — the key property — it executes
exactly as written on every node: no single party can alter its logic or
make it skip a check after deployment.

Hedera's contract service runs the **EVM** — the Ethereum Virtual Machine,
the de-facto standard runtime for contracts — so contracts are written in
**Solidity** (the standard contract language) and behave exactly as they
would on Ethereum. Terms you'll meet:

- `msg.sender` — the address of whoever called the contract function, as
  verified by their signature. All access control builds on this.
- `require(condition, "message")` — abort the call ("**revert**") unless
  the condition holds. A reverted call changes nothing and reports the
  message. Reverting is how a contract *refuses*.
- A **modifier** (e.g. `onlyOwner`) is a reusable guard attached to
  functions — shorthand for a `require` at the top.
- An **event** (`emit …`) is a log entry the contract writes for outside
  observers; it costs little and changes no state.
- **Gas** — a per-instruction execution fee that callers pay; each call
  sets a gas limit (our scripts use generous ones; unused gas is
  refunded).
- `payable` — marks a function that can receive money (HBAR) as part of
  the call; inside contracts on Hedera, amounts appear in tinybars.

BloodChain deploys two contracts (§3.3, §3.4): `BloodUnitGate` (the
release gate) and `BloodOversight` (bonds, investigations, elections).

### 2.6 Mirror nodes

Consensus nodes answer "process this transaction" but do not serve
history — "give me every message on this topic" is not a question they
answer. **Mirror nodes** fill that role: they replay everything the
network finalizes and expose it as a free, public REST API
(`https://testnet.mirrornode.hedera.com`). No account, no keys, no fees —
anyone can query them. **HashScan** (`hashscan.io`) is a public block
explorer built on mirror data — a website where any token, topic,
transaction, or account can be inspected by ID.

This is the load-bearing verifiability property: *reading* the system
requires no relationship with us at all. Our frontend's read paths go
straight from the browser to the mirror node, so a grader can confirm
every claim on infrastructure we don't control.

### 2.7 Testnet vs mainnet

**Mainnet** is the real network (real HBAR, real money). **Testnet** is a
functionally identical copy for development where HBAR is free from a
faucet. Everything in this project runs on testnet — the properties
demonstrated are identical, the cost is zero. One operational caveat:
testnet is periodically **reset** (wiped), so our deployed IDs have a
shelf life; redeploying takes about ten minutes (`TEAM_RUNBOOK.md`).

---

## 3. System architecture, layer by layer

The stack, top to bottom:

```
Browser (React frontend)
  ├── reads  ──────────────► public mirror node REST API (no keys, no server)
  └── writes ──► local API server (Express; holds keys) ──► src/ functions
                                                              ├── HTS  (BLOOD token 0.0.9663839)
                                                              ├── HCS  (topic 0.0.9663848)
                                                              ├── HSCS (BloodUnitGate 0.0.9663858,
                                                              │         BloodOversight 0.0.9663881)
                                                              └── data/index.json (disposable cache)
```

### 3.1 The token class

Created once by `scripts/01-createToken.js`: NFT class `BLOOD`, treasury =
operator (blood bank), supply key and wipe key = operator key. Minting one
NFT per physical unit gives every unit a permanent, network-assigned serial
and makes "who currently holds unit #5" a question the *network* answers,
not any participant's database. Because closing a unit burns its NFT,
"does this token still exist" doubles as "is this unit still in
circulation."

### 3.2 The HCS topic and message format

Created once by `scripts/02-createTopic.js`, with the operator key as
submit key (a known centralization trade-off, see §6.9). Every message is
JSON with at minimum `unitId` and `eventType`, plus event-specific fields
and a client-side `loggedAt` timestamp (informational only — the
*consensus* timestamp is the authoritative one). All messages flow through
one function, `src/logEvent.js`, so the format stays consistent.

### 3.3 `BloodUnitGate.sol` — the release gate, function by function

State: `owner` (the deployer), `authorizedLabs` (address → bool),
`testStatus` (unit serial → `Unknown | Passed | Failed`).

- **`constructor()`** — records the deployer as `owner` and bootstraps the
  deployer as an authorized lab so a fresh deployment is usable
  immediately. (Since the lab-signing work, nothing in the demo flow
  relies on that bootstrap — the real lab account is authorized
  explicitly.)
- **`authorizeLab(address lab)`** — `onlyOwner` (reverts with
  `"not owner"` for anyone else). Adds an address to `authorizedLabs` and
  emits `LabAuthorized`. Run once per real lab by
  `scripts/05-authorizeLab.js`, which resolves the lab account's EVM
  address via the mirror node, calls this, then *reads the mapping back*
  to fail loudly if it didn't stick.
- **`submitTestResult(int64 serial, bool passed)`** —
  `onlyAuthorizedLab`: reverts `"not an authorized lab"` unless
  `msg.sender` is in the mapping. This is the trust model in one line: a
  random account — or a hospital, or even the token treasury —
  *cannot* write a test verdict; only a key the contract owner explicitly
  authorized can, and the emitted `TestResultRecorded` event permanently
  records *which* lab address attested each result. Stores
  `Passed`/`Failed` for the serial. (Known gap: an authorized lab can
  overwrite its own earlier verdict; §6.3.)
- **`requireClearance(int64 serial)`** — the enforcement point. A single
  `require(testStatus[serial] == Passed, "blocked: test missing or
  failed")`. If the unit's status is `Unknown` (never tested) or `Failed`,
  the call **reverts**, and the caller (`transferCustody()`) treats that
  revert as a hard stop — the NFT transfer is never even built. There is
  deliberately no access control on this function: it can only refuse or
  emit `ClearanceChecked`; there is nothing to abuse.

### 3.4 `BloodOversight.sol` — bonds, investigations, elections, function by function

Constants: `MIN_BOND` = 10 HBAR (stored as `10 * 1e8` because contract
amounts are in tinybars); `MAX_PENALTY_BPS` = 2000 basis points = 20%;
`SUSPEND_SCANDALS` = 5; `SUSPEND_BOND_FLOOR` = 2.5 HBAR. State: `authority`
(current oversight org), `orgs` (address → Org struct: type, registration
time, remaining bond, scandal count, review score, suspended flag),
investigations array, staff mappings, election state.

- **`constructor()`** — the deployer becomes the initial `authority`
  (someone must be able to resolve investigation #0; the first election
  replaces them — §6.5 discusses the incumbent-power caveat).
- **`registerOrg(uint8 orgType)`** — `payable`; an organization registers
  *itself* and posts its bond in the same transaction. Reverts unless the
  org type is valid (1–4: BloodBank, Lab, Hospital, Transport), the
  sender isn't already registered, and the attached value ≥ `MIN_BOND`.
  New orgs start with review score 50 (a neutral default). The bond is
  the collateral that later slashing bites — §5.2.
- **`setReviewScore(address org, uint256 score)`** — `onlyAuthority`,
  score ≤ 100. Review scores are off-chain facts (patient reviews,
  audits) written on-chain by the authority acting as an **oracle** — a
  trusted bridge between the real world and the ledger. Named honestly as
  a trust-shifting compromise (§6.4).
- **`openInvestigation(address subject, int64 unitSerial, string reason)`**
  — callable by the authority *or any active registered org*: detection
  is deliberately not a privilege. Reverts for suspended orgs and unknown
  subjects. Appends an Investigation and returns its ID.
- **`resolveInvestigation(uint256 id, bool guilty, uint256 penalty)`** —
  `onlyAuthority`, one verdict per case (`"already resolved"`). If
  guilty: the actual slash is `min(penalty, 20% of the org's remaining
  bond)` — the graduated-punishment cap (§5.3) — the bond is reduced,
  the scandal counter incremented, and suspension triggers only if the
  bond fell below 2.5 HBAR or scandals reached 5. Slashed funds stay in
  the contract as an insurance pool (no payout path yet; §6.7).
- **`topUpBond()`** / **`reinstateOrg(address org)`** — the
  rehabilitation path. Any org can restore its bond by paying in;
  reinstatement of a suspended org is a separate, *human* decision by the
  authority (money alone should not buy back trust), requires the bond
  restored to minimum, and forgives one scandal so the org isn't one
  mistake from instant re-suspension.
- **`registerStaff(bytes32 staffHash)`** — `onlyRegistered`; an employer
  registers a staff member as a **SHA-256 hash** of their staff ID. The
  raw ID never touches the ledger — attribution without personal data
  (§5.4). Reverts if the hash is already registered.
- **`suspendStaff(bytes32 staffHash)`** — `onlyAuthority`; marks the hash
  suspended, making any future result tagged with that staff ID
  rejectable.
- **`voteWeight(address orgAddr)`** — the election formula, computed live
  at call time (§5.5 explains each term):
  `10 + 2·tenureMonths + reviewScore/10 − 2·scandalCount`, floored at 1
  for active orgs; suspended or unregistered orgs get 0.
- **`startElection(address[] candidates)`** — `onlyAuthority`; requires
  no election already open and ≥ 2 candidates, all active registered
  orgs. Increments the election ID (which scopes all vote bookkeeping).
- **`castVote(address candidate)`** — requires an open election, that the
  sender hasn't voted in *this* election, that the candidate is on the
  ballot, and weight > 0. Adds the sender's *current* `voteWeight()` to
  the candidate's tally.
- **`closeElection()`** — `onlyAuthority`; finds the highest tally
  (a tie goes to the earlier-listed candidate — `>` not `>=`), requires
  at least one vote, and **hands over power**: `authority = winner`. The
  handover is real — after this call, the old authority's
  `onlyAuthority` calls revert.

### 3.5 The local JSON index — explicitly *not* the source of truth

`data/index.json` (managed by `src/localIndex.js`) mirrors each unit's
latest state so status checks and batch lookups are instant local reads
instead of network calls. It is a **cache**: gitignored, disposable, and
rebuildable. The proof that this claim is real is `src/rebuildIndex.js` +
`scripts/rebuildIndex.js`: `npm run rebuild-index` replays the *entire*
HCS topic in consensus order through a reducer that mirrors exactly the
state transitions the live functions write, reconstructing the file from
chain history alone; `npm run check-index` does the same rebuild in memory
and **diffs** it against the local file, reporting any drift without
writing (exit code 2 on drift, so automation can alert). If the file is
deleted, wrong, or tampered with, the ledger restores it — that is what
"the chain is the source of truth" means operationally.

### 3.6 The mirror node query layer

`src/mirrorNode.js` is the only backend file that talks to the mirror
REST API: full topic history (paginated), NFT info per serial, and
`getEvmAddress()` — the account-to-contract-address resolution described
in §2.2, needed whenever an account is passed *into* a contract call
(investigation subjects, election candidates).

### 3.7 The API server, and why keys live there

A browser is the wrong place for private keys: any script injection, bad
extension, or debugging mishap can exfiltrate them, and a signing key for
a medical custody system must never be one `console.log` away. So the
frontend never holds keys. Instead, `server/index.js` — a thin Express
server bound to `127.0.0.1` only — wraps the existing `src/` functions.
Every state-changing route signs server-side with the same `.env` keys
the CLI scripts use, **as the correct party**: test submissions sign with
the lab's client, transfers with the current holder's key, each org's
oversight calls with that org's own client (the contract's `msg.sender`
checks depend on it). The server boots even with no `.env` and reports
`configured: false` so the frontend can fall back to simulation mode; all
action routes then return a clear 503.

### 3.8 The frontend's two paths

- **Read path — no server involved.** Custody trails, event feeds, and
  NFT ownership are fetched by the browser *directly from the public
  mirror node*, and every event links to HashScan. Independence of the
  read path is a design statement: you don't need to trust our stack to
  check our claims.
- **Write path — through the API server.** Buttons on the role dashboards
  call the local server, which signs and submits real transactions.
- **Two modes.** At load, the app asks the server for its config. If the
  server is up and configured, the header shows **HEDERA TESTNET — LIVE**
  and everything above applies. Otherwise the app runs against an
  in-memory **simulation engine** (`frontend/src/lib/sim.js`) that mirrors
  the backend's exact semantics (same gate rule, same slashing cap, same
  vote-weight formula) under a loud **SIMULATION** badge — so the UI can
  be developed, demoed, and graded without keys, without ever pretending
  simulated data is on a ledger.

---

## 4. The life of one blood unit, end to end

What actually happens, cross-referenced to code, when a unit flows through
the system. (Sequence numbers below are from our live testnet run —
verifiable on topic `0.0.9663848`.)

**1. Collection → `mintUnit()`** (`src/mintUnit.js`)
A donation is collected and barcoded. `mintUnit` submits a
`TokenMintTransaction` (signed by the supply key) carrying ≤ 100 bytes of
metadata: `{donorBatchId, collectionCenterId}`. The network assigns the
next serial — that number is the unit's identity for life. The function
then logs a `COLLECTED` event to HCS (seq #1 in our run) and caches the
unit locally. On-chain state now: NFT #1 exists, owned by the treasury.

**2. Testing → `submitTestResult()`** (`src/submitTestResult.js`)
The lab runs its panel and submits the verdict **signed by the lab's own
key** — the server/demos pass the lab's client, so the contract sees the
lab's address as `msg.sender` and `onlyAuthorizedLab` does real work. Two
records are written: the enforceable one (`testStatus[serial] = Passed |
Failed` in `BloodUnitGate`, with a `TestResultRecorded` event naming the
submitting lab) and the audit one (a `TEST_RESULT` HCS message including
the panel type and the staff ID of the technician — seq #2). If the
signing account was never authorized, the contract reverts and the
function surfaces an actionable error naming `scripts/05-authorizeLab.js`.

**3. Transfer → `transferCustody()`** (`src/transferCustody.js`)
Before anything moves, the function calls `requireClearance(serial)` on
the gate contract. Two outcomes:

- **Cleared** (a `Passed` verdict is on record): the function builds the
  actual `TransferTransaction`, signed by the *current holder's* key, and
  the NFT moves to the receiving account. A `CUSTODY_TRANSFER` event
  (seq #3) records from/to, and the local cache stamps `heldSince` — the
  clock the stale monitor (§5.1) will check.
- **Blocked** (no test, or `Failed`): the contract reverts, and the
  transfer is never attempted — the refusal happens *before* the token
  is touched. The function logs `TRANSFER_BLOCKED` to HCS (a permanent,
  public record that someone tried — seq #6 in our run, for unit 2) and
  returns `{blocked: true}`. A subtlety fixed during the audit: *only a
  genuine contract revert* counts as blocked; infrastructure errors
  (network failure, expired transaction) are re-thrown instead of being
  written into the audit trail as false fraud signals.

The JavaScript never decides pass/fail — it relays the contract's verdict.
That is the entire point: an `if` statement on a server can be edited by
whoever runs the server; the deployed contract can't be.

**4. End of life → `closeUnit()`** (`src/closeUnit.js`)
The unit is transfused into a patient or disposed of. The NFT is burned
via `TokenWipeTransaction`, signed with the **wipe key** — deliberately
the platform's authority, not the holder's, so a hospital cannot decline
to retire a unit's token. A `TRANSFUSED` or `DISPOSED` event closes the
unit's HCS history. From now on, querying that serial on the token
returns nothing: the set of live NFTs *is* the set of blood in
circulation.

**5. The bad path → `flagBatch()`** (`src/flagBatch.js`)
A unit is found contaminated (say it failed its panel). Flagging it looks
up every sibling with the same `donorBatchId` and, in one sweep:
quarantines the flagged unit (`FLAGGED`, seq #7), quarantines every
still-open sibling (`BATCH_ALERT` each — seq #8 caught unit 1 *after it
had already been transferred to the lab*), and for siblings already
transfused emits `POST_USE_ALERT` instead — you cannot quarantine blood
already in a patient, but you can permanently record that follow-up is
needed. What takes a recall team days happens in seconds, and the alerts
are on a ledger every party already watches.

---

## 5. The oversight layer: fraud, punishment, and governance

The base system proves custody. The oversight layer answers the harder
question: *what happens when a registered, authorized participant
misbehaves?* Its threat model is stated honestly in `OVERSIGHT.md`: a
ledger cannot see a physical hand-off, so it watches for what it *can*
see.

### 5.1 Stale units — the absence of an event as the signal

Every legitimate unit's history *ends* — with `TRANSFUSED` or `DISPOSED`,
inside a bounded holding window. A unit transferred to a hospital that
then goes **silent** past the window (default `STALE_THRESHOLD_DAYS=10`;
demos compress it to seconds) is the detectable signature of possible
diversion. `src/checkStaleUnits.js` scans for open units held past the
threshold and writes a permanent `STALE_ALERT` to HCS for each. Detection
means "flag the silence," not "witness the crime" — the verdict remains a
human judgment; the chain makes the alert automatic, the record public,
and the punishment (below) self-executing.

### 5.2 Bonds — skin in the game

On registration, every org posts a **bond**: 10 HBAR locked in the
oversight contract from the org's *own* account. The bond converts
"punishment" from a symbolic note in a database into an automatic economic
consequence — slashing (below) actually removes the org's money, with no
further cooperation from anyone required. (On mainnet this would be real
value; on testnet the *mechanism* is what's demonstrated.)

### 5.3 Investigations and graduated slashing

Any active member — not just the authority — can open an on-chain
investigation against an org (detection is not a privilege; in our
elect-first demo, the transport company files against the hospital). The
elected authority delivers the verdict. If guilty:

- The requested penalty is **capped at 20% of the org's remaining bond**
  (`MAX_PENALTY_BPS`). Why: each successive slash is smaller in absolute
  terms, so one verdict — even a mistaken one — never destroys a
  participant. Punishment is a gradient, not a cliff.
- The org's public **scandal counter** increments — permanently feeding
  the election formula (§5.5).
- **Suspension requires a pattern, not an incident**: 5 guilty verdicts,
  or a bond ground below 2.5 HBAR. Rationale: a hospital is critical
  infrastructure; removing one from the blood supply over a single
  finding would hurt patients more than the fraud did. And suspension has
  a road back (top-up + authority reinstatement, which forgives one
  scandal) because a permanently crippled hospital helps nobody.

In our live run: verdict guilty, 2 HBAR requested = exactly the 20% cap on
a 10 HBAR bond → bond 10 → 8, scandals 0 → 1, *not* suspended — the
graduated design behaving as specified.

### 5.4 Staff traceability — attribution without personal data

Every test result carries the `staffId` of the nurse or technician who
ran it (in HCS and the local index). On-chain, staff exist only as
**SHA-256 hashes** of their IDs (`registerStaff`): a hash is a one-way
fingerprint — given the hash you cannot recover the ID, but given the ID
anyone can verify the hash matches. So the ledger gets attribution ("the
person who tested unit #3 is employer-registered hash `0x…`") with zero
personal data. When a unit is implicated, one lookup answers "who tested
it?", and the authority can suspend that hash on-chain
(`suspendStaff`), making future results tagged with it rejectable. The
same honesty applies here as everywhere: whether the nurse actually did
anything wrong is for the investigation; the chain provides attribution
and enforcement, not omniscience.

### 5.5 The weighted DAO election

A **DAO** (decentralized autonomous organization) is a group whose
governance rules are encoded in a contract. Here, the *oversight
authority itself* is elected by the registered orgs — including the power
to judge investigations and slash bonds, which is exactly the power you
don't want permanently welded to whoever deployed the contract. Vote
weight is computed by the contract *at the moment of voting*:

```
weight = 10  +  2·tenureMonths  +  reviewScore/10  −  2·scandalCount
         │      │                  │                  │
         │      │                  │                  └─ each guilty verdict
         │      │                  │                     shrinks your voice
         │      │                  └─ 0–100 score from off-chain reviews,
         │      │                     written by the authority (an oracle)
         │      └─ standing grows with time in the consortium
         └─ base: every active member has a voice
```

floored at 1 for active orgs (a scandal history shrinks your voice; only
suspension silences it), 0 for suspended orgs. Each term is an argument:
the base keeps small/new members enfranchised; tenure rewards sustained
participation; reviews import external reputation; the scandal malus
makes fraud *politically* expensive in the very next election — in our
live run, the hospital voted at weight 29 against clean peers' 36–43.
Double-voting is blocked per election; the handover on `closeElection()`
is real (the lab, not the deploying blood bank, is the current authority
of our live deployment).

---

## 6. Known limitations — honestly, one by one

This project's design documents treat honesty about gaps as a feature.
Each limitation below is real, acknowledged in `OVERSIGHT.md` /
`AUDIT_NOTES.md`, and annotated with what production would need.

**6.1 Garbage in (the oracle problem).** The chain proves a record was
never altered *after* writing — not that it was true *when* written. A
lab can submit a wrong verdict and the gate will faithfully enforce the
wrong verdict. *Mitigation in place:* attribution — results are signed by
an authorized lab key and tagged to a registered staff hash, so wrongness
is never anonymous. *Production:* independent re-testing samples, multiple
attesting labs per result, random audits — process, not cryptography.

**6.2 The diversion gap.** A hospital that *fakes a `TRANSFUSED` event*
and diverts the unit defeats the stale monitor — the chain sees a
legitimate-looking closure. *Mitigation in place:* the Reconciliation
view demonstrates the countermeasure — cross-checking on-chain
`TRANSFUSED` events against an independent patient-record system; a
chain-event-with-no-matching-patient-record is precisely the signature of
a faked closure. The patient records in the demo are mock data, labeled
as such. *Production:* real (privacy-preserving) EHR integration, plus
random physical audits — named in the design doc as exactly the thing
blockchains cannot replace.

**6.3 Test results are overwritable.** An authorized lab can resubmit and
flip its own earlier verdict (Failed → Passed) — contract storage keeps
only the latest. The flip is *detectable* (both `TestResultRecorded`
events and both HCS messages survive forever) but not *prevented*.
*Production:* write-once results, or resubmission gated on an oversight
unlock.

**6.4 Review scores are an oracle.** The election formula's review term
is an off-chain fact written on-chain by the current authority. That
shifts trust (from "trust the reviews" to "trust the authority's
reporting of them") rather than removing it. *Production:* multiple
independent score submitters, or commit-reveal schemes.

**6.5 Incumbent power.** The deployer bootstraps as authority, and
`closeElection()` is called by the incumbent — who could simply stall.
The elect-first demo shows power genuinely transferring by vote, but the
stalling vector is real. *Production:* deadline-based auto-close, so an
election concludes with or without the incumbent's cooperation.

**6.6 One judge.** Investigations are resolved by a single authority, not
a panel. *Production:* multi-member verdicts with majority rule.

**6.7 Bonds have no exit.** There is no `withdrawBond()`: a clean org
that leaves the consortium forfeits its bond, and the slashed "insurance
pool" has no payout function. Left as-is deliberately (the POC's story is
slashing, not exits) but a production contract needs both, with notice
periods and governance.

**6.8 No lab revocation, no cross-contract enforcement.** `authorizeLab`
is one-way (no `revokeLab`), and the gate contract does not consult the
oversight contract's staff suspensions — a suspended nurse's results are
rejectable off-chain, not rejected on-chain. *Production:* revocation,
plus the gate querying oversight state cross-contract.

**6.9 One submit key for the topic.** All HCS messages are submitted
under the operator's topic key, so events are attested by the platform
operator, not by the acting party (the *contract* calls, by contrast, are
now genuinely per-party). *Production:* per-party topics or threshold
submit keys.

**6.10 The cache is not concurrency-safe.** Simultaneous writers to
`data/index.json` (API server + a CLI script) can last-write-wins clobber
each other. Harmless at demo scale, self-healing via `rebuild-index`, and
the module's design makes the SQLite swap a one-file change.

**6.11 One person, four accounts.** All four demo orgs are testnet
accounts controlled by the team. Every *mechanism* (bonds, votes,
handover) is real; the *politics* of a genuine multi-party deployment is
not demonstrated — and can't be, in a course project.

---

## 7. Glossary

- **aBFT (asynchronous Byzantine fault tolerance)** — the security class of
  Hedera's consensus: provably correct agreement even with up to ⅓
  malicious nodes and unreliable networking.
- **Account ID** — a Hedera account identifier, e.g. `0.0.9628733`.
- **Alias / EVM address** — the 20-byte Ethereum-style address
  (`0x…`) by which an account appears inside smart contracts; derived
  from the public key for ECDSA accounts.
- **Association** — Hedera's opt-in rule: an account must associate with a
  token before it can hold it.
- **Bond** — HBAR an organization locks in the oversight contract at
  registration; the collateral slashing removes.
- **Consensus timestamp** — the network-agreed time of a transaction,
  nanosecond resolution; the authoritative ordering for all events.
- **DAO** — decentralized autonomous organization; a group governed by
  contract-encoded rules (here: the weighted authority election).
- **DER** — a standard binary encoding for cryptographic keys (the hex
  strings in `.env`).
- **ECDSA (secp256k1)** — the signature algorithm Ethereum uses; gives
  accounts a native EVM alias address. Used by this project's accounts.
- **ED25519** — Hedera's other supported signature algorithm; appears in
  contracts as a long-zero address.
- **EVM (Ethereum Virtual Machine)** — the standard smart-contract
  runtime; Hedera's contract service is EVM-compatible.
- **Event (Solidity)** — a log entry emitted by a contract for outside
  observers; costs little, changes no state.
- **Gas** — the metered execution fee for contract calls.
- **Gossip protocol** — nodes repeatedly share state with random peers;
  Hedera adds "gossip about gossip" (sharing the communication history
  itself), enabling virtual voting.
- **Hashgraph** — the DAG-based consensus structure Hedera uses instead of
  a chain of blocks.
- **HashScan** — the public Hedera explorer (`hashscan.io`); every ID in
  this project can be inspected there.
- **HBAR / tinybar** — Hedera's currency; 1 HBAR = 100,000,000 tinybars
  (contracts see tinybars).
- **HCS (Hedera Consensus Service)** — append-only, consensus-ordered
  message topics; this project's audit trail.
- **HSCS (Hedera Smart Contract Service)** — Hedera's EVM-compatible
  contract layer; runs both Solidity contracts.
- **HTS (Hedera Token Service)** — native token layer; defines the BLOOD
  NFT class.
- **Long-zero address** — the synthetic EVM address of an ED25519 account
  (account number zero-padded).
- **Mirror node** — a free public read-replica of network history, exposed
  as a REST API; the frontend's read path and the index-rebuild source.
- **Modifier** — a reusable Solidity guard (`onlyOwner`, `onlyAuthority`)
  prepended to functions.
- **msg.sender** — the signature-verified address of a contract's caller;
  the basis of all access control.
- **NFT (non-fungible token)** — an individually distinct token; one NFT
  serial = one physical blood unit.
- **Oracle** — any trusted party that writes off-chain facts on-chain
  (here: the authority writing review scores; labs writing test results).
- **Payable** — a Solidity marker for functions that can receive currency
  (bonds).
- **Precheck** — Hedera's fast validation before consensus; errors like
  `INSUFFICIENT_PAYER_BALANCE` and `INVALID_SIGNATURE` are precheck
  failures.
- **Revert** — a contract aborting a call (`require` failure); state is
  unchanged; how the gate refuses.
- **Sequence number** — a message's position in an HCS topic, assigned by
  consensus.
- **Serial number** — the network-assigned identity of one NFT (one blood
  unit).
- **SHA-256** — a one-way cryptographic hash; how staff IDs appear
  on-chain.
- **Slashing** — confiscating part of a posted bond as an enforced
  penalty.
- **Smart contract** — a program deployed on the ledger; public code,
  public state, unalterable execution.
- **Solidity** — the language both contracts are written in.
- **Submit key** — the key required to publish to an HCS topic.
- **Supply key** — the HTS key controlling minting/burning of a token.
- **Testnet / mainnet** — the free development network (used here;
  periodically reset) vs the real-value production network.
- **Topic** — an HCS message channel (ours: `0.0.9663848`).
- **Treasury** — the account a token's newly minted units belong to (the
  blood bank).
- **Virtual voting** — deriving every node's vote from the shared gossip
  history instead of exchanging actual votes.
- **Wipe key** — the HTS key that can forcibly remove (burn) a serial
  from any account; how `closeUnit()` retires units.
