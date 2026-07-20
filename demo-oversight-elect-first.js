// demo-oversight-elect-first.js
//
// Same contract, same powers, different STORY ORDER than demo-oversight.js.
// That script reuses whatever authority happens to be left over from
// earlier runs and elects again at the very end, after a case is already
// resolved. This script proves the ordering that actually matters for a
// real deployment: the community elects its oversight authority FIRST,
// with no fraud case anywhere in sight, and only afterward does that
// elected org exercise any investigative or punitive power.
//
//   1. All four orgs register with bonds. No investigation exists yet.
//   2. BEFORE anything else happens, an election is held. The deployer
//      (blood bank) is the default authority pre-election purely as a
//      bootstrap fallback - the vote below is what actually decides who
//      governs, and the deployer has no special weight in that vote.
//   3. The newly-elected authority (not the deployer) sets review scores.
//   4. A unit is minted, tested, and sent to the hospital.
//   5. The hospital lets it go stale.
//   6. An ORDINARY member (transport, not the authority) opens the
//      investigation - detection doesn't require holding power, anyone
//      can flag a problem.
//   7. The elected authority - and only the elected authority - resolves
//      the case, slashes the bond, and suspends the implicated nurse.
//
// This is intended to run on a FRESH oversight contract deployment so the
// election isn't influenced by scandal history from earlier demos. Deploy
// a new one first if you want a truly clean slate:
//   node scripts/compileContract.js BloodOversight
//   node scripts/04-deployOversight.js   -> paste OVERSIGHT_CONTRACT_ID into .env
//
//   node demo-oversight-elect-first.js

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
  console.error("Need TOKEN_ID, TOPIC_ID, CONTRACT_ID and OVERSIGHT_CONTRACT_ID in .env.");
  process.exit(1);
}

