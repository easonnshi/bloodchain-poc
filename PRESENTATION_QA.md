# Presentation Q&A prep — every tab, in depth

One section per frontend view: what's on screen, what actually happens
underneath (with function/contract names), and the questions a grader is
likely to ask — with answers. Cross-cutting questions at the end.

Scope note: the presented system is the core custody chain plus stale-unit
detection. The repository also contains an optional CLI-only oversight
layer (bonds/slashing/elections); it is not part of the app or the
presentation, and the frontend filters its event types from all feeds. If
asked about it, the honest answer is: "it exists in the repo as an
explored extension, we scoped the presentation to the custody core."

---

## The header (visible on every tab)

**On screen:** the mode badge (`HEDERA TESTNET — LIVE` green, or
`SIMULATION` amber), and in live mode three links: token `0.0.9663839`,
topic `0.0.9663848`, gate `0.0.9663858` — each opening HashScan.

**Underneath:** at page load the app calls the local API server's
`/api/config`. If the server is up and `.env` is complete → live mode:
buttons sign real transactions, reads come from the public mirror node. If
not → the in-memory simulation engine with identical rules, under a loud
badge. The app never mixes the two or presents simulated data as sealed.

**Q: How do I know this screen isn't just a mock-up?**
A: Click any of the three header links — they open hashscan.io, a public
explorer we don't operate, showing the same token/topic/contract. Or skip
our UI entirely and curl the mirror node.

**Q: What happens if I open the app with no backend at all?**
A: Simulation mode, clearly labeled, with events marked "not sealed." It
exists so the UI can be examined without credentials — not to fake
verifiability.

---

## 1. Overview (`/`)

**On screen:** four stat tiles (units in circulation, events on ledger,
transfers blocked, quarantined/stale); the custody flow map; the consensus
event feed. In simulation mode, a "Play the full story" button runs a
scripted 8-step narrative.

**The flow map:** stations are the physical world — Collection (blood
bank) → the shield (the gate contract) → Testing → Transport → Hospital →
Transfused, plus a hatched Quarantine bay and a Disposed tray. Each chip
is one unit, positioned by its on-chain status: green ring = passed test,
red ring = failed/blocked, amber pulse = stale, faded = closed. When a
status changes, the chip physically moves; a blocked transfer shakes the
chip and flashes the shield red with the literal label `requireClearance()`.

**The consensus feed:** newest-first HCS messages. The dot next to a
fresh event pulses once — triggered by the event's *actual consensus
timestamp* being less than ~8 s old, not by a fake spinner. Every row in
live mode links to its transaction on HashScan; timestamps are displayed
to the nanosecond because that precision is network-assigned.

**Underneath:** live mode polls `/api/units` (the server's local cache)
and the mirror node's topic-messages endpoint (browser → mirror directly)
every ~6 s. Sim mode subscribes to the engine.

**Q: What does "events on ledger" actually count?**
A: The highest HCS sequence number on our topic — assigned by network
consensus, so it's the ledger's own count, not ours.

**Q: Is the animation real or scripted?**
A: The *rendering* is ours; the *state changes* driving it are real
ledger state in live mode. In simulation mode the story button drives the
same rules in memory — and the badge says so the whole time.

**Q: How fast is "real time"?**
A: Consensus finality on Hedera is a few seconds; the public mirror node
lags a few more. The feed reflects events ~5–10 s after they happen.

---

## 2. Trace a unit (`/trace/:serial`)

**On screen:** a serial search; the unit's full event timeline
(mint → test → transfers → block/quarantine → close), each event with its
color-coded type, nanosecond consensus timestamp, and a "verify tx" link;
a unit record card (status, batch, staff, NFT owner); a QR "bag label."

**Underneath:** this page is deliberately **server-free** in live mode.
The browser fetches the *entire topic history* from
`testnet.mirrornode.hedera.com` (public, keyless, free), filters it by
unit ID client-side, and queries the NFT's current owner the same way.
The QR encodes this page's URL — printed on a physical bag at collection,
it ties the object in your hand to the public record.

**Q: Why should I trust this timeline? Your app rendered it.**
A: You don't have to. The read path bypasses our backend entirely: the
data comes from the public mirror node, and every event links to
HashScan. Fetch the same topic yourself and diff it.

**Q: I traced a closed unit and the token query says it doesn't exist.**
A: By design. `closeUnit()` burns the NFT with the token's wipe key, so
"does the token exist" doubles as "is this blood still in circulation."
The *history* survives forever on the topic; the *token* does not.

**Q: What's stopping someone swapping QR labels between two bags?**
A: Nothing cryptographic — that's the physical–digital binding limit,
named in our report. The QR makes honest verification easy; it doesn't
make dishonest handling impossible. Production would pair it with
tamper-evident labels and random physical audits.

---

## 3. Blood Bank (`/bank`)

**On screen:** the mint form (donor batch + collection center), the batch
recall form, a stale-unit sweep button, a "cache vs ledger" audit button,
and the full inventory table.

**Underneath:**
- **Mint** → `POST /api/units` → `mintUnit()`: one
  `TokenMintTransaction` signed by the supply key (operator = treasury);
  the *network* assigns the next serial; metadata is ≤ 100 bytes (HTS
  limit) carrying only `{donorBatchId, collectionCenterId}`; a
  `COLLECTED` message goes to HCS.
- **Recall** → `flagBatch()`: finds every sibling with the same
  `donorBatchId`, writes `FLAGGED` for the unit, `BATCH_ALERT` for every
  open sibling (quarantined), and `POST_USE_ALERT` for already-transfused
  siblings (you can't quarantine blood in a patient, but you can flag the
  need for follow-up — permanently).
- **Stale sweep** → `checkStaleUnits()`: flags open units held past the
  threshold with a permanent `STALE_ALERT` — the absence-of-event fraud
  signal.
- **Audit** → replays the *entire* HCS topic through a reducer mirroring
  the live state transitions and diffs the result against the local JSON
  cache. Zero drift = the cache is provably a cache.

**Q: Who can mint? Could a hospital mint fake units?**
A: Only holders of the token's supply key — the network itself rejects
anyone else's `TokenMintTransaction`. That's an HTS-native rule, not
app logic.

**Q: The batch lookup uses a local JSON file. Isn't that centralized?**
A: It's a performance cache, and we prove it: the audit button (and
`npm run check-index`) rebuilds the same state from public chain history
and diffs it. Delete the file and `npm run rebuild-index` restores it
from the ledger. The chain is the source of truth *operationally*, not
rhetorically.

