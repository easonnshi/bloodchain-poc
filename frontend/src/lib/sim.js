// Simulation engine. When no Hedera credentials are configured (or the local
// API server is down), the app runs against this instead of testnet: same
// state shapes, same action surface, same event semantics as the real
// backend, driven in-memory. A visible SIMULATION badge is shown the whole
// time - this mode exists so the UI can be developed, demoed, and graded
// without keys, never to fake verifiability. In live mode every one of
// these actions is a real signed transaction with a HashScan link.

const ROLES = ["BANK", "LAB", "HOSPITAL", "TRANSPORT"];
const ROLE_NAMES = {
  BANK: "Zurich Blood Bank",
  LAB: "Diagnostics Lab AG",
  HOSPITAL: "University Hospital",
  TRANSPORT: "MedTransport GmbH",
};
const SIM_ACCOUNTS = {
  BANK: "0.0.900001",
  LAB: "0.0.900002",
  HOSPITAL: "0.0.900003",
  TRANSPORT: "0.0.900004",
};

const now = () => Date.now();
const monthsAgo = (m) => new Date(now() - m * 30 * 86400_000).toISOString();
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
    this.oversight = {
      authority: "LAB",
      election: { open: false, id: 1, candidates: [], votes: [] },
      investigations: [
        {
          id: 0,
          subjectRole: "HOSPITAL",
          serial: "97",
          reason: "unit 97 held 14 days with no transfusion or disposal logged",
          resolved: true,
          guilty: true,
          penaltyHbar: 2,
        },
      ],
      staff: {
        "NURSE-114": { employer: "HOSPITAL", suspended: false },
        "TECH-201": { employer: "LAB", suspended: false },
      },
      orgs: {
        BANK: this.#org("BloodBank", 9, 10, 0, 80, false),
        LAB: this.#org("Lab", 12, 10, 0, 90, false),
        HOSPITAL: this.#org("Hospital", 7, 8, 1, 70, false),
        TRANSPORT: this.#org("Transport", 4, 10, 0, 60, false),
      },
    };
    this.#seed();
  }

  #org(type, tenureMonths, bondHbar, scandalCount, reviewScore, suspended) {
    return { type, registeredAt: monthsAgo(tenureMonths), bondHbar, scandalCount, reviewScore, suspended };
  }

  voteWeight(role) {
    const o = this.oversight.orgs[role];
    if (!o || o.suspended) return 0;
    const tenureMonths = Math.floor((now() - Date.parse(o.registeredAt)) / (30 * 86400_000));
    const base = 10 + tenureMonths * 2 + Math.floor(o.reviewScore / 10);
    const malus = o.scandalCount * 2;
    return malus >= base ? 1 : base - malus;
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

    // The diversion-gap exhibit: transfused on paper, but reconciliation
    // against patient records won't find a matching record (see Reconcile).
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
    const staff = this.oversight.staff[staffId];
    if (staff?.suspended) {
      throw new Error(`staff ${staffId} is suspended on-chain - result rejected`);
    }
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

  // ---- oversight ---------------------------------------------------------

  oversightStatus() {
    const orgs = {};
    for (const role of ROLES) {
      const o = this.oversight.orgs[role];
      orgs[role] = {
        role,
        name: ROLE_NAMES[role],
        address: SIM_ACCOUNTS[role],
        bondHbar: o.bondHbar,
        scandalCount: o.scandalCount,
        reviewScore: o.reviewScore,
        suspended: o.suspended,
        voteWeight: this.voteWeight(role),
        isAuthority: this.oversight.authority === role,
      };
    }
    return {
      authority: this.oversight.authority,
      orgs,
      election: this.oversight.election,
      investigations: this.oversight.investigations,
      staff: this.oversight.staff,
    };
  }

  async openInvestigation(subjectRole, serial, reason, openedByRole = "TRANSPORT") {
    await sleep(SEAL_MS);
    const id = this.oversight.investigations.length;
    this.oversight.investigations.push({
      id,
      subjectRole,
      serial: String(serial),
      reason,
      openedByRole,
      resolved: false,
      guilty: false,
      penaltyHbar: 0,
    });
    this.#event({ unitId: String(serial), eventType: "INVESTIGATION_OPENED", investigationId: id, subject: subjectRole });
    this.#notify();
    return { investigationId: id };
  }

  async resolveInvestigation(id, guilty, penaltyHbar) {
    await sleep(SEAL_MS);
    const inv = this.oversight.investigations[id];
    if (!inv || inv.resolved) throw new Error("investigation missing or already resolved");
    inv.resolved = true;
    inv.guilty = guilty;
    if (guilty) {
      const org = this.oversight.orgs[inv.subjectRole];
      const maxSlash = org.bondHbar * 0.2; // MAX_PENALTY_BPS, verbatim
      const slash = Math.min(penaltyHbar, maxSlash);
      inv.penaltyHbar = Number(slash.toFixed(2));
      org.bondHbar = Number((org.bondHbar - slash).toFixed(2));
      org.scandalCount += 1;
      if (org.bondHbar < 2.5 || org.scandalCount >= 5) org.suspended = true;
    }
    this.#event({
      unitId: inv.serial,
      eventType: "PENALTY_APPLIED",
      investigationId: id,
      guilty,
      penaltyHbar: inv.penaltyHbar,
      subject: inv.subjectRole,
    });
    this.#notify();
    return { status: "SUCCESS" };
  }

  async suspendStaff(staffId) {
    await sleep(SEAL_MS);
    const staff = this.oversight.staff[staffId];
    if (!staff) throw new Error(`unknown staff ${staffId}`);
    staff.suspended = true;
    this.#event({ unitId: "-", eventType: "STAFF_SUSPENDED", staffId });
    this.#notify();
    return { status: "SUCCESS" };
  }

  async registerStaff(role, staffId) {
    await sleep(SEAL_MS);
    this.oversight.staff[staffId] = { employer: role, suspended: false };
    this.#notify();
    return { status: "SUCCESS" };
  }

  async startElection(candidateRoles) {
    await sleep(SEAL_MS);
    const el = this.oversight.election;
    if (el.open) throw new Error("election already open");
    el.open = true;
    el.id += 1;
    el.candidates = candidateRoles;
    el.votes = [];
    this.#event({ unitId: "-", eventType: "ELECTION_STARTED", electionId: el.id, candidates: candidateRoles });
    this.#notify();
    return { status: "SUCCESS" };
  }

  async castVote(voterRole, candidateRole) {
    await sleep(SEAL_MS);
    const el = this.oversight.election;
    if (!el.open) throw new Error("no open election");
    if (el.votes.some((v) => v.voter === voterRole)) throw new Error(`${voterRole} already voted`);
    const weight = this.voteWeight(voterRole);
    if (weight <= 0) throw new Error(`${voterRole} is not eligible to vote`);
    el.votes.push({ voter: voterRole, candidate: candidateRole, weight });
    this.#notify();
    return { status: "SUCCESS", weight };
  }

  async closeElection() {
    await sleep(SEAL_MS);
    const el = this.oversight.election;
    if (!el.open) throw new Error("no open election");
    const tally = {};
    for (const v of el.votes) tally[v.candidate] = (tally[v.candidate] || 0) + v.weight;
    const winner = el.candidates.reduce(
      (best, c) => ((tally[c] || 0) > (tally[best] || 0) ? c : best),
      el.candidates[0]
    );
    el.open = false;
    this.oversight.authority = winner;
    this.#event({ unitId: "-", eventType: "AUTHORITY_ELECTED", electionId: el.id, newAuthority: winner });
    this.#notify();
    return { status: "SUCCESS", newAuthority: winner };
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

    this.story = { running: true, step: 0, total: 12, caption: null };
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
      await step("Days pass. Unit A is never transfused, never disposed. The silence itself is the signal.", () =>
        this.staleCheck(1)
      );
      await step("Any member can flag the silence: transport opens an on-chain investigation against the hospital.", async () => {
        const inv = await this.openInvestigation("HOSPITAL", a, `unit ${a} held past limit with no closing event`, "TRANSPORT");
        this._storyInv = inv.investigationId;
      });
      await step("Verdict: guilty. The bond is slashed on-chain - capped at 20%, graduated, permanent.", () =>
        this.resolveInvestigation(this._storyInv, true, 2)
      );
      await step("A new election begins. The hospital votes - with a visibly smaller voice.", async () => {
        await this.startElection(["BANK", "LAB"]);
        await this.castVote("BANK", "BANK");
        await this.castVote("LAB", "LAB");
        await this.castVote("TRANSPORT", "LAB");
        await this.castVote("HOSPITAL", "BANK");
      });
      await step("The ledger remembers all of it. That is the product.", () => this.closeElection(), 1500);
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
  oversightContractId: "0.0.SIM-OVERSIGHT",
  operatorId: SIM_ACCOUNTS.BANK,
  accounts: SIM_ACCOUNTS,
  configured: false,
  simulated: true,
};

export { ROLE_NAMES, SIM_ACCOUNTS };
