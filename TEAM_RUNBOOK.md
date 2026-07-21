# Team runbook: get BloodChain running on your machine

Follow-the-steps only. For *why* anything works the way it does, read
[PROJECT_EXPLAINER.md](PROJECT_EXPLAINER.md). Time budget: ~10 minutes to
a running app.

## 1. Prerequisites

- **Node.js 18 or newer** (`node --version` — the project was verified on
  v22). Installing Node also installs npm.
- **git**.
- No Hedera account needed for simulation mode or for read-only
  verification. Live actions need keys — see step 4.

## 2. Get the code

```
git clone https://github.com/easonnshi/bloodchain-poc
cd bloodchain-poc
```

If the final-submission work hasn't been merged to `main` yet, switch to
the PR branch instead (ask in the group chat which one is current):

```
git checkout <branch-name>
```

## 3. Install dependencies (two installs — root AND frontend)

```
npm install
cd frontend && npm install && cd ..
```

`npm install` at the root will report ~10 vulnerabilities — **this is
expected and documented** (see "Dependency security" in README.md). Do
NOT run `npm audit fix --force`; it would downgrade solc and break
contract compilation.

## 4. Set up `.env`

```
cp .env.example .env        # macOS/Linux
copy .env.example .env      # Windows cmd
```

We share **one already-deployed testnet instance** — do NOT run the
deploy scripts (01–05) yourself; that would create a second, parallel
deployment and split the team's data. Point your `.env` at the shared
IDs below.

**The four shared deployment IDs (public information, safe to paste):**

```
HEDERA_NETWORK=testnet

TOKEN_ID=0.0.9663839
TOPIC_ID=0.0.9663848
CONTRACT_ID=0.0.9663858
OVERSIGHT_CONTRACT_ID=0.0.9663881
```

Then pick your option:

**Option A — no keys (read-only + simulation).** Stop here; leave the
account/key lines from `.env.example` untouched (placeholders). You get:
the full frontend in SIMULATION mode for actions, plus fully *live*
verification of everything already on-chain via HashScan and the mirror
node (step 7 works with no keys at all). This is enough for exploring,
development, and writing.

**Option B — live actions (needs real keys).** Add the four account
blocks below. The account IDs are public; **the private keys are NOT in
this document** (it lives in git) — request them from the setup lead via
a private channel (password manager share or DM, never a commit):

```
OPERATOR_ID=0.0.9628733
OPERATOR_KEY=<ask the setup lead — DER-encoded ECDSA key, starts with 3030…>

LAB_ACCOUNT_ID=0.0.9637911
LAB_ACCOUNT_KEY=<ask the setup lead>

HOSPITAL_ACCOUNT_ID=0.0.9638100
HOSPITAL_ACCOUNT_KEY=<ask the setup lead>

TRANSPORT_ACCOUNT_ID=0.0.9642712
TRANSPORT_ACCOUNT_KEY=<ask the setup lead>
```

Sanity check either way: `.env` must be gitignored. `git check-ignore
.env` should print `.env`. Never commit it.

**Option B only — populate your local cache from the chain:**

```
npm run rebuild-index
```

(`data/index.json` isn't in git; this rebuilds it from the topic's full
on-chain history so your dashboards aren't empty. Takes a few seconds.)

## 5. Run it

Two terminals:

```
# terminal 1 (repo root) — the API server that holds the keys
npm run server

# terminal 2 — the frontend
cd frontend
npm run dev
```

Open **http://localhost:5173**. Look at the badge in the top-left of the
header — it tells you which mode you're in:

- **`HEDERA TESTNET — LIVE`** (green): the server found real credentials.
  Every button fires a real signed testnet transaction; the event feed is
  the actual mirror node.
- **`SIMULATION`** (amber): no credentials (Option A) or the server isn't
  running. The whole UI works against an in-memory engine with the same
  rules — nothing touches the chain, and the UI never pretends otherwise
  (events say "not sealed").

To switch from SIMULATION to LIVE: fill `.env` (Option B), restart
`npm run server`, then **reload the browser page** (mode is decided at
page load).

## 6. Guided tour — one thing to try in each view

- **Overview** — the live custody map and consensus feed. *Try:* in
  SIMULATION mode, click **▶ Play the full story** and just watch: mint,
  a blocked transfer (the shield flashes), a batch recall cascading into
  the quarantine bay, a bond slash, an election. This is the
  presentation's backbone.
- **Trace a unit** — the public custody trail. *Try:* enter serial `1`
  (in LIVE mode). You'll see its real history — collected, tested by the
  lab, transferred, then caught by a batch alert — each event with a
  nanosecond consensus timestamp and a "verify tx" link.
- **Blood Bank** — mint + monitor. *Try (LIVE):* mint a unit — a real
  NFT appears with the next serial. Then click **Audit cache vs ledger**
  and watch it confirm your local cache matches on-chain history.
- **Lab** — pass/fail verdicts, signed by the lab's own key (the identity
  card at the top shows the authorized account). *Try:* fail a unit on
  purpose, then go to Hospital/Transport and try to ship it.
