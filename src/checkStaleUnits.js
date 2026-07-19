// src/checkStaleUnits.js
//
// The detection half of the anti-diversion design. The chain cannot see a
// hospital secretly handing a unit to someone else. What it CAN see is
// what should have happened but didn't: a unit transferred to a holder,
// then no transfusion, disposal, or onward transfer logged within the
// allowed window. That silence is the red flag.
//
// In production this runs on a schedule (daily cron). The threshold comes
// from STALE_THRESHOLD_DAYS in .env (default 10); demos pass a threshold
// of a few seconds so nobody waits 10 days to see it fire.

import { allUnits, upsertUnit } from "./localIndex.js";
import { logEvent } from "./logEvent.js";

const TERMINAL_STATUSES = new Set(["closed", "quarantined", "stale_alert"]);

/**
 * @param {object} params
 * @param {string} params.topicId
 * @param {number} [params.thresholdMs] - override for demos; defaults to STALE_THRESHOLD_DAYS from .env
 * @returns {Promise<object[]>} the units that were flagged stale
 */
export async function checkStaleUnits({ topicId, thresholdMs }) {
  const days = Number(process.env.STALE_THRESHOLD_DAYS || 10);
  const limit = thresholdMs ?? days * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const stale = allUnits().filter(
    (u) =>
      !TERMINAL_STATUSES.has(u.status) &&
      u.holder &&
      u.holder !== "blood_bank" &&
      u.heldSince &&
      now - Date.parse(u.heldSince) > limit
  );

  for (const unit of stale) {
    upsertUnit(unit.serial, { status: "stale_alert" });
    await logEvent(topicId, {
      unitId: unit.serial,
      eventType: "STALE_ALERT",
      holder: unit.holder,
      heldSince: unit.heldSince,
      thresholdMs: limit,
      note: "no transfusion/disposal/transfer logged within holding window",
    });
    console.log(
      `STALE: unit #${unit.serial} held by ${unit.holder} since ${unit.heldSince} with no closing event.`
    );
  }

  if (stale.length === 0) console.log("No stale units found.");
  return stale;
}
