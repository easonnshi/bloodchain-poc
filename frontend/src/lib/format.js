// Formatting helpers. Ledger data (consensus timestamps, IDs) is shown the
// way the network reports it - seconds.nanoseconds - because that precision
// IS the product: it's what makes two events globally ordered.

/** "1721558400.123456789" -> { iso: "2024-07-21 10:00:00 UTC", nanos: ".123456789" } */
export function consensusParts(ts) {
  if (!ts) return { iso: "—", nanos: "" };
  const [secs, nanos = "0"] = String(ts).split(".");
  const d = new Date(Number(secs) * 1000);
  const iso = d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  return { iso, nanos: "." + nanos.padEnd(9, "0") };
}

export function consensusShort(ts) {
  if (!ts) return "—";
  const [secs] = String(ts).split(".");
  const d = new Date(Number(secs) * 1000);
  return d.toISOString().replace("T", " ").slice(5, 19);
}

/** ISO string -> short local display. */
export function isoShort(iso) {
  if (!iso) return "—";
  return String(iso).replace("T", " ").slice(0, 19);
}

export function timeAgo(tsOrIso) {
  if (!tsOrIso) return "—";
  const ms = String(tsOrIso).includes("T")
    ? Date.parse(tsOrIso)
    : Number(String(tsOrIso).split(".")[0]) * 1000;
  const diff = Date.now() - ms;
  if (diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const EVENT_LABELS = {
  COLLECTED: "Collected",
  TEST_RESULT: "Test result",
  CUSTODY_TRANSFER: "Custody transfer",
  TRANSFER_BLOCKED: "Transfer BLOCKED",
  TRANSFUSED: "Transfused",
  DISPOSED: "Disposed",
  FLAGGED: "Flagged",
  BATCH_ALERT: "Batch alert",
  POST_USE_ALERT: "Post-use alert",
  STALE_ALERT: "Stale alert",
  INVESTIGATION_OPENED: "Investigation opened",
  PENALTY_APPLIED: "Penalty applied",
  STAFF_SUSPENDED: "Staff suspended",
  ELECTION_STARTED: "Election started",
  AUTHORITY_ELECTED: "Authority elected",
  ORG_REINSTATED: "Org reinstated",
};

export const STATUS_META = {
  collected: { label: "Collected", tone: "neutral", icon: "●" },
  tested_pass: { label: "Test passed", tone: "good", icon: "✓" },
  tested_fail: { label: "Test failed", tone: "critical", icon: "✕" },
  in_transit: { label: "In custody", tone: "info", icon: "→" },
  transfer_blocked: { label: "Blocked", tone: "critical", icon: "⛔" },
  quarantined: { label: "Quarantined", tone: "warn", icon: "⚠" },
  stale_alert: { label: "Stale", tone: "warn", icon: "⏱" },
  closed: { label: "Closed", tone: "neutral", icon: "◼" },
};

export function statusMeta(status) {
  return STATUS_META[status] ?? { label: status ?? "—", tone: "neutral", icon: "·" };
}
