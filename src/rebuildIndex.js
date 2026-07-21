// src/rebuildIndex.js
//
// Makes the "data/index.json is a disposable cache" claim actually true.
// The local index mirrors on-chain events for fast reads, but if it is
// lost, stale, or tampered with, THIS is the recovery path: replay every
// HCS message from the mirror node, in consensus order, and rebuild the
// same unit records the live code would have written.
//
// Two modes:
//   rebuild - reconstruct the index from chain history and overwrite the file
//   check   - reconstruct in memory only, diff against the local file, and
//             report drift without writing anything. This is the audit
//             answer to "how do you know your cache matches the ledger?"
//
// The status reducer below deliberately mirrors the transitions the live
// functions write (mintUnit, submitTestResult, transferCustody, closeUnit,
// flagBatch, checkStaleUnits). If you add a new eventType, add it here too.

import { getTopicMessages } from "./mirrorNode.js";
import { allUnits, replaceAllUnits } from "./localIndex.js";

/** Mirror-node consensus timestamp ("1700000000.123456789") -> ISO string. */
function consensusToIso(ts) {
  return new Date(Number(ts.split(".")[0]) * 1000).toISOString();
}

/** Apply one HCS event to the in-memory units map. Order = consensus order. */
function applyEvent(units, event, consensusTimestamp) {
  const serial = event.unitId;
  if (!serial) return;
  const unit = units[serial] || { serial };
  const at = consensusToIso(consensusTimestamp);

  switch (event.eventType) {
    case "COLLECTED":
      Object.assign(unit, {
        donorBatchId: event.donorBatchId,
        collectionCenterId: event.collectionCenterId,
        status: "collected",
        holder: "blood_bank",
        mintedAt: at,
      });
      break;
    case "TEST_RESULT":
      Object.assign(unit, {
        status: event.passed ? "tested_pass" : "tested_fail",
        testType: event.testType,
        staffId: event.staffId,
        testedAt: at,
      });
      break;
    case "CUSTODY_TRANSFER":
      Object.assign(unit, { status: "in_transit", holder: event.to, heldSince: at });
      break;
    case "TRANSFER_BLOCKED":
      unit.status = "transfer_blocked";
      break;
    case "TRANSFUSED":
    case "DISPOSED":
      Object.assign(unit, {
        status: "closed",
        closeReason: event.eventType === "TRANSFUSED" ? "transfused" : "disposed",
        closedAt: at,
      });
      break;
    case "FLAGGED":
      Object.assign(unit, { status: "quarantined", flagReason: event.reason });
      break;
    case "BATCH_ALERT":
      Object.assign(unit, { status: "quarantined", flagReason: event.reason });
      break;
    case "POST_USE_ALERT":
      // Unit was already used when its batch got flagged - keep closed
      // status, record the alert (mirrors flagBatch's alreadyUsed branch).
      unit.flagReason = event.reason;
      break;
    case "STALE_ALERT":
      unit.status = "stale_alert";
      break;
    default:
      // Oversight bookkeeping events (INVESTIGATION_OPENED, PENALTY_APPLIED,
      // STAFF_SUSPENDED, AUTHORITY_ELECTED, ORG_REINSTATED...) don't change
      // a unit's custody status; they're readable straight off the topic.
      break;
  }

  units[serial] = unit;
}

/** Rebuild the unit map purely from chain history. Nothing local is read. */
export async function rebuildFromChain(topicId) {
  const messages = await getTopicMessages(topicId);
  const units = {};
  let skipped = 0;
  for (const m of messages) {
    let event;
    try {
      event = JSON.parse(m.content);
    } catch {
      skipped += 1; // a non-JSON message on the topic is not ours to interpret
      continue;
    }
    applyEvent(units, event, m.consensusTimestamp);
  }
  return { units, messageCount: messages.length, skipped };
}

/**
 * Diff the current local index against a chain rebuild. Returns a list of
 * human-readable discrepancies; empty list = no drift.
 */
export async function checkDrift(topicId) {
  const { units: chainUnits, messageCount } = await rebuildFromChain(topicId);
  const localUnits = Object.fromEntries(allUnits().map((u) => [u.serial, u]));
  const drift = [];

  const COMPARED_FIELDS = ["status", "holder", "donorBatchId", "closeReason", "staffId"];
  const serials = new Set([...Object.keys(chainUnits), ...Object.keys(localUnits)]);

  for (const serial of serials) {
    const chain = chainUnits[serial];
    const local = localUnits[serial];
    if (!chain) {
      drift.push(`unit #${serial}: exists locally but has no on-chain history (local-only write?)`);
      continue;
    }
    if (!local) {
      drift.push(`unit #${serial}: on-chain but missing locally (index is stale)`);
      continue;
    }
    for (const field of COMPARED_FIELDS) {
      if (chain[field] !== undefined && local[field] !== chain[field]) {
        drift.push(
          `unit #${serial}: ${field} is "${local[field]}" locally but chain history says "${chain[field]}"`
        );
      }
    }
  }

  return { drift, chainUnitCount: Object.keys(chainUnits).length, messageCount };
}

/** Rebuild and overwrite data/index.json from chain history. */
export async function rebuildAndSave(topicId) {
  const { units, messageCount, skipped } = await rebuildFromChain(topicId);
  replaceAllUnits(units);
  return { unitCount: Object.keys(units).length, messageCount, skipped };
}
