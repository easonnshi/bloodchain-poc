// Lab dashboard. The identity card at the top is the point of this view:
// results are signed by the lab's own key, accepted only because the gate
// contract's owner ran authorizeLab() for this address - the trust model is
// on-chain, not an assumption in JavaScript.

import React, { useState } from "react";
import { useStore } from "../lib/store.jsx";
import UnitTable from "../components/UnitTable.jsx";
import { ActionButton, Field, inputCls, Badge } from "../components/ui.jsx";
import { hashscan } from "../lib/hashscan.js";
import { VerifyLink } from "../components/ui.jsx";

const STAFF = ["TECH-201", "NURSE-114", "STAFF-UNRECORDED"];

export default function Lab() {
  const { units, actions, config, isSim } = useStore();
  const [staffId, setStaffId] = useState(STAFF[0]);
  const [testType, setTestType] = useState("infectious_disease_panel");

  const untested = units.filter((u) => u.status === "collected");
  const tested = units.filter((u) => ["tested_pass", "tested_fail"].includes(u.status));

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1200px]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Testing Lab</h1>
          <p className="mt-1 text-sm text-ink-2 max-w-xl">
            Pass/fail verdicts recorded here are what the gate contract enforces. A unit without a
            <span className="ledger text-xs"> Passed</span> record physically cannot be transferred.
          </p>
        </div>
        {/* identity card */}
        <div className="panel-2 px-3.5 py-2.5 text-xs space-y-1">
          <div className="overline">Signing identity</div>
          <div className="ledger text-ink-2">account {config?.accounts?.LAB ?? "—"}</div>
          <Badge tone="ledger" icon="✓" title="authorizeLab() was called for this address by the contract owner (scripts/05-authorizeLab.js)">
            authorized on gate contract
          </Badge>
          {!isSim && config?.contractId && (
            <VerifyLink href={hashscan.contract(config.contractId)} muted>
              gate {config.contractId}
            </VerifyLink>
          )}
        </div>
      </header>

      <div className="panel p-4 space-y-3">
        <div className="overline">Awaiting test ({untested.length})</div>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="staff (nurse/technician)">
            <select className={inputCls} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {STAFF.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="panel">
            <select className={inputCls} value={testType} onChange={(e) => setTestType(e.target.value)}>
              <option value="infectious_disease_panel">infectious_disease_panel</option>
              <option value="HIV">HIV</option>
              <option value="hepatitis_panel">hepatitis_panel</option>
            </select>
          </Field>
          <p className="text-[11px] text-ink-3 max-w-xs leading-4">
            The staff ID is recorded with every result — if a unit is ever implicated, "who tested
            it?" is one lookup in its permanent history.
          </p>
        </div>
        <UnitTable
          units={untested}
          emptyLabel="no units awaiting tests"
          actions={(u) => (
            <div className="flex gap-1.5 whitespace-nowrap">
              <ActionButton small tone="good" onClick={() => actions.submitTest(u.serial, true, staffId, testType)}>
                ✓
              </ActionButton>
              <ActionButton small tone="critical" onClick={() => actions.submitTest(u.serial, false, staffId, testType)}>
                ✕
              </ActionButton>
            </div>
          )}
        />
      </div>

      <div className="panel p-4">
        <div className="overline mb-3">Recent verdicts</div>
        <UnitTable units={tested} emptyLabel="no verdicts yet" />
      </div>
    </div>
  );
}
