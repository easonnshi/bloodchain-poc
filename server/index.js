// server/index.js
//
// Thin local API in front of the existing src/ functions, for the frontend.
//
// WHY THIS EXISTS: private keys cannot live in a browser safely. Every
// state-changing action (mint, test, transfer, close, flag, oversight calls)
// happens here, signed with the same .env keys the CLI scripts use. The
// frontend only ever sees account IDs and results. Read-only views (custody
// trails, HCS history) don't come through here at all - the frontend reads
// the public mirror node REST API directly, because that's the point of a
// public ledger: you don't need our server to verify our claims.
//
// The server binds to localhost only. It is a demo convenience, not a
// hardened gateway - do not port-forward it.
//
//   node server/index.js     (or: npm run server)
//
// Boots even with an unconfigured .env: /api/config then reports
// configured:false and the frontend falls back to simulation mode, so the
// UI can be developed and graded without testnet credentials.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env.API_PORT || 4000);
const app = express();
app.use(express.json());
// The Vite dev server (5173) and vite preview (4173) are the only callers.
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));

const ENV = () => ({
  network: process.env.HEDERA_NETWORK || "testnet",
  tokenId: process.env.TOKEN_ID || null,
  topicId: process.env.TOPIC_ID || null,
  contractId: process.env.CONTRACT_ID || null,
  oversightContractId: process.env.OVERSIGHT_CONTRACT_ID || null,
  operatorId: process.env.OPERATOR_ID || null,
  accounts: {
    BANK: process.env.OPERATOR_ID || null,
    LAB: process.env.LAB_ACCOUNT_ID || null,
    HOSPITAL: process.env.HOSPITAL_ACCOUNT_ID || null,
    TRANSPORT: process.env.TRANSPORT_ACCOUNT_ID || null,
  },
});

function isConfigured() {
  const e = ENV();
  return Boolean(
    e.operatorId &&
      process.env.OPERATOR_KEY &&
      !e.operatorId.includes("x") && // .env.example placeholder 0.0.xxxxxx
      e.tokenId &&
      e.topicId &&
      e.contractId
  );
}

// ---------------------------------------------------------------------------
// Lazy Hedera loading. src/hederaConfig.js throws at import time if the .env
// is missing - correct for CLI scripts, but the server must still boot so
// the frontend can discover the unconfigured state. So all Hedera-touching
// modules are imported on first use, behind a clear 503 if unconfigured.
// ---------------------------------------------------------------------------
let hedera = null;
async function loadHedera() {
  if (hedera) return hedera;
  const [config, mint, test, transfer, close, flag, stale, index, oversight, mirror, rebuild] =
    await Promise.all([
      import("../src/hederaConfig.js"),
      import("../src/mintUnit.js"),
      import("../src/submitTestResult.js"),
      import("../src/transferCustody.js"),
      import("../src/closeUnit.js"),
      import("../src/flagBatch.js"),
      import("../src/checkStaleUnits.js"),
      import("../src/localIndex.js"),
      import("../src/oversight.js"),
      import("../src/mirrorNode.js"),
      import("../src/rebuildIndex.js"),
    ]);

  const parties = {};
  for (const prefix of ["LAB", "HOSPITAL", "TRANSPORT"]) {
    try {
      parties[prefix] = config.makePartyClient(prefix);
    } catch {
      parties[prefix] = null; // party not configured; endpoints that need it will say so
    }
  }

  hedera = { config, mint, test, transfer, close, flag, stale, index, oversight, mirror, rebuild, parties };
  return hedera;
}

