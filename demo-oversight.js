// demo-oversight.js
//
// Acts out the anti-fraud scenario end to end:
//
//   1. All four organizations register on the oversight contract, each
//      posting a 10 HBAR bond with their OWN account (real msg.sender).
//   2. The hospital registers its nurse (as a hash, no personal data).
//   3. A unit is minted, tested (tagged with the nurse's staff ID), and
//      transferred to the hospital.
//   4. The hospital then... does nothing. No transfusion logged. The
//      stale-unit monitor notices the silence and fires a STALE_ALERT.
//      (Demo threshold: seconds instead of 10 days.)
//   5. An investigation is opened against the hospital on-chain.
//   6. The authority finds it guilty: 5 HBAR slashed from its bond,
//      scandal count incremented, all permanently on-chain.
//   7. The unit's history is traced back to the nurse who tested it;
//      the nurse's staff hash is suspended on-chain.
//   8. A weighted DAO election is held for the oversight authority role.
//      The hospital votes too, but its fresh scandal has cut its weight.
//
// Prerequisites beyond demo.js:
//   node scripts/compileContract.js BloodOversight
//   node scripts/04-deployOversight.js   -> OVERSIGHT_CONTRACT_ID in .env
//
//   node demo-oversight.js

import dotenv from "dotenv";
dotenv.config();

import { operatorId, operatorKey, makePartyClient } from "./src/hederaConfig.js";
import { getEvmAddress } from "./src/mirrorNode.js";
import { mintUnit } from "./src/mintUnit.js";
import { submitTestResult } from "./src/submitTestResult.js";
import { transferCustody } from "./src/transferCustody.js";
import { checkStaleUnits } from "./src/checkStaleUnits.js";
import { getUnit } from "./src/localIndex.js";
import { logEvent } from "./src/logEvent.js";
import {
  OrgType,
  registerOrg,
  setReviewScore,
  openInvestigation,
  resolveInvestigation,
  registerStaff,
  suspendStaff,
  topUpBond,
  reinstateOrg,
  startElection,
  castVote,
  closeElection,
  getAuthority,
  getVoteWeight,
  getOrgStatus,
} from "./src/oversight.js";

const {
  TOKEN_ID: tokenId,
  TOPIC_ID: topicId,
  CONTRACT_ID: contractId,
  OVERSIGHT_CONTRACT_ID: oversightId,
} = process.env;

if (!tokenId || !topicId || !contractId || !oversightId) {
  console.error(
    "Need TOKEN_ID, TOPIC_ID, CONTRACT_ID and OVERSIGHT_CONTRACT_ID in .env. Run the setup scripts first."
  );
  process.exit(1);
}

const NURSE_ID = "NURSE-007";
const STALE_THRESHOLD_MS = 5_000; // stands in for 10 days; production uses STALE_THRESHOLD_DAYS
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Contract calls that legitimately fail on re-runs (already registered,
// already voted) shouldn't kill the demo.
async function tolerate(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.log(`  (${label}: skipped - ${err.message.split("\n")[0]})`);
    return null;
  }
}

