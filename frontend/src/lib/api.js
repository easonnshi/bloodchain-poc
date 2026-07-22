// Client for the local key-holding API server (server/index.js). Every call
// here causes a real signed Hedera transaction server-side. Reads that don't
// need keys (custody trails) use lib/mirror.js instead - straight to the
// public mirror node.

async function req(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `API ${res.status}`);
  return data;
}

export const api = {
  config: () => req("/config"),
  units: () => req("/units"),
  unit: (serial) => req(`/units/${serial}`),
  drift: () => req("/index/drift"),

  mint: (donorBatchId, collectionCenterId) =>
    req("/units", { method: "POST", body: { donorBatchId, collectionCenterId } }),
  submitTest: (serial, passed, staffId, testType) =>
    req(`/units/${serial}/test`, { method: "POST", body: { passed, staffId, testType } }),
  transfer: (serial, to) => req(`/units/${serial}/transfer`, { method: "POST", body: { to } }),
  close: (serial, reason) => req(`/units/${serial}/close`, { method: "POST", body: { reason } }),
  flag: (serial, reason) => req(`/units/${serial}/flag`, { method: "POST", body: { reason } }),
  staleCheck: (thresholdMs) => req("/stale-check", { method: "POST", body: { thresholdMs } }),
};
