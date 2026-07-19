// scripts/03-deployContract.js
//
// Deploys the compiled BloodUnitGate contract to Hedera Smart Contract
// Service. Run after compileContract.js.
//
//   node scripts/03-deployContract.js
//
// Prints CONTRACT_ID - add it to .env.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ContractCreateFlow } from "@hashgraph/sdk";
import { client } from "../src/hederaConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(__dirname, "..", "contracts", "BloodUnitGate.json");

async function main() {
  const { bytecode } = JSON.parse(readFileSync(artifactPath, "utf-8"));

  // ContractCreateFlow bundles the file-upload + contract-create steps that
  // HSCS deployment needs into one call - bytecode goes into Hedera's file
  // service first, then the contract is created pointing at that file.
  const tx = new ContractCreateFlow()
    .setBytecode(bytecode)
    .setGas(1_000_000);

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  console.log("Contract deployed.");
  console.log("CONTRACT_ID=" + receipt.contractId.toString());
  console.log("\nAdd that line to your .env file.");
}

main().catch((err) => {
  console.error("Contract deployment failed:", err.message);
  process.exit(1);
});
