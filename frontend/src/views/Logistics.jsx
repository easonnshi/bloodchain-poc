// Hospital / Transport dashboard: initiate custody transfers (the gate
// contract has the final word), close units at end of life, and see what
// the stale monitor sees - the clock on every held unit.

import React, { useState } from "react";
import { useStore } from "../lib/store.jsx";
import UnitTable from "../components/UnitTable.jsx";
import { ActionButton, Field, inputCls, Badge } from "../components/ui.jsx";
import { timeAgo } from "../lib/format.js";

const DESTS = ["LAB", "TRANSPORT", "HOSPITAL"];

export default function Logistics() {
  const { units, actions, config } = useStore();
  const [dest, setDest] = useState("HOSPITAL");
  const accounts = config?.accounts ?? {};

  const transferable = units.filter((u) => ["tested_pass", "tested_fail", "collected", "in_transit", "transfer_blocked"].includes(u.status));
  const held = units.filter((u) => ["in_transit", "stale_alert"].includes(u.status));

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1200px]">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Hospital / Transport</h1>
        <p className="mt-1 text-sm text-ink-2 max-w-2xl">
          Every hand-off asks the gate contract first. Note what happens when someone tries to move
          an untested or failed unit — the contract, not this app, refuses.
        </p>
      </header>

      <div className="panel p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="overline flex-1">Initiate custody transfer</div>
          <Field label="destination">
            <select className={inputCls} value={dest} onChange={(e) => setDest(e.target.value)}>
              {DESTS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
        </div>
        <UnitTable
          units={transferable}
          emptyLabel="nothing eligible to move"
          actions={(u) => (
            <ActionButton
              small
              onClick={async () => {
                const res = await actions.transfer(u.serial, dest);
                if (res.blocked) throw new Error("BLOCKED by requireClearance() - no passing test on record");
              }}
            >
              → {dest.toLowerCase()}
            </ActionButton>
          )}
        />
        <p className="text-[11px] text-ink-3">
          Transfers of untested / failed units are attempted on purpose in the demo — the resulting
          <span className="ledger"> TRANSFER_BLOCKED</span> event is the proof the gate works.
        </p>
      </div>

      <div className="panel p-4 space-y-3">
        <div className="overline">In custody — the clock the stale monitor watches</div>
        {held.length === 0 ? (
          <p className="text-sm text-ink-3 py-4 text-center">no units currently held outside the bank</p>
        ) : (
          <div className="space-y-2">
            {held.map((u) => (
              <div key={u.serial} className="panel-2 px-3 py-2.5 flex flex-wrap items-center gap-3">
                <span className="ledger text-sm text-ink">#{u.serial}</span>
                <span className="text-xs text-ink-3">
                  held by{" "}
                  <span className="text-ink-2">
                    {Object.entries(accounts).find(([, id]) => id === u.holder)?.[0] ?? u.holder}
                  </span>{" "}
                  · since {timeAgo(u.heldSince)}
                </span>
                {u.status === "stale_alert" && (
                  <Badge tone="warn" icon="⏱">
                    STALE — silence past holding window
                  </Badge>
                )}
                <div className="flex-1" />
                <ActionButton small tone="good" onClick={() => actions.close(u.serial, "transfused")}>
                  ✓ Transfuse
                </ActionButton>
                <ActionButton small onClick={() => actions.close(u.serial, "disposed")}>
                  ◼ Dispose
                </ActionButton>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-ink-3 leading-4">
          Closing burns the NFT — "does the token still exist" doubles as "is this unit still out
          there." A unit neither transfused nor disposed within the holding window becomes a
          <span className="ledger"> STALE_ALERT</span>: the silence is the fraud signal.
        </p>
      </div>
    </div>
  );
}
