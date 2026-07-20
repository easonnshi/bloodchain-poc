// src/flagBatch.js
//
// The recall mechanism. One bad unit found (contaminated, mislabeled)
// should not require someone to manually remember and hunt down every
// other unit from the same donation - this does it in one call, the same
// way a product recall pulls every unit from an affected production run.
//
// Reads from the local index for speed. For an audit, you'd rebuild the
// same batch list straight from mirror-node HCS history (src/mirrorNode.js)
// and diff it against the local index to confirm nothing was missed or
// tampered with locally.

import { getUnitsByBatch, upsertUnit, getUnit } from "./localIndex.js";
import { logEvent } from "./logEvent.js";

/**
 * @param {object} params
 * @param {string} params.topicId
 * @param {string} params.serial - the unit that was flagged (failed test, contamination report, etc.)
 * @param {string} params.reason
 */
export async function flagBatch({ topicId, serial, reason }) {
  const flaggedUnit = getUnit(serial);
  if (!flaggedUnit) throw new Error(`Unknown unit #${serial}`);

  const siblings = getUnitsByBatch(flaggedUnit.donorBatchId).filter((u) => u.serial !== serial);

  upsertUnit(serial, { status: "quarantined", flagReason: reason });
  await logEvent(topicId, {
    unitId: serial,
    eventType: "FLAGGED",
    reason,
    donorBatchId: flaggedUnit.donorBatchId,
  });

  for (const sibling of siblings) {
    const alreadyUsed = sibling.status === "closed";
    const note = alreadyUsed
      ? `sibling unit #${serial} in the same donation batch was flagged after this unit was already ${sibling.closeReason || "closed"} - patient follow-up may be needed`
      : `sibling of #${serial}: ${reason}`;
    
    upsertUnit(sibling.serial, {
      ...(alreadyUsed ? {} : { status: "quarantined" }), // can't quarantine blood already used
      flagReason: note,
    });
    await logEvent(topicId, {
      unitId: sibling.serial,
      eventType: alreadyUsed ? "POST_USE_ALERT" : "BATCH_ALERT",
      reason: note,
      donorBatchId: flaggedUnit.donorBatchId,
    });
    console.log(
      alreadyUsed
        ? `  -> sibling unit #${sibling.serial} was already ${sibling.closeReason || "closed"} - flagged for patient follow-up`
        : `  -> also quarantined sibling unit #${sibling.serial}`
    );
  }

  console.log(
    `Unit #${serial} flagged (${reason}). ${siblings.length} sibling unit(s) from batch ${flaggedUnit.donorBatchId} processed.`
  );
  return { flagged: serial, quarantinedSiblings: siblings.map((s) => s.serial) };
}
