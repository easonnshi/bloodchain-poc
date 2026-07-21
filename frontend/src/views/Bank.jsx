// Blood Bank dashboard: mint units, monitor inventory, fire the batch
// recall, run the stale-unit sweep, and audit the local cache against the
// public ledger (drift check).

import React, { useState } from "react";
import { useStore } from "../lib/store.jsx";
import UnitTable from "../components/UnitTable.jsx";
import { ActionButton, Field, inputCls, Badge } from "../components/ui.jsx";

export default function Bank() {
  const { units, actions, isSim } = useStore();
  const [batch, setBatch] = useState(`DON-${new Date().getFullYear().toString().slice(2)}${String(Math.floor(Math.random() * 900) + 100)}`);
  const [center, setCenter] = useState("CTR-ZH-01");
  const [flagSerial, setFlagSerial] = useState("");
  const [flagReason, setFlagReason] = useState("contamination suspected");
  const [lastMint, setLastMint] = useState(null);
  const [drift, setDrift] = useState(null);
  const [staleResult, setStaleResult] = useState(null);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1200px]">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Blood Bank</h1>
        <p className="mt-1 text-sm text-ink-2">
          Treasury of the BLOOD token. Minting turns a physical donation into a ledger entity;
          flagging one bad unit recalls its entire donation batch in one call.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* mint */}
        <div className="panel p-4 space-y-3">
          <div className="overline">Mint a unit (collection intake)</div>
          <Field label="donor batch">
            <input className={`${inputCls} ledger`} value={batch} onChange={(e) => setBatch(e.target.value)} />
          </Field>
          <Field label="collection center">
            <input className={`${inputCls} ledger`} value={center} onChange={(e) => setCenter(e.target.value)} />
          </Field>
          <ActionButton
            tone="primary"
            onClick={async () => {
              const res = await actions.mint(batch, center);
              setLastMint(res.serial);
            }}
          >
            Mint NFT for this donation
          </ActionButton>
          {lastMint && (
            <Badge tone="ledger" icon="✓">
              minted unit #{lastMint}
            </Badge>
          )}
          <p className="text-[11px] text-ink-3 leading-4">
            One <span className="ledger">TokenMintTransaction</span> + one HCS{" "}
            <span className="ledger">COLLECTED</span> event. The serial the network assigns is the
            unit's identity for life.
          </p>
        </div>

        {/* recall */}
        <div className="panel p-4 space-y-3">
          <div className="overline">Batch recall</div>
          <Field label="unit serial to flag">
            <input className={`${inputCls} ledger`} value={flagSerial} onChange={(e) => setFlagSerial(e.target.value)} placeholder="e.g. 105" />
          </Field>
          <Field label="reason">
            <input className={inputCls} value={flagReason} onChange={(e) => setFlagReason(e.target.value)} />
          </Field>
          <ActionButton
            tone="critical"
            onClick={async () => {
              await actions.flag(flagSerial.trim(), flagReason);
            }}
            disabled={!flagSerial.trim()}
          >
            ⚠ Flag unit + quarantine batch
          </ActionButton>
          <p className="text-[11px] text-ink-3 leading-4">
            Every sibling from the same donor batch is quarantined instantly — even units already
            transferred out. Watch the flow map on the overview when this fires.
          </p>
        </div>

        {/* monitors */}
        <div className="panel p-4 space-y-3">
          <div className="overline">Monitors</div>
          <div className="space-y-2">
            <ActionButton
              tone="warn"
              small
              onClick={async () => {
                const res = await actions.staleCheck(isSim ? 36 * 3600_000 : undefined);
                setStaleResult(res.staleUnits.length);
              }}
            >
              Run stale-unit sweep
            </ActionButton>
            {staleResult != null && (
              <div className="text-xs text-ink-2">
                {staleResult === 0 ? "nothing stale" : `${staleResult} unit(s) flagged STALE_ALERT`}
              </div>
            )}
          </div>
          <div className="border-t border-hairline pt-3 space-y-2">
            <ActionButton
              small
              onClick={async () => {
                const res = await actions.drift();
                setDrift(res);
              }}
            >
              Audit cache vs ledger
            </ActionButton>
            {drift && (
              <div className="text-xs">
                {drift.simulated ? (
                  <span className="text-ink-3">simulation — no ledger to audit against</span>
                ) : drift.drift.length === 0 ? (
                  <Badge tone="good" icon="✓">
                    no drift — local index matches {drift.messageCount} on-chain messages
                  </Badge>
                ) : (
                  <div className="space-y-1">
                    <Badge tone="critical" icon="✕">
                      {drift.drift.length} discrepancies
                    </Badge>
                    <ul className="text-ink-2 list-disc ml-4">
                      {drift.drift.slice(0, 5).map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-ink-3 leading-4">
              Rebuilds unit state from HCS history and diffs it against the local cache — the
              on-demand proof that the JSON index is disposable and the chain is the truth.
            </p>
          </div>
        </div>
      </div>

      <div className="panel p-4">
        <div className="overline mb-3">Inventory — all minted units</div>
        <UnitTable units={units} emptyLabel="nothing minted yet" />
      </div>
    </div>
  );
}
