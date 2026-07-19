# BloodChain Oversight Layer: anti-fraud detection, punishment, and DAO governance

This extends the base POC (mint, test-gate, batch-flag) with a fourth capability: what happens when a registered party misbehaves, specifically a hospital secretly trading blood to a third party instead of transfusing it.

## The threat model, stated honestly

A blockchain cannot see a physical hand-off. If a hospital walks a unit out the back door, no transaction records that. What the chain CAN see is the absence of an event that should exist: every legitimate unit ends its life with a `TRANSFUSED` or `DISPOSED` event within a bounded time. A unit transferred to a hospital that then goes silent past the holding window (default 10 days) is the detectable signature of possible diversion. Detection here means "flag the silence," not "witness the crime." The verdict is still a human judgment; the chain's job is to make the alert automatic, the investigation public, and the punishment self-executing.

## The pieces

### 1. Stale-unit monitor (`src/checkStaleUnits.js`)

`transferCustody()` now stamps `heldSince` on every custody change. The monitor scans all open units and flags any held by a non-bank party past `STALE_THRESHOLD_DAYS` (`.env`, default 10) with no closing event. Each flagged unit gets a `STALE_ALERT` on HCS, permanent and visible to every participant. In production this runs daily on a schedule; the demo passes a threshold of seconds.

### 2. Bonds and slashing (`contracts/BloodOversight.sol`)

Every organization registers on the oversight contract by posting a minimum 10 HBAR bond from its own account. That bond is what makes on-chain punishment real rather than symbolic: an investigation resolved as guilty slashes a penalty from the bond and increments a public scandal counter. Cross either threshold, bond below half the minimum or 3 scandals, and the org is automatically suspended: it loses its vote, its right to open investigations, and (by policy) its eligibility to receive units. Slashed funds stay in the contract as an insurance pool.

What this deliberately does not claim: bond slashing is an economic deterrent, not a legal one. Criminal prosecution of actual blood diversion happens off-chain, through regulators. The chain contributes the evidence trail: timestamped custody history, the alert, the investigation, and the verdict, none of which anyone can quietly edit afterward.

### 3. Staff traceability (`submitTestResult` + staff registry)

Every test result now carries a `staffId` (the nurse or technician who ran it), written into the HCS log and the local index. On-chain, hospitals register staff as a SHA-256 hash of the ID, never the name, so no personal data touches the ledger. When a unit is implicated, its record answers "who tested this?" in one lookup, and the authority can suspend that staff hash on-chain. A suspended hash means any future test result tagged with that ID is rejectable. The same honesty applies: whether the nurse actually diverted blood is for the investigation to establish; the chain provides attribution and enforcement, not omniscience.

### 4. Weighted DAO election

The oversight authority (whoever resolves investigations and applies penalties) is itself elected by the registered organizations: hospitals, labs, transport, blood banks. Vote weight is computed on-chain at the moment of voting:

```
weight = 10 (base) + 2 per month of tenure + reviewScore/10 - 5 per scandal
```

Floor of 1 for active orgs; suspended orgs get 0. So exactly what was asked for: standing grows with how long you've been trusted, shrinks with your scandal record, and reflects reviews. A hospital caught diverting blood votes with a visibly smaller voice in the very next election.

Review scores are the honest weak point. "Online reviews" and audit results are off-chain facts; someone must write them on-chain, and here that someone is the current authority acting as an oracle. That shifts trust rather than eliminating it. A production design would want multiple independent score submitters or a commit-reveal scheme.

## Running it

```
node scripts/compileContract.js BloodOversight
node scripts/04-deployOversight.js        # paste OVERSIGHT_CONTRACT_ID into .env
node demo-oversight.js
```

The demo registers all four orgs with real bonds paid from their own accounts, has the nurse-tagged test and hospital transfer happen, waits out a compressed holding window, fires the stale alert, opens and resolves the investigation (5 HBAR slashed), traces and suspends the nurse, then runs the election, in which the freshly-penalized hospital demonstrably votes with reduced weight.

## Known limitations, named rather than hidden

The stale alert catches diversion that leaves a unit unaccounted for. It does not catch a hospital that fakes a `TRANSFUSED` event and diverts the unit anyway; catching that requires off-chain reconciliation against patient records, which is exactly the kind of random audit the base design doc already said blockchains can't replace. The current authority resolves investigations alone; a production system would want a multi-member panel with majority verdicts. `closeElection` is called by the incumbent, who could stall; a deadline-based auto-close fixes that. And all four demo orgs are funded testnet accounts controlled by one person, which demonstrates the mechanics, not the politics, of a real multi-party deployment.
