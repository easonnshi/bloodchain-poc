// src/localIndex.js
//
// A lightweight off-chain index. Every on-chain event also writes a row
// here, so status checks (submitTestResult) and batch lookups (flagBatch)
// are instant local reads instead of a live mirror-node HTTP call every
// time. Hedera stays the source of truth; this is a cache that mirrors it.
//
// Swap this for SQLite (better-sqlite3) later without touching any other
// file - every other module only calls the functions exported below, never
// the storage format directly.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "index.json");

function load() {
  if (!existsSync(DB_PATH)) return { units: {} };
  return JSON.parse(readFileSync(DB_PATH, "utf-8"));
}

function save(db) {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/**
 * Create or update a unit's local record.
 * @param {string} serial - the NFT serial number, as a string (unit ID)
 * @param {object} patch - fields to merge in, e.g. { status: "tested_pass" }
 */
export function upsertUnit(serial, patch) {
  const db = load();
  db.units[serial] = { ...(db.units[serial] || {}), ...patch, serial };
  save(db);
  return db.units[serial];
}

export function getUnit(serial) {
  const db = load();
  return db.units[serial] || null;
}

/** All units minted from the same donation batch. Used by flagBatch(). */
export function getUnitsByBatch(donorBatchId) {
  const db = load();
  return Object.values(db.units).filter((u) => u.donorBatchId === donorBatchId);
}

export function allUnits() {
  return Object.values(load().units);
}