- **Hospital / Transport** — transfers and closures. *Try:* transfer the
  unit you just failed — the contract refuses, and a permanent
  `TRANSFER_BLOCKED` event appears in the feed. That refusal is the
  project's core claim, demonstrated.
- **Oversight DAO** — bonds, scandals, vote weights, investigations,
  elections. *Try:* note the hospital's card — bond 8 ℏ (slashed), one
  scandal dot, vote weight visibly lower than its peers. That's the
  live aftermath of the demo's investigation.
- **Reconciliation** — the diversion-gap exhibit. *Try:* click **Run
  reconciliation** — one unit is flagged "on-chain, no patient record":
  the exact signature of a faked transfusion event. (Patient records are
  mock data, clearly labeled.)
- **Explainer** — a 6-step animated storyboard (arrow keys advance).
  Built to be projected during the presentation.

## 7. Verify it's real, yourself (no keys, no trust in us)

Everything the UI claims can be checked on public infrastructure:

1. Open **https://hashscan.io/testnet/topic/0.0.9663848** — the full
   custody event log, every message timestamped by network consensus.
   Click any message to decode the JSON payload.
2. Open **https://hashscan.io/testnet/token/0.0.9663839** — the BLOOD
   token, every serial ever minted and who holds it right now.
3. In the app, open **Trace → unit 1** and click any event's
   **verify tx ⧉** link — HashScan shows the exact transaction (type
   `SUBMIT MESSAGE`, status `SUCCESS`, the paying account, the fee).
4. The contracts: **…/contract/0.0.9663858** (gate) and
   **…/contract/0.0.9663881** (oversight).
5. Raw API, if you prefer curl:
   `https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9663848/messages?limit=5&order=desc`
   (messages are base64-encoded JSON).

If HashScan says it happened, it happened — we can't edit that page, and
neither can anyone else. That's the argument the whole project makes.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Header says **SIMULATION** but you expected LIVE | API server not running, or `.env` incomplete | Start `npm run server` in the repo root; its first log line tells you whether it found credentials. Then reload the browser page. All four of OPERATOR_ID/KEY + TOKEN_ID + TOPIC_ID + CONTRACT_ID must be set. |
| `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` on a transfer | The receiving account never opted in to the token | One-time fix: `node scripts/registerAllParties.js`. (Already done for the four shared accounts — you'd only see this with a *new* account.) |
| `submitTestResult reverted … not an authorized lab` | The signing account isn't authorized on the gate contract | Already done for the shared lab account. If you deployed your *own* contract, run `node scripts/05-authorizeLab.js` once as the deployer. |
| `INSUFFICIENT_PAYER_BALANCE` | The signing account ran out of testnet HBAR | Top it up free at the Hedera portal faucet (portal.hedera.com). The oversight demo needs ~15 ℏ per account; keep ≥ 50 ℏ. |
| `INVALID_SIGNATURE` at precheck | A key in `.env` doesn't match its account ID | Re-copy the exact ID/key pair from the setup lead — most often a key pasted next to the wrong account. |
| Mirror-node views empty right after an action | Mirror nodes lag consensus by a few seconds | Wait ~5–10 s; the feed polls automatically. |
| Dashboards empty in LIVE mode on a fresh clone | Local cache (`data/index.json`) isn't in git | `npm run rebuild-index` — rebuilds it from on-chain history. |
| Everything fails / IDs 404 on HashScan | Hedera **testnet was reset** (happens periodically) | Redeploy: scripts 01→05 + 04 in README order (~10 min), share the four new IDs with the team, everyone updates `.env`. |
| `npm audit` shows vulnerabilities | Known and documented | Leave them. See README "Dependency security". Never `npm audit fix --force`. |

## 9. Where the other docs are

- **[COURSE_ANSWERS.md](COURSE_ANSWERS.md)** — presentation-ready answers
  to the deck's required questions (uniqueness + the four discussion
  points). Use these to build slides; cross-check against the professor's
  original deck first.
- **[AUDIT_NOTES.md](AUDIT_NOTES.md)** — the security/correctness audit:
  what was fixed, what was checked and found sound, and what was
  deliberately left with reasons. Strong material for the "challenges and
  limitations" part of the presentation.
- **[PROJECT_EXPLAINER.md](PROJECT_EXPLAINER.md)** — the full A-to-Z
  technical reference (start here if any term in the app is unfamiliar).
- **[CHANGES.md](CHANGES.md)** — the PR-sized summary of everything that
  changed between the original POC and this submission.
- **[README.md](README.md)** — the build-order walkthrough of the backend
  plus full setup-from-scratch instructions (only needed if you're
  redeploying, e.g. after a testnet reset).
