// src/oversight.js
//
// JS wrappers around the BloodOversight contract. Every function takes an
// optional `client` so calls can be signed by a specific party (via
// makePartyClient in hederaConfig.js). That matters because the contract
// keys everything off msg.sender: a hospital's bond, vote, and guilt all
// attach to the hospital's own account, not to whoever ran the script.

import {
  ContractExecuteTransaction,
  ContractCallQuery,
  ContractFunctionParameters,
  Hbar,
} from "@hashgraph/sdk";
import { createHash } from "node:crypto";
import { client as defaultClient } from "./hederaConfig.js";

const GAS = 400_000;

export const OrgType = { BloodBank: 1, Lab: 2, Hospital: 3, Transport: 4 };

/** Staff IDs never go on-chain raw. Only this hash does. */
export function staffHash(staffId) {
  return createHash("sha256").update(staffId, "utf-8").digest(); // 32-byte Buffer
}

/** An org registers itself and posts its HBAR bond in the same call. */
export async function registerOrg({ contractId, orgType, bondHbar, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setPayableAmount(new Hbar(bondHbar))
    .setFunction("registerOrg", new ContractFunctionParameters().addUint8(orgType));
  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  return receipt.status.toString();
}

export async function setReviewScore({ contractId, orgAddress, score, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction(
      "setReviewScore",
      new ContractFunctionParameters().addAddress(orgAddress).addUint256(score)
    );
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

/** Returns the new investigation's numeric ID. */
export async function openInvestigation({ contractId, subjectAddress, serial, reason, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction(
      "openInvestigation",
      new ContractFunctionParameters()
        .addAddress(subjectAddress)
        .addInt64(Number(serial))
        .addString(reason)
    );
  const submit = await tx.execute(client);
  const record = await submit.getRecord(client); // record (not receipt) carries the return value
  return record.contractFunctionResult.getUint256(0).toNumber();
}

export async function resolveInvestigation({ contractId, investigationId, guilty, penaltyHbar, client = defaultClient }) {
  const penaltyTinybars = Math.round(penaltyHbar * 1e8); // contract works in tinybars
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction(
      "resolveInvestigation",
      new ContractFunctionParameters()
        .addUint256(investigationId)
        .addBool(guilty)
        .addUint256(penaltyTinybars)
    );
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

/** Rehabilitation: an org restores its bond by paying in. */
export async function topUpBond({ contractId, amountHbar, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setPayableAmount(new Hbar(amountHbar))
    .setFunction("topUpBond");
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

/** Rehabilitation: the authority reinstates a suspended org whose bond is back at minimum. */
export async function reinstateOrg({ contractId, orgAddress, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction("reinstateOrg", new ContractFunctionParameters().addAddress(orgAddress));
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

export async function registerStaff({ contractId, staffId, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction("registerStaff", new ContractFunctionParameters().addBytes32(staffHash(staffId)));
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

export async function suspendStaff({ contractId, staffId, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction("suspendStaff", new ContractFunctionParameters().addBytes32(staffHash(staffId)));
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

export async function startElection({ contractId, candidateAddresses, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction(
      "startElection",
      new ContractFunctionParameters().addAddressArray(candidateAddresses)
    );
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

export async function castVote({ contractId, candidateAddress, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction("castVote", new ContractFunctionParameters().addAddress(candidateAddress));
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

export async function closeElection({ contractId, client = defaultClient }) {
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(GAS)
    .setFunction("closeElection");
  const submit = await tx.execute(client);
  return (await submit.getReceipt(client)).status.toString();
}

// ---- read-only queries ----

export async function getAuthority({ contractId, client = defaultClient }) {
  const result = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(100_000)
    .setFunction("authority")
    .execute(client);
  return "0x" + result.getAddress(0);
}

export async function getVoteWeight({ contractId, orgAddress, client = defaultClient }) {
  const result = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(100_000)
    .setFunction("voteWeight", new ContractFunctionParameters().addAddress(orgAddress))
    .execute(client);
  return result.getUint256(0).toNumber();
}

/** Bond (in HBAR) and scandal count for an org, from the public `orgs` getter. */
export async function getOrgStatus({ contractId, orgAddress, client = defaultClient }) {
  const result = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(100_000)
    .setFunction("orgs", new ContractFunctionParameters().addAddress(orgAddress))
    .execute(client);
  // Struct fields decode in declaration order, one 32-byte slot each:
  // 0 orgType, 1 registeredAt, 2 bond, 3 scandalCount, 4 reviewScore, 5 suspended, 6 exists
  return {
    bondHbar: result.getUint256(2).toNumber() / 1e8,
    scandalCount: result.getUint256(3).toNumber(),
    reviewScore: result.getUint256(4).toNumber(),
    suspended: result.getBool(5),
  };
}
