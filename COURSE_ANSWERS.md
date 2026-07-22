# DDiB26 final project — required discussion answers

Presentation-ready answers to the two instructions from the "Final Project
Introduction" deck (S4, 13.07.26), grounded in what this codebase actually
does. Sources: the code itself, `AUDIT_NOTES.md`, `PROJECT_WRITEUP.md`.

Scope note: these answers cover the **presented scope** — the core custody
chain (mint → test-gate → transfer → close → batch recall) plus stale-unit
detection. The repository also contains an optional, CLI-only oversight
layer (bonds/slashing/elections) that is deliberately outside the
presentation and not claimed here.

> Note for the team: the deck was OCR-recovered and may be incomplete —
> cross-check these two prompts against the original slides before the
> final hand-in.

---

## "What is unique in your approach?"

Three things, each of which can be demonstrated live rather than claimed:

**1. The contract is an enforcement point, not a notary.** Most supply-chain
blockchain projects log that a rule was followed. Here, `transferCustody()`
cannot move the NFT until `BloodUnitGate.requireClearance()` returns — a
unit with a missing or failed test **reverts on-chain and physically does
not move**. The demo proves this by trying: unit B fails its panel, the
transfer is attempted anyway, and the resulting `TRANSFER_BLOCKED` event is
the network refusing, not our JavaScript being polite. The JS never decides
pass/fail; it relays the contract's verdict. And the verdict itself is
signed by the **lab's own authorized key** (`authorizeLab()` +
`onlyAuthorizedLab` on `msg.sender`), so the on-chain record permanently
attributes every test result to the laboratory that attested it.

**2. Absence-of-event detection.** We accept, in writing, that a blockchain
cannot see a physical hand-off — and then engineer around it: every
legitimate unit must end with `TRANSFUSED` or `DISPOSED`, so a unit that
goes *silent* past its holding window is itself the fraud signal
(`checkStaleUnits.js` → a permanent, public `STALE_ALERT` on the ledger).
Detection of what the chain *can't* see, derived from what it *can*: the
missing event. The alert is automatic, timestamped by network consensus,
and impossible for the implicated holder to suppress or edit — exactly the
evidence trail a human investigation needs.

**3. Verifiability as the product surface.** The system uses three Hedera
services for three jobs (HTS: unit existence/ownership; HCS:
consensus-ordered event history; HSCS: enforcement logic), all on public
testnet. The frontend treats that as the feature: every event links to
HashScan, the custody-trail page reads the public mirror node directly
(no wallet, no trust in our server), each unit gets a QR code tying the
physical bag to its ledger record, and a one-click "audit cache vs ledger"
rebuilds local state from chain history and diffs it. A grader doesn't have
to believe us — they can check, on infrastructure we don't control.

---

## The four discussion points

### (1) Reasons for choosing this case

- **The trust problem is structural, not technological.** Blood custody
  spans organizations that don't share a database or an owner: collection
  centers, labs, transporters, hospitals. Each keeps its own records; when
  something goes wrong (contamination, diversion, a faked test), each
  party's records are self-serving evidence. A shared, neutral,
  append-only log is precisely the artifact no single participant can
  provide — the textbook case where a public ledger beats a database.
- **The stakes justify the overhead.** Per-unit NFTs and consensus
  timestamps would be overkill for tracking office supplies. For a
  substance that is transfused into a human being, where one contaminated
  donation batch can reach multiple patients, per-unit provenance and
  instant batch-wide recall are proportionate.
- **The safety rule is binary and encodeable.** "No unit moves without a
  recorded passing test" is exactly the kind of rule a smart contract can
  hold: objective, checkable at a single choke point (the token transfer),
  no oracle-quality judgment required at enforcement time.
- **Bounded scope.** Five core functions, one enforcement contract, one
  topic — small enough to build honestly in a course project, rich enough
  to hit real problems (see below) instead of toy ones.

### (2) Challenges in the case, and how we addressed them

