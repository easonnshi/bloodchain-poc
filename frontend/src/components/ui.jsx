// Small shared primitives. Status is never color alone: every badge pairs
// its tone with an icon + label (the dataviz status rule).

import React, { useState } from "react";
import { statusMeta } from "../lib/format.js";

const TONE_STYLES = {
  good: "text-good border-good/40 bg-good/10",
  warn: "text-warn border-warn/40 bg-warn/10",
  critical: "text-critical border-critical/50 bg-critical/10",
  info: "text-series-1 border-series-1/40 bg-series-1/10",
  ledger: "text-ledger border-ledger/40 bg-ledger/10",
  neutral: "text-ink-2 border-hairline bg-surface-2",
};

export function Badge({ tone = "neutral", icon, children, className = "", title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${TONE_STYLES[tone]} ${className}`}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className = "" }) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} icon={meta.icon} className={className}>
      {meta.label}
    </Badge>
  );
}

export function StatTile({ label, value, sub, tone }) {
  return (
    <div className="panel px-4 py-3 min-w-0">
      <div className="overline">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "critical" ? "text-critical" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-3 truncate">{sub}</div>}
    </div>
  );
}

/** External link to HashScan / mirror node - the verifiability affordance. */
export function VerifyLink({ href, children, muted = false, disabled = false, title }) {
  if (disabled) {
    return (
      <span
        className="ledger text-xs text-ink-3 cursor-default"
        title="Simulation mode - nothing on-ledger to link to. In live mode this opens HashScan."
      >
        {children} <span aria-hidden="true">⧉</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title ?? "Verify independently on HashScan (public Hedera explorer)"}
      className={`ledger text-xs underline-offset-2 hover:underline ${muted ? "text-ink-3 hover:text-ink-2" : "text-ledger"}`}
    >
      {children} <span aria-hidden="true">⧉</span>
    </a>
  );
}

/** Async action button: pending spinner, error surfaced inline, never silent. */
export function ActionButton({ onClick, children, tone = "default", className = "", disabled, small }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const tones = {
    default: "bg-surface-3 hover:bg-surface-3/70 text-ink border-hairline",
    primary: "bg-crimson hover:bg-crimson-deep text-white border-transparent",
    good: "bg-good/15 hover:bg-good/25 text-good border-good/40",
    warn: "bg-warn/15 hover:bg-warn/25 text-warn border-warn/40",
    critical: "bg-critical/15 hover:bg-critical/25 text-critical border-critical/40",
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onClick();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col gap-1 min-w-0">
      <button
        onClick={run}
        disabled={disabled || busy}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${small ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm"} ${tones[tone]} ${className}`}
      >
        {busy && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />
        )}
        {children}
      </button>
      {error && (
        <span className="text-[11px] text-critical max-w-56 leading-tight" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

export function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm min-w-0">
      <span className="overline">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "rounded-md border border-hairline bg-surface-2 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-series-1/60";

export function Empty({ children }) {
  return <div className="py-8 text-center text-sm text-ink-3">{children}</div>;
}
