// src/submitTestResult.js
//
// Records a lab's pass/fail result in two places: on the BloodUnitGate
// contract (so transferCustody() can enforce it) and on HCS (so it shows up
// in the permanent event log alongside every other custody event). The
// local index also gets updated so status checks don't need a chain read.

import { ContractExecuteTransaction, ContractFunctionParameters } from "@hashgraph/sdk";
import { client as defaultClient } from "./hederaConfig.js";
import { upsertUnit } from "./localIndex.js";
import { logEvent } from "./logEvent.js";

/**
 * @param {object} params
 * @param {string} params.contractId - the BloodUnitGate contract ID
 * @param {string} params.topicId - the HCS topic ID
 * @param {string} params.serial - the unit's NFT serial number
 * @param {boolean} params.passed - test outcome
 * @param {string} [params.testType] - e.g. "HIV", "hepatitis_panel"
 * @param {string} [params.staffId] - ID of the nurse/technician who ran the
 *   test. Recorded in the HCS log and local index so that if this unit is
 *   later implicated in fraud, the exact person who handled testing can be
 *   traced and investigated (see src/oversight.js suspendStaff).
 * @param {Client} [params.client] - the client whose account signs the
 *   contract call. Pass the LAB's client (makePartyClient("LAB")) so
 *   msg.sender is the lab's own address and the contract's
 *   onlyAuthorizedLab check is doing real work. Defaults to the operator
 *   client, which the contract trusts only because it deployed it - fine
 *   for scratch scripts, but demos and the API server pass the lab client.
 */
export async function submitTestResult({
  contractId,
  topicId,
  serial,
  passed,
  testType = "infectious_disease_panel",
  staffId = "STAFF-UNRECORDED",
  client = defaultClient,
}) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(200_000)
    .setFunction(
      "submitTestResult",
      new ContractFunctionParameters().addInt64(Number(serial)).addBool(passed)
    );

  const submit = await tx.execute(client);
  let receipt;
  try {
    receipt = await submit.getReceipt(client);
  } catch (err) {
    // The most likely revert here is the onlyAuthorizedLab modifier: the
    // signing account was never authorized on the gate contract. Surface
    // that as an actionable message instead of a bare CONTRACT_REVERT.
    if (String(err.status ?? err.message).includes("CONTRACT_REVERT")) {
      throw new Error(
        `submitTestResult reverted for unit #${serial}: the signing account is not an ` +
          `authorized lab on ${contractId}. Run "node scripts/05-authorizeLab.js" once ` +
          `(as the contract owner) to authorize the LAB account from .env.`
      );
    }
    throw err;
  }

  const status = passed ? "tested_pass" : "tested_fail";
  upsertUnit(serial, { status, testType, staffId, testedAt: new Date().toISOString() });

  await logEvent(topicId, {
    unitId: serial,
    eventType: "TEST_RESULT",
    testType,
    passed,
    staffId,
    submittedBy: client.operatorAccountId?.toString(),
  });

  console.log(
    `Unit #${serial} test result on-chain: ${passed ? "PASS" : "FAIL"} ` +
      `(${receipt.status.toString()}, signed by ${client.operatorAccountId?.toString() ?? "operator"})`
  );
  return status;
}
