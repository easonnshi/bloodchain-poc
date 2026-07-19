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

  console.log("\n=== 1. Organizations register and post 10 HBAR bonds ===");
  await tolerate("bank", () => registerOrg({ contractId: oversightId, orgType: OrgType.BloodBank, bondHbar: 10 }));
  await tolerate("lab", () => registerOrg({ contractId: oversightId, orgType: OrgType.Lab, bondHbar: 10, client: lab.client }));
  await tolerate("hospital", () => registerOrg({ contractId: oversightId, orgType: OrgType.Hospital, bondHbar: 10, client: hospital.client }));
  await tolerate("transport", () => registerOrg({ contractId: oversightId, orgType: OrgType.Transport, bondHbar: 10, client: transport.client }));
  console.log("  Registered (or already registered).");

  console.log("\n=== 2. Authority records review scores (off-chain reviews, on-chain record) ===");
  await tolerate("scores", async () => {
    await setReviewScore({ contractId: oversightId, orgAddress: bankAddr, score: 80 });
    await setReviewScore({ contractId: oversightId, orgAddress: labAddr, score: 90 });
    await setReviewScore({ contractId: oversightId, orgAddress: hospitalAddr, score: 70 });
    await setReviewScore({ contractId: oversightId, orgAddress: transportAddr, score: 60 });
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

  console.log("\n=== 7. Verdict: guilty. 5 HBAR slashed from the hospital's bond ===");
  const before = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
  await resolveInvestigation({ contractId: oversightId, investigationId: invId, guilty: true, penaltyHbar: 5 });
  const after = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
  await logEvent(topicId, {
    unitId: serial, eventType: "PENALTY_APPLIED", investigationId: invId,
    slashedHbar: before.bondHbar - after.bondHbar, scandalCount: after.scandalCount,
  });
  console.log(`  Hospital bond: ${before.bondHbar} -> ${after.bondHbar} HBAR. Scandals: ${before.scandalCount} -> ${after.scandalCount}. Suspended: ${after.suspended}`);

  console.log("\n=== 8. Trace the nurse from the unit's own record, suspend on-chain ===");
  const unitRecord = getUnit(serial);
  console.log(`  Unit #${serial} was tested by: ${unitRecord.staffId}`);
  await tolerate("suspend staff", () => suspendStaff({ contractId: oversightId, staffId: unitRecord.staffId }));
  await logEvent(topicId, { unitId: serial, eventType: "STAFF_SUSPENDED", staffId: unitRecord.staffId });
  console.log(`  Staff ${unitRecord.staffId} suspended (their hash is now blocked).`);

  console.log("\n=== 9. Weighted DAO election for the oversight authority role ===");
  const weights = {
    bank: await getVoteWeight({ contractId: oversightId, orgAddress: bankAddr }),
    lab: await getVoteWeight({ contractId: oversightId, orgAddress: labAddr }),
    hospital: await getVoteWeight({ contractId: oversightId, orgAddress: hospitalAddr }),
    transport: await getVoteWeight({ contractId: oversightId, orgAddress: transportAddr }),
  };
  console.log("  Vote weights (tenure + reviews - scandals):", weights);
  console.log("  Note the hospital's weight: dragged down by its fresh scandal.");

  await tolerate("startElection", () => startElection({ contractId: oversightId, candidateAddresses: [bankAddr, labAddr] }));
  await tolerate("bank votes bank", () => castVote({ contractId: oversightId, candidateAddress: bankAddr }));
  await tolerate("lab votes lab", () => castVote({ contractId: oversightId, candidateAddress: labAddr, client: lab.client }));
  await tolerate("transport votes lab", () => castVote({ contractId: oversightId, candidateAddress: labAddr, client: transport.client }));
  await tolerate("hospital votes bank", () => castVote({ contractId: oversightId, candidateAddress: bankAddr, client: hospital.client }));
  await tolerate("closeElection", () => closeElection({ contractId: oversightId }));

  const newAuthority = await getAuthority({ contractId: oversightId });
  const winnerName = newAuthority.toLowerCase().includes(labAddr.toLowerCase().replace("0x", ""))
    ? "the LAB"
    : "the BLOOD BANK";
  await logEvent(topicId, { unitId: serial, eventType: "AUTHORITY_ELECTED", newAuthority });
  console.log(`  New oversight authority: ${newAuthority} (${winnerName})`);

  console.log("\nOversight demo complete.");
  console.log("Every step above (alert, investigation, penalty, staff suspension, election) is now a permanent HCS record.");
}

main().catch((err) => {
  console.error("Oversight demo failed:", err);
  process.exit(1);
});
