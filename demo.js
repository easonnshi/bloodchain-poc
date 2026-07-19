// demo.js
//
// Runs the whole story end to end, exactly as laid out in the design doc:
//   mint -> pass a test -> transfer -> mint a sibling -> fail its test ->
//   attempt transfer (blocked) -> flag it -> flagBatch() catches the sibling
//
// Prerequisites (run once, in order):
//   node scripts/01-createToken.js        -> TOKEN_ID
//   node scripts/02-createTopic.js        -> TOPIC_ID
//   node scripts/compileContract.js
//   node scripts/03-deployContract.js     -> CONTRACT_ID
//   node scripts/registerAllParties.js
// (paste each printed ID into .env before continuing)
//
//   node demo.js

import dotenv from "dotenv";
dotenv.config();

import { operatorId, operatorKey, loadPartyCredentials } from "./src/hederaConfig.js";
import { mintUnit } from "./src/mintUnit.js";
import { submitTestResult } from "./src/submitTestResult.js";
import { transferCustody } from "./src/transferCustody.js";
import { flagBatch } from "./src/flagBatch.js";

const { TOKEN_ID: tokenId, TOPIC_ID: topicId, CONTRACT_ID: contractId } = process.env;

if (!tokenId || !topicId || !contractId) {
  console.error("TOKEN_ID / TOPIC_ID / CONTRACT_ID missing from .env - run scripts/01-03 first.");
  process.exit(1);
}

const lab = loadPartyCredentials("LAB");

async function main() {
  console.log("\n=== 1. Mint unit A (a healthy donation) ===");
  const serialA = await mintUnit({
    tokenId,
    topicId,
    donorBatchId: "BATCH-001",
    collectionCenterId: "CTR-01",
  });

  console.log("\n=== 2. Unit A passes its test ===");
  await submitTestResult({ contractId, topicId, serial: serialA, passed: true });

  console.log("\n=== 3. Unit A is transferred to the lab (contract clears it) ===");
  await transferCustody({
    contractId,
    topicId,
    tokenId,
    serial: serialA,
    fromAccountId: operatorId,
    fromPrivateKey: operatorKey,
    toAccountId: lab.accountId,
  });

  console.log("\n=== 4. Mint unit B, a sibling from the SAME donation batch ===");
  const serialB = await mintUnit({
    tokenId,
    topicId,
    donorBatchId: "BATCH-001",
    collectionCenterId: "CTR-01",
  });

  console.log("\n=== 5. Unit B FAILS its test ===");
  await submitTestResult({ contractId, topicId, serial: serialB, passed: false });

  console.log("\n=== 6. Attempt to transfer unit B anyway - contract should block it ===");
  const attempt = await transferCustody({
    contractId,
    topicId,
    tokenId,
    serial: serialB,
    fromAccountId: operatorId,
    fromPrivateKey: operatorKey,
    toAccountId: lab.accountId,
  });
  console.log("Blocked as expected:", attempt.blocked === true);

  console.log("\n=== 7. Flag unit B - batch alert should reach unit A too ===");
  const flagResult = await flagBatch({ topicId, serial: serialB, reason: "contamination suspected" });
  console.log("Quarantined sibling unit(s):", flagResult.quarantinedSiblings);
  console.log(
    flagResult.quarantinedSiblings.includes(serialA)
      ? "\nSUCCESS: unit A (already out the door to the lab) was correctly caught by the batch alert."
      : "\nUNEXPECTED: unit A was not caught - check donorBatchId matching."
  );

  console.log("\nDemo complete.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
