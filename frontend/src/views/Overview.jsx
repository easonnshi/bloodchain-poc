// The landing view: hero stats, the living custody map, and the consensus
// feed side by side. In simulation mode a scripted story can drive the whole
// screen for a presentation; in live mode the same beats come from real
// testnet transactions triggered on the role dashboards.

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "../lib/store.jsx";
import FlowMap from "../components/FlowMap.jsx";
import ConsensusFeed from "../components/ConsensusFeed.jsx";
import { StatTile, ActionButton, Badge } from "../components/ui.jsx";

export default function Overview() {
  const { units, events, actions, storyState, isSim } = useStore();

  const active = units.filter((u) => u.status !== "closed").length;
  const blocked = events.filter((e) => e.eventType === "TRANSFER_BLOCKED").length;
  const quarantined = units.filter((u) => u.status === "quarantined").length;
  const stale = units.filter((u) => u.status === "stale_alert").length;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1400px]">
      {/* headline row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Every unit of blood, one public chain of custody.
          </h1>
          <p className="mt-1 text-sm text-ink-2 max-w-2xl">
            Minted as an NFT at collection, gated by a smart contract at every hand-off, logged to
            consensus at every step — on a ledger nobody in the supply chain controls.
          </p>
        </div>
        {isSim && (
          <div className="flex items-center gap-2">
            {storyState.running && (
              <Badge tone="warn" icon="▶">
                step {storyState.step}/{storyState.total}
              </Badge>
            )}
            <ActionButton tone="primary" onClick={() => actions.playStory()} disabled={storyState.running}>
              ▶ Play the full story
            </ActionButton>
          </div>
        )}
      </div>

      {/* story caption - the narrator line during the scripted demo */}
      <AnimatePresence>
        {storyState.caption && (
          <motion.div
            key={storyState.caption}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="panel-2 border-l-2 border-l-crimson px-4 py-2.5 text-sm text-ink"
          >
            {storyState.caption}
          </motion.div>
        )}
      </AnimatePresence>

      {/* stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Units in circulation" value={active} sub={`${units.length} minted all-time`} />
        <StatTile label="Events on ledger" value={events.length > 0 ? events[0].sequenceNumber : 0} sub="HCS consensus messages" />
        <StatTile label="Transfers blocked" value={blocked} tone={blocked > 0 ? "critical" : undefined} sub="by requireClearance()" />
        <StatTile
          label="Quarantined / stale"
          value={`${quarantined} / ${stale}`}
          tone={quarantined + stale > 0 ? "warn" : undefined}
          sub="batch recalls · silence alerts"
        />
      </div>

      {/* the centerpiece + the feed */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
        <FlowMap height={310} />
        <ConsensusFeed limit={12} />
      </div>
    </div>
  );
}
