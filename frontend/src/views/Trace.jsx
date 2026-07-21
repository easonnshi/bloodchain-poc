// Public custody trail. Read-only, no wallet, no local server required in
// live mode: the browser queries the public mirror node directly and links
// every event to HashScan. This page is the argument for the architecture -
// "don't trust our UI, check the ledger" - made into a URL you can print as
// a QR code on the physical blood bag.

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useStore } from "../lib/store.jsx";
import { allTopicMessages, nftInfo } from "../lib/mirror.js";
import { hashscan } from "../lib/hashscan.js";
import { consensusParts, EVENT_LABELS } from "../lib/format.js";
import { StatusBadge, VerifyLink, inputCls, Empty, Badge } from "../components/ui.jsx";

const TIMELINE_TONES = {
  TRANSFER_BLOCKED: "border-critical bg-critical/10 text-critical",
  STALE_ALERT: "border-warn bg-warn/10 text-warn",
  FLAGGED: "border-warn bg-warn/10 text-warn",
  BATCH_ALERT: "border-warn bg-warn/10 text-warn",
  POST_USE_ALERT: "border-warn bg-warn/10 text-warn",
  TRANSFUSED: "border-good bg-good/10 text-good",
  TEST_RESULT: "border-series-1 bg-series-1/10 text-series-1",
  PENALTY_APPLIED: "border-critical bg-critical/10 text-critical",
};