Taken directly from the project's own honesty documentation
(`AUDIT_NOTES.md`, `README.md` known-gaps section) — named, not hidden:

- **Garbage-in (the oracle problem).** The chain proves a record wasn't
  altered *after* writing, not that it was true *when* written. A lab can
  submit a wrong result and the contract will faithfully enforce the wrong
  result. *Mitigation:* attribution, not omniscience — results are signed
  by the lab's own authorized key, and the technician's staff ID is
  recorded with every test in the permanent log, so a wrong result is
  never anonymous. Wrongness stays possible; anonymous wrongness does not.
  Production would add independent re-testing and random audits.
- **The diversion gap.** A hospital that fakes a `TRANSFUSED` event and
  diverts the unit defeats the stale-unit monitor. The chain alone cannot
  close this. *Addressed honestly as an open limitation:* the
  countermeasure is off-chain reconciliation of on-chain `TRANSFUSED`
  events against an independent patient-record system — a
  chain-event-without-patient-record is the exact signature of a faked
  closing event. That integration is named future work, precisely the kind
  of random audit the design doc says blockchains cannot replace.
- **Physical/digital binding.** An NFT can't feel whether the right bag was
  scanned. *Mitigation:* per-unit QR codes minted with the token tie the
  bag to its public trace page; the binding is still procedural (someone
  must scan honestly) and we say so.
- **Hedera-specific constraints** we hit and solved: 100-byte NFT metadata
  cap (full detail lives in HCS instead), token-association requirements,
  EVM address derivation differing for ED25519 vs ECDSA keys (resolved via
  mirror node), browser key custody (thin local API server holds keys;
  reads bypass it entirely via the public mirror node).

### (3) Academic and social significance

- **Academic:** the project is a working case study in *hybrid
  enforcement* — which guarantees can move on-chain (custody gating,
  attributed attestations, automatic alerting) versus which are
  irreducibly social (verdicts, physical hand-offs, record truthfulness).
  The absence-of-event detection pattern — monitoring for missing closing
  events rather than pretending to observe the physical world — is a
  transferable mechanism, not an app feature. It also exercises Hedera's
  three-service architecture as a deliberate design: consensus-ordered
  logs (HCS) and token registries (HTS) doing jobs usually forced into
  expensive contract storage.
- **Social:** blood supply chains lose units to diversion and suffer
  recalls measured in days of manual tracing. The demonstrated properties
  — per-unit provenance a patient's family can independently verify,
  batch recall in seconds instead of days, custody gaps that surface as
  automatic public alerts — target real WHO-documented problems in
  exactly the settings (multi-party, low-mutual-trust health systems)
  where "just use one shared database" fails, because no party can be the
  database's owner. Honesty matters socially too: overclaiming
  ("blockchain prevents fraud") erodes trust in the technology; this
  project's docs state precisely what is and isn't guaranteed.

### (4) Deriving the case — other applications

The reusable core is: *per-item token + append-only event log + a
contract gate on a binary safety predicate + absence-of-event
monitoring.* That composite pattern maps directly onto:

- **Organ and tissue transport:** same vein-to-vein structure, harder
  deadlines — the stale-unit monitor becomes a cold-chain timeout measured
  in hours.
- **Pharmaceutical anti-counterfeit / cold chain:** `requireClearance()`
  gates on temperature-logger attestations instead of lab panels;
  `flagBatch()` is a drug-lot recall.
- **Forensic evidence chain-of-custody:** courts already argue about
  custody gaps; "the absence of a logged transfer is itself the alarm" is
  precisely the property evidence lockers need.
- **Food-safety recall (infant formula, meat lots):** batch-sibling
  quarantine transfers unchanged; the QR-on-the-bag becomes QR-on-the-lot.
- **Humanitarian aid distribution:** diversion detected as
  undelivered-and-silent shipments — the stale-alert pattern maps
  one-to-one.

The honest caveat transfers too: in every derivation, the ledger proves
integrity of the record, and the last physical mile still needs
reconciliation against an independent source — the pattern's limits are as
portable as its mechanisms.
