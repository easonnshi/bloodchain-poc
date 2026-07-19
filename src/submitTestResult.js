// src/submitTestResult.js
//
// Records a lab's pass/fail result in two places: on the BloodUnitGate
// contract (so transferCustody() can enforce it) and on HCS (so it shows up
// in the permanent event log alongside every other custody event). The
// local index also gets updated so status checks don't need a chain read.

import { ContractExecuteTransaction, ContractFunctionParameters } from "@hashgraph/sdk";
import { client } from "./hederaConfig.js";
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
 */
export async function submitTestResult({ contractId, topicId, serial, passed, testType = "infectious_disease_panel", staffId = "STAFF-UNRECORDED" }) {
  const tx = await new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(200_000)
    .setFunction(
      "submitTestResult",
      new ContractFunctionParameters().addInt64(Number(serial)).addBool(passed)
    )
    .freezeWith(client);
  // NOTE (POC simplification): this calls the contract as the operator
  // account, which the contract's constructor already trusts as an
  // authorized lab. In production each real lab would sign this with its
  // own key, after the council calls authorizeLab() for that lab's address.

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  const status = passed ? "tested_pass" : "tested_fail";
  upsertUnit(serial, { status, testType, staffId, testedAt: new Date().toISOString() });

  await logEvent(topicId, {
    unitId: serial,
    eventType: "TEST_RESULT",
    testType,
    passed,
    staffId,
  });

  console.log(`Unit #${serial} test result on-chain: ${passed ? "PASS" : "FAIL"} (${receipt.status.toString()})`);
  return status;
}