**Q: Why only 100 bytes of NFT metadata?**
A: HTS's hard cap — and the reason the architecture uses two services:
the token carries identity, HCS carries the unbounded event history.

**Q: What happens after a STALE_ALERT fires?**
A: In scope: the alert is permanent, public, and impossible for the
implicated holder to suppress — the evidence trail a human investigation
starts from. Automated consequences (economic penalties, governance) are
a natural extension we explored in the repo but kept out of the
presented scope.

---

## 4. Lab (`/lab`)

**On screen:** a signing-identity card (lab account `0.0.9637911`,
"authorized on gate contract"), staff and panel selectors, units awaiting
test with ✓/✕ buttons, recent verdicts.

**Underneath:** the ✓/✕ buttons call `submitTestResult()` with the
**lab's own client** — the transaction is signed by the lab's key, so
inside `BloodUnitGate` the caller (`msg.sender`) is the lab's EVM
address. The contract's `onlyAuthorizedLab` modifier checks that address
against an allow-list the contract owner populated once via
`authorizeLab()` (`scripts/05-authorizeLab.js`). The emitted
`TestResultRecorded` event permanently attributes the verdict to that
lab address. The HCS `TEST_RESULT` message adds the panel type and the
staff ID of the technician.

**Q: What happens if the hospital tries to submit a test result?**
A: The contract reverts with "not an authorized lab" — the network
rejects it regardless of what any UI or server does. We can demonstrate
it live.

**Q: What if the lab itself lies?**
A: The chain can't know — that's the oracle problem, stated in our
report: the ledger proves a record wasn't altered after writing, not
that it was true when written. What we guarantee is *attribution*: the
lying lab's address and its technician's staff ID are permanently
attached to the lie. Production adds independent re-testing and audits.

**Q: Can a result be changed afterwards?**
A: An authorized lab can resubmit and overwrite its own verdict — a
known, documented gap. The flip is *detectable* (both contract events
and both HCS messages survive) but not *prevented*. Production would
make results write-once.

**Q: Why is the staff member a dropdown and not a login?**
A: POC scope. The point being demonstrated is per-test staff
*traceability* in the permanent record, not authentication UX.

---

## 5. Hospital / Transport (`/logistics`)

**On screen:** a destination selector and transfer buttons per eligible
unit; a "held units" list with how long each has been held; Transfuse /
Dispose buttons.

**Underneath:**
- **Transfer** → the server identifies the current holder from the
  cache, signs with *that party's* key (an NFT transfer requires the
  sender's signature), but **first** calls
  `BloodUnitGate.requireClearance(serial)`. If the contract reverts (no
  test or a failed test), the token transfer is never even built —
  `TRANSFER_BLOCKED` is logged and the UI surfaces the refusal. If it
  clears, the `TransferTransaction` moves the NFT and `CUSTODY_TRANSFER`
  records from/to; the cache stamps `heldSince`, which is the clock the
  stale monitor reads.