const NURSE_ID = "NURSE-ELECT-FIRST-DEMO";
const STALE_THRESHOLD_MS = 5_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const orgDirectory = {
    [bankAddr.toLowerCase()]: { name: "blood bank", client: undefined },
    [labAddr.toLowerCase()]: { name: "lab", client: lab.client },
    [hospitalAddr.toLowerCase()]: { name: "hospital", client: hospital.client },
    [transportAddr.toLowerCase()]: { name: "transport", client: transport.client },
  };

  console.log("\n=== 1. All four orgs register with bonds. No investigation exists yet. ===");
  await tolerate("bank registers", () => registerOrg({ contractId: oversightId, orgType: OrgType.BloodBank, bondHbar: 10 }));
  await tolerate("lab registers", () => registerOrg({ contractId: oversightId, orgType: OrgType.Lab, bondHbar: 10, client: lab.client }));
  await tolerate("hospital registers", () => registerOrg({ contractId: oversightId, orgType: OrgType.Hospital, bondHbar: 10, client: hospital.client }));
  await tolerate("transport registers", () => registerOrg({ contractId: oversightId, orgType: OrgType.Transport, bondHbar: 10, client: transport.client }));

  const bootstrapAuthority = (await getAuthority({ contractId: oversightId })).toLowerCase();
  console.log(`  Pre-election default authority (deployer bootstrap only): ${orgDirectory[bootstrapAuthority]?.name ?? bootstrapAuthority}`);

  console.log("\n=== 2. Election held BEFORE any fraud case exists ===");
  const bootstrapClient = orgDirectory[bootstrapAuthority]?.client;
  await tolerate("startElection", () =>
    startElection({ contractId: oversightId, candidateAddresses: [bankAddr, labAddr], client: bootstrapClient })
  );
  // Deliberately elect the LAB, not the deployer - proving power actually
  // transfers by vote rather than staying with whoever deployed the contract.
  await tolerate("bank votes lab", () => castVote({ contractId: oversightId, candidateAddress: labAddr }));
  await tolerate("lab votes lab", () => castVote({ contractId: oversightId, candidateAddress: labAddr, client: lab.client }));
  await tolerate("transport votes lab", () => castVote({ contractId: oversightId, candidateAddress: labAddr, client: transport.client }));
  await tolerate("hospital votes bank", () => castVote({ contractId: oversightId, candidateAddress: bankAddr, client: hospital.client }));
  await tolerate("closeElection", () => closeElection({ contractId: oversightId, client: bootstrapClient }));

  const electedAuthority = (await getAuthority({ contractId: oversightId })).toLowerCase();
  const elected = orgDirectory[electedAuthority] ?? { name: "unknown" };
  const authClient = elected.client;
  console.log(`  Elected oversight authority: ${elected.name} - chosen by vote, with zero fraud cases on record.`);

  console.log("\n=== 2b. Vote weights right after the election (confirms the query workaround too) ===");
  // Same self-payer quirk as demo-oversight.js: a ContractCallQuery whose
  // paying account equals the address being looked up can revert with a
  // Panic that doesn't reproduce with a different payer. Route every query
  // through whichever org ISN'T the one being checked.
  const orgsList = [["bank", bankAddr], ["lab", labAddr], ["hospital", hospitalAddr], ["transport", transportAddr]];
  const payerFor = (targetAddr) => {
    const fallback = orgsList.find(([, a]) => a.toLowerCase() !== targetAddr.toLowerCase());
    return orgDirectory[fallback[1].toLowerCase()]?.client;
  };
  const weights = {};
  for (const [name, addr] of orgsList) {
    weights[name] = await tolerate(`voteWeight(${name})`, () =>
      getVoteWeight({ contractId: oversightId, orgAddress: addr, client: payerFor(addr) })
    );
  }
  console.log("  Vote weights right after election (tenure + reviews - scandals):", weights);

  console.log("\n=== 3. The newly-elected authority - not the deployer - sets review scores ===");
  await tolerate("scores", async () => {
    await setReviewScore({ contractId: oversightId, orgAddress: bankAddr, score: 80, client: authClient });
    await setReviewScore({ contractId: oversightId, orgAddress: labAddr, score: 90, client: authClient });
    await setReviewScore({ contractId: oversightId, orgAddress: hospitalAddr, score: 70, client: authClient });
    await setReviewScore({ contractId: oversightId, orgAddress: transportAddr, score: 60, client: authClient });
  });

  console.log("\n=== 4. Hospital registers its nurse ===");
  await tolerate("staff", () => registerStaff({ contractId: oversightId, staffId: NURSE_ID, client: hospital.client }));

  console.log("\n=== 5. A unit is minted, tested, and sent to the hospital ===");
  const serial = await mintUnit({ tokenId, topicId, donorBatchId: "BATCH-ELECT-FIRST", collectionCenterId: "CTR-01" });
  await submitTestResult({ contractId, topicId, serial, passed: true, staffId: NURSE_ID });
  await transferCustody({
    contractId, topicId, tokenId, serial,
    fromAccountId: operatorId, fromPrivateKey: operatorKey,
    toAccountId: hospital.accountId,
  });

  console.log("\n=== 6. Hospital lets it go stale ===");
  console.log(`  (waiting ${STALE_THRESHOLD_MS / 1000}s to simulate the holding limit)`);
  await sleep(STALE_THRESHOLD_MS + 3_000);
  const stale = await checkStaleUnits({ topicId, thresholdMs: STALE_THRESHOLD_MS });
  if (stale.length === 0) {
    console.log("Nothing stale; stopping here.");
    return;
  }

  console.log("\n=== 7. An ORDINARY member (transport) flags it - detection needs no special power ===");
  const invId = await openInvestigation({
    contractId: oversightId,
    subjectAddress: hospitalAddr,
    serial,
    reason: `unit ${serial} held past limit with no transfusion or disposal logged`,
    client: transport.client,
  });
  await logEvent(topicId, { unitId: serial, eventType: "INVESTIGATION_OPENED", investigationId: invId, subject: "hospital", openedBy: "transport" });
  console.log(`  Investigation #${invId} opened by transport (a plain member, not the authority).`);

  console.log(`\n=== 8. Only the elected authority (${elected.name}) may resolve it ===`);
  const before = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
  await resolveInvestigation({ contractId: oversightId, investigationId: invId, guilty: true, penaltyHbar: 2, client: authClient });
  const after = await getOrgStatus({ contractId: oversightId, orgAddress: hospitalAddr });
  console.log(`  Hospital bond: ${before.bondHbar} -> ${after.bondHbar} HBAR. Scandals: ${before.scandalCount} -> ${after.scandalCount}. Suspended: ${after.suspended}`);

  const unitRecord = getUnit(serial);
  await tolerate("suspend staff", () => suspendStaff({ contractId: oversightId, staffId: unitRecord.staffId, client: authClient }));
  console.log(`  Staff ${unitRecord.staffId} suspended by ${elected.name}.`);

  console.log("\nDemo complete: the oversight authority was chosen by community vote before any fraud existed,");
  console.log("an ordinary member (not the authority) detected and reported the case,");
  console.log(`and only the elected authority (${elected.name}) held the power to judge and punish it.`);
}

main().catch((err) => {
  console.error("Elect-first demo failed:", err);
  process.exit(1);
});