async function main() {
  const lab = makePartyClient("LAB");
  const hospital = makePartyClient("HOSPITAL");
  const transport = makePartyClient("TRANSPORT");

  console.log("\n=== 0. Resolve each account's EVM address (via mirror node) ===");
  const [bankAddr, labAddr, hospitalAddr, transportAddr] = await Promise.all([
    getEvmAddress(operatorId),
    getEvmAddress(lab.accountId),
    getEvmAddress(hospital.accountId),
    getEvmAddress(transport.accountId),
  ]);
  console.log(`  blood bank: ${bankAddr}\n  lab: ${labAddr}\n  hospital: ${hospitalAddr}\n  transport: ${transportAddr}`);

  // Authority-only calls (verdicts, penalties, elections) must be signed by
  // whoever CURRENTLY holds the authority role. On a fresh contract that's
  // the deployer (blood bank), but after an election it can be any org, so
  // ask the contract instead of assuming. Without this, re-running the demo
  // after an election fails with "not the oversight authority".
  const orgDirectory = {
    [bankAddr.toLowerCase()]: { name: "blood bank", client: undefined }, // undefined = default operator client
    [labAddr.toLowerCase()]: { name: "lab", client: lab.client },
    [hospitalAddr.toLowerCase()]: { name: "hospital", client: hospital.client },
    [transportAddr.toLowerCase()]: { name: "transport", client: transport.client },
  };
  const currentAuthority = (await getAuthority({ contractId: oversightId })).toLowerCase();
  const authorityOrg = orgDirectory[currentAuthority] ?? { name: "deployer", client: undefined };
  const authClient = authorityOrg.client;
  console.log(`  Current oversight authority: ${currentAuthority} (the ${authorityOrg.name})`);

  console.log("\n=== 1. Organizations register and post 10 HBAR bonds ===");
  await tolerate("bank", () => registerOrg({ contractId: oversightId, orgType: OrgType.BloodBank, bondHbar: 10 }));
  await tolerate("lab", () => registerOrg({ contractId: oversightId, orgType: OrgType.Lab, bondHbar: 10, client: lab.client }));
  await tolerate("hospital", () => registerOrg({ contractId: oversightId, orgType: OrgType.Hospital, bondHbar: 10, client: hospital.client }));
  await tolerate("transport", () => registerOrg({ contractId: oversightId, orgType: OrgType.Transport, bondHbar: 10, client: transport.client }));
  console.log("  Registered (or already registered).");

  console.log("\n=== 2. Authority records review scores (off-chain reviews, on-chain record) ===");
  await tolerate("scores", async () => {
    await setReviewScore({ contractId: oversightId, orgAddress: bankAddr, score: 80, client: authClient });
    await setReviewScore({ contractId: oversightId, orgAddress: labAddr, score: 90, client: authClient });
    await setReviewScore({ contractId: oversightId, orgAddress: hospitalAddr, score: 70, client: authClient });
    await setReviewScore({ contractId: oversightId, orgAddress: transportAddr, score: 60, client: authClient });
  });

  console.log("\n=== 3. Hospital registers its nurse (hash only, no personal data) ===");
  await tolerate("staff", () => registerStaff({ contractId: oversightId, staffId: NURSE_ID, client: hospital.client }));

  console.log("\n=== 4. A unit is minted, tested by the nurse, and sent to the hospital ===");
  const serial = await mintUnit({ tokenId, topicId, donorBatchId: "BATCH-OVS-001", collectionCenterId: "CTR-01" });
  await submitTestResult({ contractId, topicId, serial, passed: true, staffId: NURSE_ID });
  await transferCustody({
    contractId, topicId, tokenId, serial,
    fromAccountId: operatorId, fromPrivateKey: operatorKey,
    toAccountId: hospital.accountId,
  });

  console.log("\n=== 5. Hospital logs nothing further. Stale monitor runs after the window ===");
  console.log(`  (waiting ${STALE_THRESHOLD_MS / 1000}s to simulate the 10-day holding limit)`);
  await sleep(STALE_THRESHOLD_MS + 3_000);
  const stale = await checkStaleUnits({ topicId, thresholdMs: STALE_THRESHOLD_MS });

  if (stale.length === 0) {
    console.log("Nothing stale; stopping here.");
    return;
  }

  console.log("\n=== 6. Investigation opened against the hospital, on-chain ===");
  const invId = await openInvestigation({
    contractId: oversightId,
    subjectAddress: hospitalAddr,
    serial,
    reason: `unit ${serial} held past limit with no transfusion or disposal logged`,
  });
  await logEvent(topicId, { unitId: serial, eventType: "INVESTIGATION_OPENED", investigationId: invId, subject: "hospital" });
  console.log(`  Investigation #${invId} opened.`);

  console.log("\n=== 7. Verdict: guilty. 2 HBAR requested, capped at 20% of remaining bond ===");
  const before = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
  await resolveInvestigation({ contractId: oversightId, investigationId: invId, guilty: true, penaltyHbar: 2, client: authClient });
  const after = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
  await logEvent(topicId, {
    unitId: serial, eventType: "PENALTY_APPLIED", investigationId: invId,
    slashedHbar: before.bondHbar - after.bondHbar, scandalCount: after.scandalCount,
  });
  console.log(`  Hospital bond: ${before.bondHbar} -> ${after.bondHbar} HBAR. Scandals: ${before.scandalCount} -> ${after.scandalCount}. Suspended: ${after.suspended}`);

  console.log("\n=== 8. Trace the nurse from the unit's own record, suspend on-chain ===");
  const unitRecord = getUnit(serial);
  console.log(`  Unit #${serial} was tested by: ${unitRecord.staffId}`);
  await tolerate("suspend staff", () => suspendStaff({ contractId: oversightId, staffId: unitRecord.staffId, client: authClient }));
  await logEvent(topicId, { unitId: serial, eventType: "STAFF_SUSPENDED", staffId: unitRecord.staffId });
  console.log(`  Staff ${unitRecord.staffId} suspended (their hash is now blocked).`);

  console.log("\n=== 9. Weighted DAO election for the oversight authority role ===");
  // Wrapped per-org: a single reverting view call must not abort the
  // election below it. On revert we also dump the org's raw stored state
  // (bond/scandals/reviewScore) so a genuine contract bug is diagnosable
  // instead of just crashing with a Panic and no context.
  const weights = {};
  for (const [name, addr] of [["bank", bankAddr], ["lab", labAddr], ["hospital", hospitalAddr], ["transport", transportAddr]]) {
    weights[name] = await tolerate(`voteWeight(${name})`, () => getVoteWeight({ contractId: oversightId, orgAddress: addr }));
    if (weights[name] === null) {
      const raw = await tolerate(`orgStatus(${name}) diagnostic`, () => getOrgStatus({ contractId: oversightId, orgAddress: addr }));
      console.log(`    raw org state for ${name}:`, raw);
    }
  }
  console.log("  Vote weights (tenure + reviews - scandals):", weights);
  console.log("  Note the hospital's weight: dragged down by its fresh scandal.");

  await tolerate("startElection", () => startElection({ contractId: oversightId, candidateAddresses: [bankAddr, labAddr], client: authClient }));
  await tolerate("bank votes bank", () => castVote({ contractId: oversightId, candidateAddress: bankAddr }));
  await tolerate("lab votes lab", () => castVote({ contractId: oversightId, candidateAddress: labAddr, client: lab.client }));
  await tolerate("transport votes lab", () => castVote({ contractId: oversightId, candidateAddress: labAddr, client: transport.client }));
  await tolerate("hospital votes bank", () => castVote({ contractId: oversightId, candidateAddress: bankAddr, client: hospital.client }));
  await tolerate("closeElection", () => closeElection({ contractId: oversightId, client: authClient }));

  const newAuthority = (await getAuthority({ contractId: oversightId })).toLowerCase();
  const winner = orgDirectory[newAuthority] ?? { name: "unknown" };
  await logEvent(topicId, { unitId: serial, eventType: "AUTHORITY_ELECTED", newAuthority });
  console.log(`  New oversight authority: ${newAuthority} (the ${winner.name})`);

  console.log("\n=== 10. Rehabilitation: if the hospital is suspended, it can earn its way back ===");
  const status = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
  if (status.suspended) {
    const shortfall = Math.max(0, 10 - status.bondHbar);
    console.log(`  Hospital is suspended with a ${status.bondHbar} HBAR bond. Topping up ${shortfall} HBAR...`);
    await tolerate("top up bond", () => topUpBond({ contractId: oversightId, amountHbar: shortfall, client: hospital.client }));
    // The new authority (possibly the lab, after the election) decides reinstatement.
    const authorityNow = orgDirectory[(await getAuthority({ contractId: oversightId })).toLowerCase()];
    await tolerate("reinstate", () => reinstateOrg({ contractId: oversightId, orgAddress: hospitalAddr, client: authorityNow?.client }));
    const restored = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
    await logEvent(topicId, { unitId: serial, eventType: "ORG_REINSTATED", org: "hospital", bondHbar: restored.bondHbar, scandalCount: restored.scandalCount });
    console.log(`  Hospital reinstated: suspended=${restored.suspended}, bond=${restored.bondHbar} HBAR, scandals=${restored.scandalCount} (one forgiven).`);
  } else {
    console.log(`  Hospital was penalized but not suspended (bond ${status.bondHbar} HBAR, scandals ${status.scandalCount}) - graduated punishment working as intended.`);
  }

  console.log("\nOversight demo complete.");
  console.log("Every step above (alert, investigation, penalty, staff suspension, election) is now a permanent HCS record.");
}

main().catch((err) => {
  console.error("Oversight demo failed:", err);
  process.exit(1);
});