/** Resolve a role name to { accountId, privateKey, client } from .env. */
function partyFor(h, role) {
  const r = String(role || "").toUpperCase();
  if (r === "BANK" || r === "BLOOD_BANK") {
    return { accountId: h.config.operatorId, privateKey: h.config.operatorKey, client: undefined };
  }
  const p = h.parties[r];
  if (!p) throw new HttpError(400, `Unknown or unconfigured party role: ${role}`);
  return { accountId: p.accountId, privateKey: p.privateKey, client: p.client };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap an async handler: JSON errors, 503 when Hedera isn't configured. */
function guarded(needsHedera, handler) {
  return async (req, res) => {
    try {
      if (needsHedera && !isConfigured()) {
        throw new HttpError(
          503,
          "Hedera credentials not configured. Fill in .env (see README) - the frontend runs in simulation mode until then."
        );
      }
      const result = await handler(req);
      res.json(result ?? { ok: true });
    } catch (err) {
      // Only HttpError carries an HTTP status; Hedera SDK errors have a
      // .status that is a Hedera Status OBJECT ({_code}) - never pass that
      // to res.status().
      const status = Number.isInteger(err.status) ? err.status : 500;
      if (status >= 500) console.error(`[${req.method} ${req.path}]`, err);
      const message = err.message?.split("\n")[0] || "internal error";
      res.status(status).json({ error: message });
    }
  };
}

// ---------------------------------------------------------------------------
// Config + local index reads (work with or without credentials)
// ---------------------------------------------------------------------------

app.get("/api/config", (req, res) => {
  res.json({ ...ENV(), configured: isConfigured() });
});

app.get(
  "/api/units",
  guarded(false, async () => {
    const { allUnits } = await import("../src/localIndex.js");
    return { units: allUnits() };
  })
);

app.get(
  "/api/units/:serial",
  guarded(false, async (req) => {
    const { getUnit } = await import("../src/localIndex.js");
    const unit = getUnit(req.params.serial);
    if (!unit) throw new HttpError(404, `Unknown unit #${req.params.serial}`);
    return { unit };
  })
);

// Drift audit: local cache vs public ledger, read-only. Needs TOPIC_ID but
// no keys (mirror node is public), so it's guarded on config lightly.
app.get(
  "/api/index/drift",
  guarded(false, async () => {
    const topicId = process.env.TOPIC_ID;
    if (!topicId) throw new HttpError(503, "TOPIC_ID not configured");
    const { checkDrift } = await import("../src/rebuildIndex.js");
    return await checkDrift(topicId);
  })
);

// ---------------------------------------------------------------------------
// Core custody actions (state-changing -> signed server-side)
// ---------------------------------------------------------------------------

app.post(
  "/api/units",
  guarded(true, async (req) => {
    const { donorBatchId, collectionCenterId } = req.body;
    if (!donorBatchId || !collectionCenterId) {
      throw new HttpError(400, "donorBatchId and collectionCenterId are required");
    }
    const h = await loadHedera();
    const e = ENV();
    const serial = await h.mint.mintUnit({
      tokenId: e.tokenId,
      topicId: e.topicId,
      donorBatchId,
      collectionCenterId,
    });
    return { serial, unit: h.index.getUnit(serial) };
  })
);

app.post(
  "/api/units/:serial/test",
  guarded(true, async (req) => {
    const { passed, testType, staffId } = req.body;
    if (typeof passed !== "boolean") throw new HttpError(400, "passed (boolean) is required");
    const h = await loadHedera();
    const e = ENV();
    // Signed by the lab's own key - the whole point of the authorizeLab fix.
    const labClient = h.parties.LAB?.client;
    if (!labClient) throw new HttpError(503, "LAB account not configured in .env");
    const status = await h.test.submitTestResult({
      contractId: e.contractId,
      topicId: e.topicId,
      serial: req.params.serial,
      passed,
      testType,
      staffId,
      client: labClient,
    });
    return { status, unit: h.index.getUnit(req.params.serial) };
  })
);

app.post(
  "/api/units/:serial/transfer",
  guarded(true, async (req) => {
    const { to } = req.body; // "LAB" | "HOSPITAL" | "TRANSPORT" | "BANK"
    const h = await loadHedera();
    const e = ENV();
    const unit = h.index.getUnit(req.params.serial);
    if (!unit) throw new HttpError(404, `Unknown unit #${req.params.serial}`);

    // Sender = current holder per the index; its key must sign the NFT move.
    const holderRole =
      unit.holder === "blood_bank" || unit.holder === e.operatorId
        ? "BANK"
        : Object.entries(ENV().accounts).find(([, id]) => id === unit.holder)?.[0];
    if (!holderRole) {
      throw new HttpError(400, `Current holder ${unit.holder} does not match any configured party`);
    }
    const from = partyFor(h, holderRole);
    const dest = partyFor(h, to);

    const result = await h.transfer.transferCustody({
      contractId: e.contractId,
      topicId: e.topicId,
      tokenId: e.tokenId,
      serial: req.params.serial,
      fromAccountId: from.accountId,
      fromPrivateKey: from.privateKey,
      toAccountId: dest.accountId,
    });
    return { ...result, unit: h.index.getUnit(req.params.serial) };
  })
);

app.post(
  "/api/units/:serial/close",
  guarded(true, async (req) => {
    const { reason } = req.body; // "transfused" | "disposed"
    const h = await loadHedera();
    const e = ENV();
    const unit = h.index.getUnit(req.params.serial);
    if (!unit) throw new HttpError(404, `Unknown unit #${req.params.serial}`);
    const holderId =
      unit.holder === "blood_bank" ? h.config.operatorId : unit.holder;
    await h.close.closeUnit({
      tokenId: e.tokenId,
      topicId: e.topicId,
      serial: req.params.serial,
      holderAccountId: holderId,
      reason: reason === "disposed" ? "disposed" : "transfused",
    });
    return { unit: h.index.getUnit(req.params.serial) };
  })
);

app.post(
  "/api/units/:serial/flag",
  guarded(true, async (req) => {
    const { reason } = req.body;
    if (!reason) throw new HttpError(400, "reason is required");
    const h = await loadHedera();
    const e = ENV();
    const result = await h.flag.flagBatch({
      topicId: e.topicId,
      serial: req.params.serial,
      reason,
    });
    return result;
  })
);

app.post(
  "/api/stale-check",
  guarded(true, async (req) => {
    const h = await loadHedera();
    const e = ENV();
    const stale = await h.stale.checkStaleUnits({
      topicId: e.topicId,
      thresholdMs: req.body?.thresholdMs,
    });
    return { staleUnits: stale };
  })
);

// ---------------------------------------------------------------------------
// Oversight layer
// ---------------------------------------------------------------------------

const ORG_ROLES = ["BANK", "LAB", "HOSPITAL", "TRANSPORT"];

/** EVM addresses change never; resolve once per boot via mirror node. */
let evmCache = null;
async function evmAddresses(h) {
  if (evmCache) return evmCache;
  const entries = await Promise.all(
    ORG_ROLES.map(async (role) => {
      try {
        const { accountId } = partyFor(h, role);
        return [role, await h.mirror.getEvmAddress(accountId)];
      } catch {
        return [role, null];
      }
    })
  );
  evmCache = Object.fromEntries(entries);
  return evmCache;
}

function requireOversight() {
  const id = process.env.OVERSIGHT_CONTRACT_ID;
  if (!id) throw new HttpError(503, "OVERSIGHT_CONTRACT_ID not configured");
  return id;
}

// Full oversight snapshot: authority, per-org bond/scandals/weight, addresses.
app.get(
  "/api/oversight/status",
  guarded(true, async () => {
    const oversightId = requireOversight();
    const h = await loadHedera();
    const addrs = await evmAddresses(h);
    const authority = (await h.oversight.getAuthority({ contractId: oversightId })).toLowerCase();

    const orgs = {};
    for (const role of ORG_ROLES) {
      const addr = addrs[role];
      if (!addr) continue;
      try {
        const status = await h.oversight.getOrgStatus({ contractId: oversightId, orgAddress: addr });
        const weight = await h.oversight.getVoteWeight({ contractId: oversightId, orgAddress: addr });
        orgs[role] = { address: addr, ...status, voteWeight: weight, isAuthority: addr.toLowerCase() === authority };
      } catch {
        orgs[role] = { address: addr, registered: false };
      }
    }
    return { authority, orgs };
  })
);

app.post(
  "/api/oversight/register",
  guarded(true, async (req) => {
    const { role, orgType, bondHbar = 10 } = req.body;
    const oversightId = requireOversight();
    const h = await loadHedera();
    const p = partyFor(h, role);
    const status = await h.oversight.registerOrg({
      contractId: oversightId,
      orgType: h.oversight.OrgType[orgType] ?? orgType,
      bondHbar,
      client: p.client,
    });
    return { status };
  })
);

app.post(
  "/api/oversight/staff",
  guarded(true, async (req) => {
    const { role = "HOSPITAL", staffId } = req.body;
    if (!staffId) throw new HttpError(400, "staffId is required");
    const oversightId = requireOversight();
    const h = await loadHedera();
    const p = partyFor(h, role);
    const status = await h.oversight.registerStaff({ contractId: oversightId, staffId, client: p.client });
    return { status };
  })
);

app.post(
  "/api/oversight/investigations",
  guarded(true, async (req) => {
    const { subjectRole, serial, reason, openedByRole = "BANK" } = req.body;
    const oversightId = requireOversight();
    const h = await loadHedera();
    const addrs = await evmAddresses(h);
    const subjectAddress = addrs[String(subjectRole).toUpperCase()];
    if (!subjectAddress) throw new HttpError(400, `No EVM address for role ${subjectRole}`);
    const opener = partyFor(h, openedByRole);
    const id = await h.oversight.openInvestigation({
      contractId: oversightId,
      subjectAddress,
      serial,
      reason,
      client: opener.client,
    });
    const e = ENV();
    await (await import("../src/logEvent.js")).logEvent(e.topicId, {
      unitId: String(serial),
      eventType: "INVESTIGATION_OPENED",
      investigationId: id,
      subject: subjectRole,
    });
    return { investigationId: id };
  })
);

app.post(
  "/api/oversight/investigations/:id/resolve",
  guarded(true, async (req) => {
    const { guilty, penaltyHbar = 0, authorityRole = "BANK", subjectRole, serial } = req.body;
    const oversightId = requireOversight();
    const h = await loadHedera();
    const authority = partyFor(h, authorityRole);
    const status = await h.oversight.resolveInvestigation({
      contractId: oversightId,
      investigationId: Number(req.params.id),
      guilty,
      penaltyHbar,
      client: authority.client,
    });
    if (serial) {
      const e = ENV();
      await (await import("../src/logEvent.js")).logEvent(e.topicId, {
        unitId: String(serial),
        eventType: "PENALTY_APPLIED",
        investigationId: Number(req.params.id),
        guilty,
        penaltyHbar,
        subject: subjectRole,
      });
    }
    return { status };
  })
);

app.post(
  "/api/oversight/staff/suspend",
  guarded(true, async (req) => {
    const { staffId, authorityRole = "BANK" } = req.body;
    if (!staffId) throw new HttpError(400, "staffId is required");
    const oversightId = requireOversight();
    const h = await loadHedera();
    const authority = partyFor(h, authorityRole);
    const status = await h.oversight.suspendStaff({ contractId: oversightId, staffId, client: authority.client });
    return { status };
  })
);

app.post(
  "/api/oversight/elections",
  guarded(true, async (req) => {
    const { candidateRoles, authorityRole = "BANK" } = req.body;
    const oversightId = requireOversight();
    const h = await loadHedera();
    const addrs = await evmAddresses(h);
    const candidates = (candidateRoles || []).map((r) => addrs[String(r).toUpperCase()]).filter(Boolean);
    if (candidates.length < 2) throw new HttpError(400, "need at least 2 configured candidate roles");
    const authority = partyFor(h, authorityRole);
    const status = await h.oversight.startElection({
      contractId: oversightId,
      candidateAddresses: candidates,
      client: authority.client,
    });
    return { status };
  })
);

app.post(
  "/api/oversight/elections/vote",
  guarded(true, async (req) => {
    const { voterRole, candidateRole } = req.body;
    const oversightId = requireOversight();
    const h = await loadHedera();
    const addrs = await evmAddresses(h);
    const candidateAddress = addrs[String(candidateRole).toUpperCase()];
    if (!candidateAddress) throw new HttpError(400, `No EVM address for role ${candidateRole}`);
    const voter = partyFor(h, voterRole);
    const status = await h.oversight.castVote({ contractId: oversightId, candidateAddress, client: voter.client });
    return { status };
  })
);

app.post(
  "/api/oversight/elections/close",
  guarded(true, async (req) => {
    const { authorityRole = "BANK" } = req.body;
    const oversightId = requireOversight();
    const h = await loadHedera();
    const authority = partyFor(h, authorityRole);
    const status = await h.oversight.closeElection({ contractId: oversightId, client: authority.client });
    const newAuthority = (await h.oversight.getAuthority({ contractId: oversightId })).toLowerCase();
    return { status, newAuthority };
  })
);

// ---------------------------------------------------------------------------

app.listen(PORT, "127.0.0.1", () => {
  const configured = isConfigured();
  console.log(`BloodChain API listening on http://127.0.0.1:${PORT}`);
  console.log(
    configured
      ? "Hedera credentials found - state-changing endpoints are live against testnet."
      : "No Hedera credentials in .env - read endpoints work, actions return 503, frontend will use simulation mode."
  );
});
