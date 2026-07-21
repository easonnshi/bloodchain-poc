// src/transferCustody.js
//
// The enforcement point. Before moving the token, this asks
// BloodUnitGate.requireClearance() whether the unit is allowed to move. If
// the contract call reverts (no passed test on record), the transfer never
// happens - not "we would have blocked it," an actual halt.

import { ContractExecuteTransaction, ContractFunctionParameters, TransferTransaction } from "@hashgraph/sdk";
import { client } from "./hederaConfig.js";
import { upsertUnit } from "./localIndex.js";
import { logEvent } from "./logEvent.js";

/**
 * @param {object} params
 * @param {string} params.contractId
 * @param {string} params.topicId
 * @param {string} params.tokenId
 * @param {string} params.serial
 * @param {AccountId} params.fromAccountId - current holder
 * @param {PrivateKey} params.fromPrivateKey - current holder's key (must sign the NFT transfer)
 * @param {AccountId} params.toAccountId - receiving party (must already be registered via registerParty)
 * @returns {Promise<{blocked: boolean}>}
 */
export async function transferCustody({
  contractId,
  topicId,
  tokenId,
  serial,
  fromAccountId,
  fromPrivateKey,
  toAccountId,
}) {
  // 1. Ask the contract. This call reverts if testStatus[serial] != Passed.
  const checkTx = await new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(150_000)
    .setFunction("requireClearance", new ContractFunctionParameters().addInt64(Number(serial)))
    .freezeWith(client);

  const checkSubmit = await checkTx.execute(client);

  let cleared = true;
  try {
    await checkSubmit.getReceipt(client); // throws ReceiptStatusError on revert
  } catch (err) {
    // Only an actual contract revert means "the gate blocked this unit."
    // Anything else (network failure, expired transaction, fee problem) is
    // an infrastructure error, and must NOT be recorded on the permanent
    // HCS log as TRANSFER_BLOCKED - that would be a false fraud signal in
    // an audit trail that is supposed to be trustworthy. Rethrow those.
    if (!String(err.status ?? err.message).includes("CONTRACT_REVERT")) {
      throw err;
    }
    cleared = false;
  }

  if (!cleared) {
    upsertUnit(serial, { status: "transfer_blocked" });
    await logEvent(topicId, {
      unitId: serial,
      eventType: "TRANSFER_BLOCKED",
      attemptedTo: toAccountId.toString(),
    });
    console.log(`Transfer of unit #${serial} BLOCKED by contract - missing or failed test.`);
    return { blocked: true };
  }

  // 2. Contract says go - move the actual NFT. This requires the sender's
  // own signature (registerParty already associated the receiver's account).
  const transferTx = await new TransferTransaction()
    .addNftTransfer(tokenId, Number(serial), fromAccountId, toAccountId)
    .freezeWith(client)
    .sign(fromPrivateKey);

  const submit = await transferTx.execute(client);
  const receipt = await submit.getReceipt(client);

  // heldSince starts the clock the stale-unit monitor checks against: a
  // unit sitting with one holder past the allowed window with no
  // transfusion or disposal logged is the signal for possible diversion.
  upsertUnit(serial, {
    status: "in_transit",
    holder: toAccountId.toString(),
    heldSince: new Date().toISOString(),
  });
  await logEvent(topicId, {
    unitId: serial,
    eventType: "CUSTODY_TRANSFER",
    from: fromAccountId.toString(),
    to: toAccountId.toString(),
  });

  console.log(`Unit #${serial} transferred to ${toAccountId.toString()} (${receipt.status.toString()})`);
  return { blocked: false };
}
