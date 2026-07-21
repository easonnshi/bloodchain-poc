// Reconciliation: the honest answer to the design doc's named "diversion
// gap." A hospital that fakes a TRANSFUSED event defeats the chain - the
// ledger records what was CLAIMED, not what happened in the ward. The
// countermeasure is exactly this: cross-check the chain's TRANSFUSED events
// against an independent system of record (patient records). This mock
// demonstrates the mechanism with fabricated records; the real integration
// is future work and named as such.

import React, { useState } from "react";
import { motion } from "framer-motion";
import { useStore } from "../lib/store.jsx";
import { ActionButton, Badge, Empty } from "../components/ui.jsx";
import { consensusShort } from "../lib/format.js";
import { Link } from "react-router-dom";

// Fabricated hospital patient-record extract (what an EHR export would give
// an auditor). Patient identifiers are already redacted on the hospital side.
const PATIENT_RECORDS = [
  { recordId: "EHR-20260718-114", patientRef: "PT-••41", unitId: "101", ward: "ICU-2" },
  { recordId: "EHR-20260716-093", patientRef: "PT-••87", unitId: "94", ward: "SURG-1" },
];

export default function Reconcile() {
  const { events } = useStore();
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(null);
    await new Promise((r) => setTimeout(r, 900)); // audits take a beat
    const transfused = events.filter((e) => e.eventType === "TRANSFUSED");
    const matched = [];
    const diversionSuspects = [];
    const paperOnly = [];

    for (const ev of transfused) {
      const rec = PATIENT_RECORDS.find((r) => r.unitId === ev.unitId);
      if (rec) matched.push({ ev, rec });
      else diversionSuspects.push(ev);
    }
    for (const rec of PATIENT_RECORDS) {
      if (!transfused.some((e) => e.unitId === rec.unitId)) paperOnly.push(rec);
    }
    setResult({ matched, diversionSuspects, paperOnly, total: transfused.length });
    setRunning(false);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Reconciliation audit</h1>
        <p className="mt-1 text-sm text-ink-2 max-w-2xl">
          The chain proves a <span className="ledger text-xs">TRANSFUSED</span> event was logged and
          never altered — not that a transfusion happened. Closing that gap takes an independent
          record: cross-check every on-chain transfusion against the hospital's patient records.
        </p>
        <p className="mt-1 text-xs text-warn">
          ⚠ Mock demonstration: patient records below are fabricated for the POC. The mechanism is
          real; the integration is named future work.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <ActionButton tone="primary" onClick={run} disabled={running}>
          {running ? "cross-checking…" : "Run reconciliation"}
        </ActionButton>
        <span className="text-xs text-ink-3">
          {PATIENT_RECORDS.length} patient records · chain events read live
        </span>
      </div>

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="good" icon="✓">{result.matched.length} matched</Badge>
            <Badge tone="critical" icon="⚠">{result.diversionSuspects.length} on-chain, no patient record</Badge>
            <Badge tone="warn" icon="⌁">{result.paperOnly.length} paper-only</Badge>
          </div>

          {result.diversionSuspects.length > 0 && (
            <div className="panel border-critical/40 p-4 space-y-2">
              <div className="overline text-critical">Diversion suspects — investigate</div>
              {result.diversionSuspects.map((ev) => (
                <div key={ev.unitId} className="flex flex-wrap items-center gap-3 text-sm">
                  <Link to={`/trace/${ev.unitId}`} className="ledger text-ink hover:text-ledger">
                    unit #{ev.unitId}
                  </Link>
                  <span className="text-xs text-ink-2">
                    chain says transfused at <span className="ledger">{consensusShort(ev.consensusTimestamp)}</span> —
                    no patient record matches
                  </span>
                  <span className="text-[11px] text-critical">
                    the exact signature of a faked closing event
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="panel p-4 space-y-2">
            <div className="overline">Matched</div>
            {result.matched.length === 0 && <Empty>none</Empty>}
            {result.matched.map(({ ev, rec }) => (
              <div key={rec.recordId} className="flex flex-wrap items-center gap-3 text-sm">
                <Link to={`/trace/${ev.unitId}`} className="ledger text-ink hover:text-ledger">
                  unit #{ev.unitId}
                </Link>
                <span className="text-xs text-ink-2">
                  {rec.recordId} · patient {rec.patientRef} · {rec.ward}
                </span>
                <Badge tone="good" icon="✓">chain ↔ record agree</Badge>
              </div>
            ))}
          </div>

          {result.paperOnly.length > 0 && (
            <div className="panel p-4 space-y-2">
              <div className="overline text-warn">Paper-only records</div>
              {result.paperOnly.map((rec) => (
                <div key={rec.recordId} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="ledger text-ink">unit #{rec.unitId}</span>
                  <span className="text-xs text-ink-2">
                    {rec.recordId} claims a transfusion — the ledger has no such event
                  </span>
                  <span className="text-[11px] text-warn">unit unknown to the chain or never closed</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
