# Changes: POC → final DDiB26 submission

PR-sized summary for the team before merging. Contract sources are
**untouched** — no redeploys needed; existing `.env` IDs keep working.

## Fixes to known issues

1. **README vote-weight formula** corrected (−5 → −2 per scandal, matching
   `BloodOversight.sol`, the source of truth).
2. **npm audit: 13 → 10 vulns.** The critical (`protobufjs` code-exec) and
   both high `@grpc/grpc-js` crash bugs fixed via scoped `overrides` in
   `package.json` (SDK verified working after the bump — real testnet
   round-trip tested). Remaining 10: `elliptic` chain (no patched release
   exists upstream) and `tmp`-via-`solc` (dev-only, our compile path never
   touches it; the "fix" would downgrade solc to 0.5.0). Full reasoning in
   README "Dependency security".
3. **`authorizeLab()` now actually exercised.** New
   `scripts/05-authorizeLab.js` (run once at setup) authorizes the LAB
   account's EVM address on the gate contract; `submitTestResult()` takes a
   `client` param and all demos/tests/API calls now sign test results with
   the **lab's own key**, so `onlyAuthorizedLab` checks a real third-party
   `msg.sender`. On-chain events attribute results to the actual lab.

## Backend audit (see AUDIT_NOTES.md for the full list)

- **Fixed: false fraud signals.** `transferCustody()` treated *any* receipt
  error (network blip, fee issue) as "blocked by contract" and wrote
  `TRANSFER_BLOCKED` to the permanent HCS log. Now only a real
  `CONTRACT_REVERT` counts; infrastructure errors are rethrown.
- **Fixed: the missing rebuild path.** `data/index.json` was claimed to be
  rebuildable from chain history, but no code did it. New
  `npm run rebuild-index` (replay full HCS topic → reconstruct index) and
  `npm run check-index` (read-only drift audit, exit 2 on drift).
- **Checked and sound:** reentrancy (no external calls in either contract),
  access control on all state-changing functions, election logic
  (double-vote, weights, handover), demo-timeline parameters.
- **Deliberately not fixed** (needs contract changes → redeploys; named in
  AUDIT_NOTES.md instead): no bond-withdrawal path, no `revokeLab()`,
  authorized labs can overwrite their own results (detectable via HCS, not
  prevented), gate contract doesn't check oversight's staff suspensions,
  JSON index not concurrency-safe, HCS submit key is operator-only.

## New: API server (`server/`)

Thin Express layer on 127.0.0.1:4000 wrapping the existing `src/`
functions. Holds all keys server-side (browsers never see them); signs as
the correct party per action (lab signs tests, holder signs transfers,
each org signs its own oversight calls). Boots without a configured `.env`
and reports `configured:false` so the frontend can fall back to simulation
mode. `npm run server`.

## New: frontend (`frontend/`)

React 19 + Vite + Tailwind v4, dark "hematology mission control" design.
Two modes, auto-detected: **live** (real transactions via the API server;
reads via the public mirror node) and **simulation** (in-memory engine
under a loud badge, incl. a scripted 12-step "Play the full story" for the
presentation). Views:

- **Overview** — animated custody flow map (units move stations on status
  change, gate flashes on blocks, hatched quarantine bay) + real-time
  consensus feed with per-event seal pulse anchored to actual consensus
  timestamps.
- **Trace** — public per-unit custody trail read directly from the mirror
  node, every event linking to HashScan; QR bag label per unit linking to
  its trace URL; burned-NFT state shown for closed units.
- **Blood Bank** — mint, batch recall, stale sweep, one-click
  cache-vs-ledger drift audit.
- **Lab** — pass/fail verdicts signed by the lab identity (shown on-card).
- **Hospital/Transport** — transfers (gate-enforced), transfuse/dispose,
  held-unit clocks.
- **Oversight DAO** — per-org trust cards (bond bars, scandal dots,
  vote-weight breakdown per the contract formula), investigations
  open/resolve with slashing, staff registry/suspension, weighted election
  with live tally.
- **Reconciliation** — mock patient-record cross-check against TRANSFUSED
  events; demonstrates catching a faked closing event (the "diversion
  gap"). Mock clearly labeled.
- **Explainer** — 6-step animated storyboard for the presentation.

## New docs

- `AUDIT_NOTES.md` — the audit: fixed / sound / deliberately-left.
- `COURSE_ANSWERS.md` — required deck answers (uniqueness + 4 discussion
  points), grounded in the code and the honesty sections.
- README — full end-to-end setup for a stranger (backend, demos, server,
  frontend, team-sharing model).

## Verified

- Both contracts compile; all JS passes syntax checks; frontend production
  build passes; every view exercised in the browser (simulation mode).
- Server verified in both unconfigured (clean 503s) and configured mode —
  the configured test sent a real transaction to testnet with throwaway
  keys and surfaced the node's INVALID_SIGNATURE precheck as clean JSON
  (this also proves the post-override gRPC stack works against real nodes).
- **Not verified here:** a full live run of `demo.js` / `demo-oversight.js`
  with funded accounts — needs the team `.env`. Wiring is proven up to the
  network boundary; run both demos once before submission. Note
  `scripts/05-authorizeLab.js` must run once before `demo.js` (new step).