export default function Trace() {
  const { serial } = useParams();
  const navigate = useNavigate();
  const { units, events, config, isSim } = useStore();
  const [query, setQuery] = useState(serial ?? "");
  const [chainEvents, setChainEvents] = useState(null);
  const [nft, setNft] = useState(null);
  const [loading, setLoading] = useState(false);

  const unit = units.find((u) => u.serial === serial);

  // Live mode: pull the unit's full event history straight from the public
  // mirror node (not from our server, not from the local cache).
  useEffect(() => {
    if (!serial) return;
    if (isSim) {
      setChainEvents(events.filter((e) => e.unitId === serial).slice().reverse());
      return;
    }
    if (!config?.topicId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const all = await allTopicMessages(config.topicId);
        if (!cancelled) setChainEvents(all.filter((e) => e.unitId === serial));
        if (config.tokenId) {
          try {
            const info = await nftInfo(config.tokenId, serial);
            if (!cancelled) setNft(info);
          } catch {
            if (!cancelled) setNft({ missing: true }); // burned units 404 - that's the point of closeUnit
          }
        }
      } catch {
        if (!cancelled) setChainEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serial, isSim, config?.topicId, config?.tokenId, events]);

  const traceUrl = `${window.location.origin}/trace/${serial ?? ""}`;

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Trace a unit</h1>
        <p className="mt-1 text-sm text-ink-2 max-w-2xl">
          Enter a serial number to replay a unit's full custody history from the public ledger.
          {!isSim && " This view reads the Hedera mirror node directly — no wallet, no account, no trust in this app required."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) navigate(`/trace/${query.trim()}`);
        }}
        className="flex gap-2 max-w-sm"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="unit serial, e.g. 102"
          className={`${inputCls} flex-1 ledger`}
          aria-label="unit serial number"
        />
        <button type="submit" className="rounded-md bg-crimson hover:bg-crimson-deep px-4 py-1.5 text-sm font-medium text-white">
          Trace
        </button>
      </form>

      {!serial && (
        <div className="panel p-4">
          <div className="overline mb-2">Known units</div>
          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <Link key={u.serial} to={`/trace/${u.serial}`} className="panel-2 px-2.5 py-1 ledger text-xs text-ink-2 hover:text-ink hover:border-series-1/50">
                #{u.serial}
              </Link>
            ))}
            {units.length === 0 && <span className="text-sm text-ink-3">none minted yet</span>}
          </div>
        </div>
      )}

      {serial && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4 items-start">
          {/* timeline */}
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="overline">Custody trail — unit #{serial}</span>
              {!isSim && config?.topicId && (
                <VerifyLink href={hashscan.topic(config.topicId)}>full topic on HashScan</VerifyLink>
              )}
            </div>
            {loading && <Empty>replaying ledger history…</Empty>}
            {!loading && chainEvents && chainEvents.length === 0 && (
              <Empty>no on-chain events found for unit #{serial}</Empty>
            )}
            {!loading && chainEvents && chainEvents.length > 0 && (
              <ol className="relative ml-2 border-l border-hairline">
                {chainEvents.map((ev, i) => (
                  <TimelineEvent key={`${ev.sequenceNumber}-${i}`} ev={ev} isSim={isSim} last={i === chainEvents.length - 1} />
                ))}
              </ol>
            )}
          </div>

          {/* side card */}
          <div className="space-y-4">
            <div className="panel p-4 space-y-2.5">
              <div className="overline">Unit record</div>
              {unit ? (
                <>
                  <StatusBadge status={unit.status} />
                  <KV k="batch" v={unit.donorBatchId} />
                  <KV k="center" v={unit.collectionCenterId} />
                  <KV k="staff" v={unit.staffId} />
                  {unit.flagReason && <KV k="flag" v={unit.flagReason} wrap />}
                </>
              ) : (
                <p className="text-xs text-ink-3">not in the local index — history above is chain-only</p>
              )}
              {nft && !nft.missing && (
                <>
                  <KV k="NFT owner" v={nft.accountId} />
                  <VerifyLink href={hashscan.nft(config.tokenId, serial)}>NFT on HashScan</VerifyLink>
                </>
              )}
              {nft?.missing && (
                <Badge tone="neutral" icon="◼" title="The NFT was burned by closeUnit() - a closed unit no longer exists on the token, by design.">
                  NFT burned (unit closed)
                </Badge>
              )}
            </div>

            {/* QR: the link between the ledger record and the physical bag */}
            <div className="panel p-4">
              <div className="overline mb-2">Bag label</div>
              <div className="rounded-md bg-white p-3 w-fit">
                <QRCodeSVG value={traceUrl} size={128} level="M" fgColor="#0a0c10" bgColor="#ffffff" />
              </div>
              <p className="mt-2 text-[11px] text-ink-3 leading-4">
                Printed on the physical unit at collection. Anyone who scans it lands on this page
                and can verify the unit's history against the public ledger.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineEvent({ ev, isSim, last }) {
  const { iso, nanos } = consensusParts(ev.consensusTimestamp);
  const tone = TIMELINE_TONES[ev.eventType] ?? "border-hairline bg-surface-2 text-ink-2";

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      className={`relative pl-5 ${last ? "" : "pb-4"}`}
    >
      <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${tone.split(" ")[0]} bg-page`} aria-hidden="true" />
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
          {EVENT_LABELS[ev.eventType] ?? ev.eventType}
        </span>
        <span className="ledger text-[11px] text-ink-3" title="consensus timestamp (seconds.nanoseconds)">
          {iso}
          <span className="opacity-60">{nanos}</span>
        </span>
        {!isSim ? (
          <VerifyLink href={hashscan.transaction(ev.consensusTimestamp)} muted>
            verify tx
          </VerifyLink>
        ) : (
          <span className="text-[10px] text-ink-3">simulated</span>
        )}
      </div>
      <EventDetail ev={ev} />
    </motion.li>
  );
}

function EventDetail({ ev }) {
  const bits = [];
  if (ev.eventType === "TEST_RESULT") bits.push(`${ev.testType ?? "panel"}: ${ev.passed ? "PASSED" : "FAILED"}`, `staff ${ev.staffId}`);
  if (ev.eventType === "CUSTODY_TRANSFER") bits.push(`${ev.from} → ${ev.to}`);
  if (ev.eventType === "TRANSFER_BLOCKED") bits.push(`attempted destination ${ev.attemptedTo ?? "?"} — stopped by contract`);
  if (ev.eventType === "STALE_ALERT") bits.push(ev.note ?? "held past window");
  if (ev.reason && !bits.length) bits.push(ev.reason);
  if (!bits.length) return null;
  return <div className="mt-1 text-xs text-ink-2">{bits.join(" · ")}</div>;
}

function KV({ k, v, wrap = false }) {
  return (
    <div className="flex items-baseline gap-2 text-xs min-w-0">
      <span className="overline shrink-0">{k}</span>
      <span className={`ledger text-ink-2 ${wrap ? "" : "truncate"}`}>{v ?? "—"}</span>
    </div>
  );
}
