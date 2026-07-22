// App chrome: left rail nav (role views), top bar with mode badge + ledger
// identifiers. The mode badge is deliberately loud: SIMULATION vs TESTNET is
// an honesty distinction, not a styling detail.

import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useStore } from "../lib/store.jsx";
import { hashscan } from "../lib/hashscan.js";
import { Badge, VerifyLink } from "./ui.jsx";

const NAV = [
  { to: "/", label: "Overview", icon: "◉", end: true },
  { to: "/trace", label: "Trace a unit", icon: "⌕" },
  { to: "/bank", label: "Blood Bank", icon: "🩸" },
  { to: "/lab", label: "Lab", icon: "⚗" },
  { to: "/logistics", label: "Hospital / Transport", icon: "⛨" },
  { to: "/explainer", label: "Explainer", icon: "▸" },
];

export default function Shell({ children }) {
  const { mode, config, isSim } = useStore();
  const location = useLocation();

  return (
    <div className="min-h-screen flex">
      {/* left rail */}
      <aside className="w-56 shrink-0 border-r border-hairline bg-surface flex flex-col">
        <div className="px-4 py-4 border-b border-hairline">
          <div className="flex items-center gap-2">
            <BloodMark />
            <div>
              <div className="text-sm font-semibold tracking-tight leading-4">BloodChain</div>
              <div className="text-[10px] text-ink-3 leading-3 mt-0.5">vein-to-vein custody</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2 text-[13px] transition-colors border-l-2 ${
                  isActive
                    ? "border-crimson text-ink bg-surface-2"
                    : "border-transparent text-ink-2 hover:text-ink hover:bg-surface-2/50"
                }`
              }
            >
              <span className="w-4 text-center opacity-80" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-hairline text-[10px] text-ink-3 leading-4">
          DDiB26 · University of Zurich
          <br />
          Hedera HTS + HCS + HSCS
        </div>
      </aside>

      {/* main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 shrink-0 border-b border-hairline bg-surface/80 backdrop-blur flex items-center gap-3 px-4">
          <ModeBadge mode={mode} />
          {config && !isSim && (
            <div className="hidden md:flex items-center gap-3 text-xs">
              <VerifyLink href={hashscan.token(config.tokenId)} muted>
                token {config.tokenId}
              </VerifyLink>
              <VerifyLink href={hashscan.topic(config.topicId)} muted>
                topic {config.topicId}
              </VerifyLink>
              <VerifyLink href={hashscan.contract(config.contractId)} muted>
                gate {config.contractId}
              </VerifyLink>
            </div>
          )}
          {isSim && (
            <span className="text-xs text-ink-3">
              no Hedera credentials found — playing the same story in-memory
            </span>
          )}
          <div className="flex-1" />
          <span className="ledger text-[11px] text-ink-3">{location.pathname}</span>
        </header>
        <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}

function ModeBadge({ mode }) {
  if (mode === "connecting") {
    return <Badge tone="neutral" icon="…">connecting</Badge>;
  }
  if (mode === "live") {
    return (
      <Badge tone="ledger" icon="●" title="Connected to Hedera testnet via the local API server. Every action is a real signed transaction.">
        HEDERA TESTNET — LIVE
      </Badge>
    );
  }
  return (
    <Badge tone="warn" icon="◌" title="No credentials configured. All data is in-memory and clearly not on any ledger. Start server/index.js with a filled .env for live mode.">
      SIMULATION
    </Badge>
  );
}

function BloodMark() {
  // A drop inside a hex ledger cell - the product in the protocol.
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path
        d="M13 1.8 22.7 7.4v11.2L13 24.2 3.3 18.6V7.4Z"
        fill="none"
        stroke="var(--color-hairline)"
        strokeWidth="1.4"
      />
      <path
        d="M13 6.5c2.6 3.4 4.3 5.9 4.3 8.2a4.3 4.3 0 1 1-8.6 0c0-2.3 1.7-4.8 4.3-8.2Z"
        fill="var(--color-crimson)"
      />
    </svg>
  );
}
