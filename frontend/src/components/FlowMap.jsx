// The centerpiece: the vein-to-vein custody chain as a living map.
// Stations are the physical world (collection, lab, transport, hospital,
// patient); the shield in the spine is BloodUnitGate.requireClearance() -
// the one point where the ledger physically stops a unit. Units are chips
// that MOVE when their on-chain status changes; blocked units shake and
// flash the gate; quarantined units drop to the hatched bay below.
//
// Coordinate space: viewBox 0 0 100 30, chips overlaid in HTML at matching
// percentage positions so SVG and chips stay aligned at any width.

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { useStore } from "../lib/store.jsx";

const STATIONS = {
  BANK: { x: 8, y: 11, label: "Collection", sub: "Blood Bank" },
  LAB: { x: 30, y: 11, label: "Testing", sub: "Lab" },
  TRANSPORT: { x: 52, y: 11, label: "Transport", sub: "Logistics" },
  HOSPITAL: { x: 74, y: 11, label: "Hospital", sub: "Ward" },
  PATIENT: { x: 93, y: 11, label: "Transfused", sub: "Patient" },
  QUARANTINE: { x: 30, y: 24, label: "Quarantine", sub: "Batch recall" },
  RETIRED: { x: 93, y: 24, label: "Disposed", sub: "Retired" },
};
const GATE = { x: 19, y: 11 }; // between collection and the rest of the world

/** Where does a unit sit right now? */
function stationFor(unit, accounts) {
  const byAccount = (holder) => {
    if (!holder || holder === "blood_bank" || holder === accounts?.BANK) return "BANK";
    if (holder === accounts?.LAB) return "LAB";
    if (holder === accounts?.TRANSPORT) return "TRANSPORT";
    if (holder === accounts?.HOSPITAL) return "HOSPITAL";
    return "HOSPITAL";
  };
  switch (unit.status) {
    case "quarantined":
      return "QUARANTINE";
    case "closed":
      return unit.closeReason === "disposed" ? "RETIRED" : "PATIENT";
    case "in_transit":
    case "stale_alert":
      return byAccount(unit.holder);
    default:
      return byAccount(unit.holder); // collected / tested_* / transfer_blocked sit with holder
  }
}

const RING = {
  tested_pass: "ring-2 ring-good",
  tested_fail: "ring-2 ring-critical",
  transfer_blocked: "ring-2 ring-critical",
  stale_alert: "ring-2 ring-warn",
  quarantined: "ring-2 ring-warn",
};

