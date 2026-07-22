// Simulation engine. When no Hedera credentials are configured (or the local
// API server is down), the app runs against this instead of testnet: same
// state shapes, same action surface, same event semantics as the real
// backend, driven in-memory. A visible SIMULATION badge is shown the whole
// time - this mode exists so the UI can be developed, demoed, and graded
// without keys, never to fake verifiability. In live mode every one of
// these actions is a real signed transaction with a HashScan link.

const SIM_ACCOUNTS = {
  BANK: "0.0.900001",
  LAB: "0.0.900002",
  HOSPITAL: "0.0.900003",
  TRANSPORT: "0.0.900004",
};

const now = () => Date.now();
const daysAgo = (d) => new Date(now() - d * 86400_000).toISOString();

function consensusTs(offsetMs = 0) {
  const ms = now() + offsetMs;
  const secs = Math.floor(ms / 1000);
  const nanos = String((ms % 1000) * 1e6 + Math.floor(Math.random() * 1e6)).padStart(9, "0");
  return `${secs}.${nanos}`;
}

// Simulated consensus latency: finality on Hedera is seconds, not blocks.
const SEAL_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SimEngine {
  constructor() {
    this.listeners = new Set();
    this.seq = 0;
    this.units = {};
    this.events = [];
    this.nextSerial = 108;
    this.story = { running: false, step: 0, total: 0, caption: null };
    this.#seed();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #notify() {
    for (const fn of this.listeners) fn();
  }

  #event(payload, tsOffsetMs = 0) {
    this.seq += 1;
    const ev = {
      sequenceNumber: this.seq,
      consensusTimestamp: consensusTs(tsOffsetMs),
      payer: SIM_ACCOUNTS.BANK,
      simulated: true,
      ...payload,
    };
    this.events.push(ev);
    return ev;
  }

  #upsert(serial, patch) {
    this.units[serial] = { ...(this.units[serial] || {}), ...patch, serial: String(serial) };
    return this.units[serial];
  }

  #seed() {
    // A believable week of history so no view opens empty. Sequence matters:
    // events replay in order on the trace view exactly like HCS history.
    const mint = (serial, batch, offsetDays) => {
      this.#upsert(serial, {
        donorBatchId: batch,
        collectionCenterId: "CTR-ZH-01",
        status: "collected",
        holder: "blood_bank",
        mintedAt: daysAgo(offsetDays),
      });
      this.#event(
        { unitId: String(serial), eventType: "COLLECTED", donorBatchId: batch, collectionCenterId: "CTR-ZH-01" },
        -offsetDays * 86400_000
      );
    };
    const test = (serial, passed, staffId, offsetDays) => {
      this.#upsert(serial, {
        status: passed ? "tested_pass" : "tested_fail",
        testType: "infectious_disease_panel",
        staffId,
        testedAt: daysAgo(offsetDays),
      });
      this.#event(
        { unitId: String(serial), eventType: "TEST_RESULT", passed, staffId, testType: "infectious_disease_panel", submittedBy: SIM_ACCOUNTS.LAB },
        -offsetDays * 86400_000
      );
    };
    const move = (serial, toRole, offsetDays) => {
      this.#upsert(serial, { status: "in_transit", holder: SIM_ACCOUNTS[toRole], heldSince: daysAgo(offsetDays) });
      this.#event(
        { unitId: String(serial), eventType: "CUSTODY_TRANSFER", from: SIM_ACCOUNTS.BANK, to: SIM_ACCOUNTS[toRole] },
        -offsetDays * 86400_000
      );
    };
    const closeU = (serial, reason, offsetDays) => {
      this.#upsert(serial, { status: "closed", closeReason: reason, closedAt: daysAgo(offsetDays) });
      this.#event(
        { unitId: String(serial), eventType: reason === "transfused" ? "TRANSFUSED" : "DISPOSED", reason },
        -offsetDays * 86400_000
      );
    };

    mint(101, "DON-2401", 6.2);
    test(101, true, "TECH-201", 6.0);
    move(101, "HOSPITAL", 5.5);
    closeU(101, "transfused", 4.8);

    mint(102, "DON-2401", 6.2);
    test(102, true, "TECH-201", 5.9);
    move(102, "HOSPITAL", 2.1);

    mint(103, "DON-2403", 1.4);
    test(103, true, "TECH-201", 1.1);

    mint(104, "DON-2404", 0.3);

    mint(105, "DON-2402", 3.3);
    test(105, false, "TECH-201", 3.0);
    this.#upsert(105, { status: "quarantined", flagReason: "failed infectious disease panel" });
    this.#event({ unitId: "105", eventType: "FLAGGED", reason: "failed infectious disease panel", donorBatchId: "DON-2402" }, -3.0 * 86400_000 + 60_000);

    mint(106, "DON-2402", 3.3);
    this.#upsert(106, { status: "quarantined", flagReason: "sibling of #105: failed infectious disease panel" });
    this.#event({ unitId: "106", eventType: "BATCH_ALERT", reason: "sibling of #105: failed infectious disease panel", donorBatchId: "DON-2402" }, -3.0 * 86400_000 + 90_000);

    mint(107, "DON-2403", 1.4);
    test(107, true, "NURSE-114", 1.2);
    move(107, "HOSPITAL", 1.0);
    closeU(107, "transfused", 0.4);
  }

  // ---- action surface (mirrors lib/api.js) -------------------------------

  async mint(donorBatchId, collectionCenterId) {
    await sleep(SEAL_MS);
    const serial = String(this.nextSerial++);
    this.#upsert(serial, {
      donorBatchId,
      collectionCenterId,
      status: "collected",
      holder: "blood_bank",
      mintedAt: new Date().toISOString(),
    });
    this.#event({ unitId: serial, eventType: "COLLECTED", donorBatchId, collectionCenterId });
    this.#notify();
    return { serial, unit: this.units[serial] };
  }

  async submitTest(serial, passed, staffId = "TECH-201", testType = "infectious_disease_panel") {
    await sleep(SEAL_MS);
    this.#upsert(serial, {
      status: passed ? "tested_pass" : "tested_fail",
      staffId,
      testType,
      testedAt: new Date().toISOString(),
    });
    this.#event({ unitId: String(serial), eventType: "TEST_RESULT", passed, staffId, testType, submittedBy: SIM_ACCOUNTS.LAB });
    this.#notify();
    return { status: passed ? "tested_pass" : "tested_fail" };
  }

  async transfer(serial, to) {
    const unit = this.units[serial];
    if (!unit) throw new Error(`Unknown unit #${serial}`);
    await sleep(SEAL_MS);
    // The BloodUnitGate rule, verbatim: only a recorded Passed result moves.
    if (unit.status !== "tested_pass" && unit.status !== "in_transit") {
      this.#upsert(serial, { status: "transfer_blocked" });
      this.#event({ unitId: String(serial), eventType: "TRANSFER_BLOCKED", attemptedTo: SIM_ACCOUNTS[to] });
      this.#notify();
      return { blocked: true, unit: this.units[serial] };
    }
    const from = unit.holder === "blood_bank" ? SIM_ACCOUNTS.BANK : unit.holder;
    this.#upsert(serial, { status: "in_transit", holder: SIM_ACCOUNTS[to], heldSince: new Date().toISOString() });
    this.#event({ unitId: String(serial), eventType: "CUSTODY_TRANSFER", from, to: SIM_ACCOUNTS[to] });
    this.#notify();
    return { blocked: false, unit: this.units[serial] };
  }

  async close(serial, reason = "transfused") {
    await sleep(SEAL_MS);
    this.#upsert(serial, { status: "closed", closeReason: reason, closedAt: new Date().toISOString() });
    this.#event({ unitId: String(serial), eventType: reason === "transfused" ? "TRANSFUSED" : "DISPOSED", reason });
    this.#notify();
    return { unit: this.units[serial] };
  }

  async flag(serial, reason) {
    const unit = this.units[serial];
    if (!unit) throw new Error(`Unknown unit #${serial}`);
    await sleep(SEAL_MS);
    this.#upsert(serial, { status: "quarantined", flagReason: reason });
    this.#event({ unitId: String(serial), eventType: "FLAGGED", reason, donorBatchId: unit.donorBatchId });
    const siblings = Object.values(this.units).filter(
      (u) => u.donorBatchId === unit.donorBatchId && u.serial !== String(serial)
    );
    const quarantined = [];
    for (const sib of siblings) {
      await sleep(420); // staggered so the recall reads as a cascade
      const used = sib.status === "closed";
      if (!used) {
        this.#upsert(sib.serial, { status: "quarantined", flagReason: `sibling of #${serial}: ${reason}` });
        quarantined.push(sib.serial);
      } else {
        this.#upsert(sib.serial, { flagReason: `sibling flagged after use - patient follow-up needed` });
      }
      this.#event({
        unitId: sib.serial,
        eventType: used ? "POST_USE_ALERT" : "BATCH_ALERT",
        reason: `sibling of #${serial}: ${reason}`,
        donorBatchId: unit.donorBatchId,
      });
      this.#notify();
    }
    this.#notify();
    return { flagged: String(serial), quarantinedSiblings: quarantined };
  }

  async staleCheck(thresholdMs = 36 * 3600_000) {
    await sleep(600);
    const staleList = Object.values(this.units).filter(
      (u) =>
        !["closed", "quarantined", "stale_alert"].includes(u.status) &&
        u.holder &&
        u.holder !== "blood_bank" &&
        u.heldSince &&
        now() - Date.parse(u.heldSince) > thresholdMs
    );
    for (const u of staleList) {
      this.#upsert(u.serial, { status: "stale_alert" });
      this.#event({
        unitId: u.serial,
        eventType: "STALE_ALERT",
        holder: u.holder,
        heldSince: u.heldSince,
        note: "no transfusion/disposal/transfer logged within holding window",
      });
    }
    this.#notify();
    return { staleUnits: staleList };
  }

  // ---- the scripted presentation story -----------------------------------

  async playStory() {
    if (this.story.running) return;
    const step = async (caption, fn, pauseMs = 2400) => {
      this.story.step += 1;
      this.story.caption = caption;
      this.#notify();
      await fn();
      await sleep(pauseMs);
    };

    this.story = { running: true, step: 0, total: 8, caption: null };
    this.#notify();
    let a = null;
    let b = null;

    try {
      await step("A donation arrives. Unit A is minted as an NFT on the ledger.", async () => {
        a = (await this.mint("DON-LIVE-01", "CTR-ZH-01")).serial;
      });
      await step("The lab signs unit A's panel: PASSED. Recorded on-chain by the lab's own key.", () =>
        this.submitTest(a, true, "TECH-201")
      );
      await step("Custody transfer to the hospital - the gate contract clears it.", () =>
        this.transfer(a, "HOSPITAL")
      );
      await step("Unit B is minted from the same donation batch.", async () => {
        b = (await this.mint("DON-LIVE-01", "CTR-ZH-01")).serial;
      });
      await step("Unit B FAILS its panel. The result is permanent.", () => this.submitTest(b, false, "TECH-201"));
      await step("Someone tries to ship unit B anyway. The contract refuses - watch the gate.", () =>
        this.transfer(b, "HOSPITAL")
      );
      await step("Unit B is flagged. The batch recall cascades to every sibling - including unit A, already at the hospital.", () =>
        this.flag(b, "contamination suspected")
      );
      await step("The ledger remembers all of it - every event above is a permanent, ordered record. That is the product.", () =>
        this.staleCheck(1), 1500
      );
    } finally {
      this.story.running = false;
      this.story.caption = null;
      this.#notify();
    }
  }
}

export const SIM_CONFIG = {
  network: "simulation",
  tokenId: "0.0.SIM-TOKEN",
  topicId: "0.0.SIM-TOPIC",
  contractId: "0.0.SIM-GATE",
  operatorId: SIM_ACCOUNTS.BANK,
  accounts: SIM_ACCOUNTS,
  configured: false,
  simulated: true,
};

export { SIM_ACCOUNTS };