- **Transfuse/Dispose** → `closeUnit()`: a `TokenWipeTransaction`
  signed with the **wipe key** — deliberately platform authority, not
  the holder's, so a hospital cannot decline to retire a unit's token —
  plus a `TRANSFUSED`/`DISPOSED` closing event.

**Q: Why does your demo deliberately attempt an illegal transfer?**
A: Because a demo that only shows the happy path proves nothing. The
blocked attempt — a contract revert, recorded permanently — is the
evidence that the gate enforces rather than logs.

**Q: Couldn't someone bypass your app and transfer the NFT directly?**
A: They'd still need the current holder's private key to sign the
transfer, and the receiving account must have opted in (token
association). The gate check lives in our transfer path; a raw HTS
transfer by the *legitimate holder* around the gate is possible in the
POC — which is why production would use HTS's native freeze/KYC keys or
contract-controlled custody to close that path. It's in the audit notes.

**Q: What's the point of the held-units clock?**
A: `heldSince` is what `checkStaleUnits()` measures against. A unit
neither closed nor forwarded within the window becomes a `STALE_ALERT` —
the absence-of-event signal that makes silent diversion visible.

---

## 6. Explainer (`/explainer`)

**On screen:** a six-step animated storyboard (arrow keys advance): unit
becomes ledger entity → every event lands on consensus → the gate is a
contract, not a promise → one bad unit recalls the batch → silence is a
signal → anyone can check.

**Purpose:** a presentation asset, not a data view. Each step states one
claim; the live tabs then *prove* that claim. Designed to be projected.

---

## Cross-cutting questions

**Q: Why Hedera and not Ethereum?**
A: Three practical reasons: (1) fees are fixed and tiny (an HCS message
costs a fraction of a cent — our entire evaluation cost well under a
dollar in testnet terms), which makes logging *every* custody event
viable; (2) finality in seconds with consensus timestamps assigned by
the network — no block confirmations, and event ordering is a network
fact; (3) native token and consensus services — the NFT rules (supply
key, wipe key, association) and the append-only log are enforced by the
platform without us writing or auditing contract code for them. The
enforcement logic that *does* need custom code runs on Hedera's
EVM-compatible contract service in standard Solidity.

**Q: Why a public network at all? A hospital consortium could run a
private database.**
A: The failure modes we target are all "one party controls the record."
A private database has an administrator; a consortium chain has member
politics over who runs nodes. On a public ledger, verification requires
no relationship with any participant — a patient's family can check a
unit's history on HashScan. The trade-off (data is public) is handled by
design: nothing personal goes on-chain, only unit events and staff IDs.

**Q: GDPR / privacy?**
A: No personal data touches the ledger. Donors appear only as batch IDs,
staff only as internal IDs (no names), patients not at all. The
immutable ledger never stores anything that could require erasure.

**Q: What does it cost to run?**
A: Testnet: free. At mainnet prices: minting an NFT ~$0.05, an HCS
message ~$0.0001, contract calls a few cents — order of one cent per
unit-lifecycle excluding the mint.

**Q: What happens when testnet resets?**
A: Testnet is wiped periodically; our IDs would die. Redeploying is
~10 minutes with the scripts in README order, and the runbook documents
it. Mainnet has no resets.

**Q: Keys in a browser?**
A: Never. All signing happens in a localhost API server reading `.env`;
the browser sees account IDs and results only. Read paths don't touch
keys at all.

**Q: What breaks if your server or cache is destroyed?**
A: Nothing that matters: the server holds no state, and the cache
rebuilds from chain history with one command (`npm run rebuild-index`) —
we can demonstrate deleting it and restoring it live.

**Q: A unit went stale — then what? Who acts on the alert?**
A: The alert is the chain's contribution: automatic, public, timestamped,
and impossible for the implicated holder to edit or suppress. Acting on
it — investigation, sanctions, regulatory consequences — is a human
process by design; the ledger hands that process an evidence trail
nobody can dispute. (We prototyped an on-chain governance extension for
this in the repo, but scoped the presentation to the custody core.)

**Q: Single biggest weakness if you're honest?**
A: The oracle boundary: everything on-chain is only as true as the
authorized party that wrote it. Our design accepts this and optimizes
what a ledger *can* give — attribution, immutability, automatic
alerting, and public verifiability — while naming the rest as process
problems (audits, reconciliation against patient records) rather than
pretending cryptography solves them.