export default function FlowMap({ height = 300 }) {
  const { units, events, config } = useStore();
  const accounts = config?.accounts;

  // A block that landed in the last few seconds lights the gate red.
  const gateHot = useMemo(() => {
    const latest = events.find((e) => e.eventType === "TRANSFER_BLOCKED");
    if (!latest) return false;
    return Date.now() - Number(String(latest.consensusTimestamp).split(".")[0]) * 1000 < 6000;
  }, [events]);

  // Stack chips below their station: pixel offsets (not %) so chips never
  // overlap at narrow widths; FLIP layout animation moves them smoothly.
  const placed = useMemo(() => {
    const bySt = {};
    return units
      .slice()
      .sort((a, b) => Number(a.serial) - Number(b.serial))
      .map((u) => {
        const st = stationFor(u, accounts);
        const i = (bySt[st] = (bySt[st] ?? -1) + 1);
        const col = i % 3;
        const row = Math.floor(i / 3);
        const { x, y } = STATIONS[st];
        return { unit: u, st, x, y, dx: (col - 1) * 27, dy: 18 + row * 27 };
      });
  }, [units, accounts]);

  return (
    <div className="panel relative overflow-hidden" style={{ height }}>
      <div className="absolute left-4 top-3 z-10">
        <span className="overline">Custody chain — live</span>
      </div>

      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {/* the spine */}
        <Spine from={STATIONS.BANK} to={GATE} />
        <Spine from={GATE} to={STATIONS.LAB} />
        <Spine from={STATIONS.LAB} to={STATIONS.TRANSPORT} />
        <Spine from={STATIONS.TRANSPORT} to={STATIONS.HOSPITAL} />
        <Spine from={STATIONS.HOSPITAL} to={STATIONS.PATIENT} />
        {/* drop lines to the bays */}
        <Spine from={STATIONS.LAB} to={STATIONS.QUARANTINE} dashed />
        <Spine from={STATIONS.HOSPITAL} to={STATIONS.RETIRED} dashed />

        {/* stations */}
        {Object.entries(STATIONS).map(([key, s]) => (
          <g key={key}>
            <circle
              cx={s.x}
              cy={s.y}
              r="1.05"
              fill="var(--color-surface-3)"
              stroke={key === "QUARANTINE" ? "var(--color-warn)" : "var(--color-hairline)"}
              strokeWidth="0.22"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {/* the gate: BloodUnitGate.requireClearance() */}
        <g>
          <path
            d={`M ${GATE.x} ${GATE.y - 1.6} l 1.35 0.7 v 1.5 c 0 0.85 -0.6 1.5 -1.35 1.85 c -0.75 -0.35 -1.35 -1 -1.35 -1.85 v -1.5 Z`}
            fill={gateHot ? "var(--color-critical)" : "var(--color-surface-3)"}
            stroke={gateHot ? "var(--color-critical)" : "var(--color-ledger)"}
            strokeWidth="0.2"
            vectorEffect="non-scaling-stroke"
            className={gateHot ? "alert-pulse" : ""}
          />
        </g>
      </svg>

      {/* station labels (HTML for crisp text) */}
      {Object.entries(STATIONS).map(([key, s]) => (
        <div
          key={key}
          className="absolute -translate-x-1/2 text-center pointer-events-none"
          style={{ left: `${s.x}%`, top: `calc(${(s.y / 30) * 100}% - 40px)` }}
        >
          <div className="text-[11px] font-semibold text-ink-2 leading-3">{s.label}</div>
          <div className="text-[9px] text-ink-3">{s.sub}</div>
        </div>
      ))}
      <div
        className="absolute -translate-x-1/2 text-center pointer-events-none"
        style={{ left: `${GATE.x}%`, top: `calc(${(GATE.y / 30) * 100}% + 14px)` }}
      >
        <div className={`text-[9px] leading-3 ${gateHot ? "text-critical font-semibold" : "text-ledger"}`}>
          requireClearance()
        </div>
      </div>

      {/* quarantine bay hatching */}
      <div
        className="absolute hatch-warn rounded-md border border-warn/30 pointer-events-none"
        style={{
          left: `calc(${STATIONS.QUARANTINE.x}% - 56px)`,
          top: `calc(${(STATIONS.QUARANTINE.y / 30) * 100}% - 14px)`,
          width: 112,
          height: 64,
        }}
        aria-hidden="true"
      />

      {/* the units */}
      {placed.map(({ unit, x, y, dx, dy }) => (
        <UnitChip key={unit.serial} unit={unit} x={x} y={y} dx={dx} dy={dy} />
      ))}
    </div>
  );
}

function Spine({ from, to, dashed = false }) {
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke="var(--color-grid)"
      strokeWidth={dashed ? 0.9 : 1.4}
      strokeDasharray={dashed ? "0.8 0.8" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function UnitChip({ unit, x, y, dx, dy }) {
  const blocked = unit.status === "transfer_blocked";
  const closed = unit.status === "closed";
  const ring = RING[unit.status] ?? "";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{
        opacity: closed ? 0.45 : 1,
        scale: 1,
        x: blocked ? [0, -5, 5, -3, 3, 0] : 0,
      }}
      transition={{
        layout: { type: "spring", stiffness: 60, damping: 15 },
        x: blocked ? { duration: 0.5 } : undefined,
      }}
      style={{ left: `calc(${x}% + ${dx}px)`, top: `calc(${(y / 30) * 100}% + ${dy}px)` }}
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      title={`unit #${unit.serial} — ${unit.status}${unit.flagReason ? ` (${unit.flagReason})` : ""}`}
    >
      <div
        className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${ring} ${
          unit.status === "stale_alert" ? "alert-pulse" : ""
        } ${closed ? "bg-surface-3" : "bg-crimson"}`}
      >
        <span className={`ledger text-[9px] font-bold ${closed ? "text-ink-3" : "text-white"}`}>
          {unit.serial}
        </span>
      </div>
      {blocked && (
        <div className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-[8px] font-bold text-critical">
          BLOCKED
        </div>
      )}
    </motion.div>
  );
}
