# Backend audit notes

A correctness/security pass over the whole backend (both contracts, all of
`src/`, `scripts/`, demos, tests), done before building the frontend on top
of it. Same policy as `OVERSIGHT.md`: what was found is named, what was fixed
is listed, and what was deliberately left alone is explained rather than
hidden.

## Fixed

**1. `transferCustody()` logged false fraud signals.** Any error from the
clearance-check receipt — including a network failure or an expired
transaction — was treated as "the contract blocked this unit" and written to
HCS as a permanent `TRANSFER_BLOCKED` event. That poisons the audit trail
with false positives. Now only an actual `CONTRACT_REVERT_EXECUTED` status
counts as a block; infrastructure errors are rethrown to the caller
(`src/transferCustody.js`).

**2. `authorizeLab()` existed but was never exercised.** Test results were
submitted by the operator account, which the contract trusts only because it
deployed it. Now `scripts/05-authorizeLab.js` authorizes the lab's own EVM
address once at setup, and every demo/test/API call submits results signed by
the **lab's own key** — so `onlyAuthorizedLab` checks a real third-party
`msg.sender`, and the on-chain `TestResultRecorded` event attributes the
result to the actual lab. The trust model is enforced, not assumed.

**3. "Rebuild the index from the chain" was a claim with no code behind it.**
`README.md` and code comments said `data/index.json` is a disposable cache
that `mirrorNode.js` can reconstruct — but no reconstruction existed. If the
JSON file were lost or tampered with, `flagBatch()` (sibling lookup) and
`checkStaleUnits()` (diversion detection) would silently degrade.
`scripts/rebuildIndex.js` now replays the full HCS topic in consensus order
to rebuild the index, and `--check` mode diffs local state against chain
history read-only and exits non-zero on drift — the operational answer to
"how do you know your cache matches the ledger?"

**4. README vote-weight formula was wrong.** Said −5 per scandal; the
contract (`voteWeight()` in `BloodOversight.sol`) and `OVERSIGHT.md` both use
−2. The contract is the source of truth; README corrected.

**5. Dependency vulnerabilities.** 13 → 10, with the critical
(`protobufjs` code execution) and both high `@grpc/grpc-js` crash bugs fixed
via scoped `overrides`. The remaining 10 have no upstream fix or are
dev-tooling-only; full reasoning in README's "Dependency security" section.

## Checked and found sound

- **Reentrancy:** neither contract makes external calls in state-changing
  paths (`BloodOversight` never transfers HBAR out — slashed funds only
  accumulate), so there is no reentrancy surface. Solidity ^0.8 checked
  arithmetic covers over/underflow.
- **Access control:** `onlyOwner` / `onlyAuthorizedLab` on the gate;
  `onlyAuthority` / `onlyRegistered` on oversight; suspension checks on
  candidates, voters, and investigation-openers are all present and correct.
  `requireClearance()` is callable by anyone, but all it can do is emit an
  event or revert — nothing to abuse.
- **Election logic:** double-vote prevention per election ID, weight floor
  behavior, suspended-org exclusion, and the authority handover on
  `closeElection()` all behave as documented. Ties go to the earlier-listed
  candidate (`>` not `>=`) — acceptable and now documented.
- **Demo-timeline parameters:** `STALE_THRESHOLD_DAYS=10` (production) with
  a seconds-scale override for demos; 20% max slash per case on a 10 HBAR
  minimum bond (so the demo's 2 HBAR request is exactly the cap);
  suspension only at 5 scandals or bond < 2.5 HBAR. Sensible for both the
  demo and the story it tells: graduated punishment, not instant ruin.

## Known issues deliberately left, and why

These would all require contract changes → redeploys → every teammate
updating four `.env` IDs, for issues that don't affect the POC's claims.
Named here instead, in the design doc's own spirit:

1. **Bonds can never be withdrawn.** There is no exit path: a clean org
   that wants to leave the consortium forfeits its bond, and the slashed
   "insurance pool" has no payout function either. A production contract
   needs `withdrawBond()` with a notice period, and governance over the
   pool. Left as-is: the POC's story is about slashing, not exits.
2. **No `revokeLab()`.** Lab authorization is one-way; a compromised lab
   key could keep submitting results. Production wants revocation plus,
   ideally, the gate contract consulting the oversight contract's
   suspension state (see #4).
3. **An authorized lab can overwrite its own result** — including
   Failed → Passed, with no history in contract storage (the earlier
   `TestResultRecorded` event and the HCS log do preserve the flip, so it
   is *detectable*, just not *prevented*). A production gate would make
   results write-once or require the oversight authority to unlock a
   resubmission. This is one instance of the design doc's honest limit:
   the chain proves what was recorded, not that the record was true.
4. **The two contracts don't know about each other.** Staff suspension
   lives in `BloodOversight`, but `BloodUnitGate` doesn't check it — a
   suspended nurse's results are rejectable off-chain, not rejected
   on-chain. Wiring the gate to query the oversight contract
   (cross-contract call) is the natural next step and is out of POC scope.
5. **`data/index.json` writes are not concurrency-safe.** The API server
   and CLI scripts doing simultaneous writes could last-write-wins clobber
   each other. Harmless at demo scale, self-healing via
   `rebuildIndex.js`, and the file's own header says the fix (SQLite swap)
   is a one-file change. Not worth taking that churn now.
6. **HCS events are all submitted under the operator's topic key.** The
   *contract* calls are signed per-party now, but the topic has a single
   submitKey, so HCS messages are attested by the platform operator, not
   by the acting party. The per-party attribution that matters
   (test results) lives in the contract events, which do carry
   `msg.sender`. Multi-key or per-party topics are a production concern.
