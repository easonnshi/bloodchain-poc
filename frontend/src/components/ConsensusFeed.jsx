// The live HCS event rail. Every row is one consensus-sealed message: the
// pulse animation fires exactly once when a new event arrives, anchored to
// the REAL consensus timestamp shown beside it - no fake spinners. In live
// mode each row links to its transaction on HashScan.

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../lib/store.jsx";
import { hashscan } from "../lib/hashscan.js";
import { consensusParts, EVENT_LABELS, timeAgo } from "../lib/format.js";
import { VerifyLink } from "./ui.jsx";

const EVENT_TONES = {
  TRANSFER_BLOCKED: "text-critical",
  STALE_ALERT: "text-warn",
  FLAGGED: "text-warn",
  BATCH_ALERT: "text-warn",
  POST_USE_ALERT: "text-warn",
  PENALTY_APPLIED: "text-critical",
  STAFF_SUSPENDED: "text-critical",
  TEST_RESULT: "text-ink",
  TRANSFUSED: "text-good",
  AUTHORITY_ELECTED: "text-series-1",
};

export default function ConsensusFeed({ limit = 14, compact = false }) {
  const { events, isSim } = useStore();
  const shown = events.slice(0, limit);

  return (
    <div className="panel flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-hairline">
        <span className="overline">Consensus event log</span>
        <span className="text-[10px] text-ink-3">
          {isSim ? "in-memory" : "mirror node · public"}
        </span>
      </div>
      <ul className="thin-scroll overflow-y-auto divide-y divide-grid" role="log" aria-live="polite">
        <AnimatePresence initial={false}>
          {shown.map((ev) => (
            <motion.li
              key={`${ev.sequenceNumber}-${ev.consensusTimestamp}`}
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="px-3.5 py-2"
            >
              <FeedRow ev={ev} isSim={isSim} compact={compact} />
            </motion.li>
          ))}
        </AnimatePresence>
        {shown.length === 0 && (
          <li className="px-3.5 py-6 text-center text-xs text-ink-3">no events yet</li>
        )}
      </ul>
    </div>
  );
}

function FeedRow({ ev, isSim, compact }) {
  const { iso, nanos } = consensusParts(ev.consensusTimestamp);
  const fresh = Date.now() - Number(String(ev.consensusTimestamp).split(".")[0]) * 1000 < 8000;
  const tone = EVENT_TONES[ev.eventType] ?? "text-ink-2";

  return (
    <div className="flex items-start gap-2.5 min-w-0">
      {/* the seal: pulses once, only for events that just landed */}
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full bg-ledger ${fresh ? "consensus-pulse" : "opacity-50"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={`text-xs font-semibold ${tone} truncate`}>
            {EVENT_LABELS[ev.eventType] ?? ev.eventType}
          </span>
          {ev.unitId && ev.unitId !== "-" && (
            <span className="ledger text-[11px] text-ink-2 shrink-0">unit #{ev.unitId}</span>
          )}
          <span className="ledger text-[10px] text-ink-3 ml-auto shrink-0">{timeAgo(ev.consensusTimestamp)}</span>
        </div>
        {!compact && (
          <div className="mt-0.5 flex items-center gap-2 min-w-0">
            <span className="ledger text-[10px] text-ink-3 truncate" title={`consensus ${iso}${nanos}`}>
              {iso}
              <span className="opacity-60">{nanos}</span>
            </span>
            {isSim ? (
              <span className="text-[10px] text-ink-3 shrink-0" title="Simulation - not on any ledger">
                not sealed
              </span>
            ) : (
              <VerifyLink href={hashscan.transaction(ev.consensusTimestamp)} muted>
                seq #{ev.sequenceNumber}
              </VerifyLink>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
