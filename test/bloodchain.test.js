// test/bloodchain.test.js
//
// These run against real Hedera testnet (there's no free local Hedera
// simulator equivalent to Hardhat's), so they're closer to integration
// tests than pure unit tests - but they cover the three behaviors that
// actually matter to prove the design works:
//
//   1. mint succeeds and returns a usable serial number
//   2. a transfer is blocked when the unit's test failed
//   3. flagBatch finds every sibling unit from the same donation batch
//
// Requires .env fully configured (TOKEN_ID, TOPIC_ID, CONTRACT_ID, and the
// LAB party credentials) and a funded testnet operator account. Run with:
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import { operatorId, operatorKey, makePartyClient } from "../src/hederaConfig.js";
import { mintUnit } from "../src/mintUnit.js";
import { submitTestResult } from "../src/submitTestResult.js";
import { transferCustody } from "../src/transferCustody.js";
import { flagBatch } from "../src/flagBatch.js";

const { TOKEN_ID: tokenId, TOPIC_ID: topicId, CONTRACT_ID: contractId } = process.env;
const configured = Boolean(tokenId && topicId && contractId && process.env.LAB_ACCOUNT_ID && process.env.LAB_ACCOUNT_KEY);

const batchId = `TEST-BATCH-${Date.now()}`;

test("mintUnit succeeds and returns a serial number", { skip: !configured && "run scripts/01-03 and fill in .env first" }, async () => {
  const serial = await mintUnit({ tokenId, topicId, donorBatchId: batchId, collectionCenterId: "CTR-TEST" });
  assert.ok(serial, "expected a truthy serial number");
  assert.match(serial, /^\d+$/, "serial should be numeric");
});

test("transferCustody blocks a unit that failed its test", { skip: !configured && "run scripts/01-03 and fill in .env first" }, async () => {
  const lab = makePartyClient("LAB");
  const serial = await mintUnit({ tokenId, topicId, donorBatchId: batchId, collectionCenterId: "CTR-TEST" });

  // Signed by the lab's own key - exercises the contract's onlyAuthorizedLab
  // path for real (requires scripts/05-authorizeLab.js to have been run).
  await submitTestResult({ contractId, topicId, serial, passed: false, client: lab.client });

  const result = await transferCustody({
    contractId,
    topicId,
    tokenId,
    serial,
    fromAccountId: operatorId,
    fromPrivateKey: operatorKey,
    toAccountId: lab.accountId,
  });

  assert.equal(result.blocked, true, "transfer of a failed-test unit should be blocked");
});

test("flagBatch quarantines every sibling from the same donor batch", { skip: !configured && "run scripts/01-03 and fill in .env first" }, async () => {
  const siblingBatch = `TEST-BATCH-SIBLINGS-${Date.now()}`;

  const serialA = await mintUnit({ tokenId, topicId, donorBatchId: siblingBatch, collectionCenterId: "CTR-TEST" });
  const serialB = await mintUnit({ tokenId, topicId, donorBatchId: siblingBatch, collectionCenterId: "CTR-TEST" });
  const serialC = await mintUnit({ tokenId, topicId, donorBatchId: siblingBatch, collectionCenterId: "CTR-TEST" });

  const { quarantinedSiblings } = await flagBatch({ topicId, serial: serialA, reason: "unit test" });

  assert.ok(quarantinedSiblings.includes(serialB), "sibling B should be quarantined");
  assert.ok(quarantinedSiblings.includes(serialC), "sibling C should be quarantined");
});
