// scripts/05-authorizeLab.js
//
// Run once, after 03-deployContract.js. Authorizes the LAB account (from
// .env) as a real lab on the BloodUnitGate contract, so test results can be
// submitted signed by the lab's own key instead of the operator's.
//
// Why this matters: the contract's onlyAuthorizedLab modifier keys off
// msg.sender. Until this script runs, the only trusted lab is the deployer
// (a POC bootstrap). After it runs, submitTestResult() signed by the lab's
// own account is accepted - and the on-chain TestResultRecorded event
// carries the lab's address as submittedBy, which is the whole trust model:
// anyone can verify WHICH lab attested a result, not just that "someone" did.
//
//   node scripts/05-authorizeLab.js
//
// The EVM address a Hedera account appears as inside a contract differs for
// ED25519 vs ECDSA keys, so we ask the mirror node (src/mirrorNode.js)
// rather than deriving it locally.

import { ContractExecuteTransaction, ContractCallQuery, ContractFunctionParameters } from "@hashgraph/sdk";
import { client, loadPartyCredentials } from "../src/hederaConfig.js";
import { getEvmAddress } from "../src/mirrorNode.js";

const contractId = process.env.CONTRACT_ID;
if (!contractId) {
  console.error("CONTRACT_ID missing from .env - run scripts/03-deployContract.js first.");
  process.exit(1);
}

async function main() {
  const lab = loadPartyCredentials("LAB");
  const labAddr = await getEvmAddress(lab.accountId);
  console.log(`Lab account ${lab.accountId} has EVM address ${labAddr}`);

  // authorizeLab is onlyOwner; the operator deployed the contract, so the
  // default operator client is the right signer here.
  const tx = new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(200_000)
    .setFunction("authorizeLab", new ContractFunctionParameters().addAddress(labAddr));
  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  console.log(`authorizeLab(${labAddr}): ${receipt.status.toString()}`);

  // Read it back so a typo'd address fails loudly now, not mid-demo.
  const check = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(100_000)
    .setFunction("authorizedLabs", new ContractFunctionParameters().addAddress(labAddr))
    .execute(client);
  const authorized = check.getBool(0);
  console.log(`Verified on-chain: authorizedLabs[${labAddr}] = ${authorized}`);
  if (!authorized) {
    console.error("Authorization did not stick - check CONTRACT_ID and that the operator is the contract owner.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Lab authorization failed:", err.message);
  process.exit(1);
});
