// scripts/04-deployOversight.js
//
// Deploys the compiled BloodOversight contract. Run after:
//   node scripts/compileContract.js BloodOversight
//
//   node scripts/04-deployOversight.js
//
// Prints OVERSIGHT_CONTRACT_ID - add it to .env.
// The deploying account (your operator / blood bank) becomes the initial
// oversight authority until the first DAO election replaces it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ContractCreateFlow } from "@hashgraph/sdk";
import { client } from "../src/hederaConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(__dirname, "..", "contracts", "BloodOversight.json");

async function main() {
  const { bytecode } = JSON.parse(readFileSync(artifactPath, "utf-8"));

  const tx = new ContractCreateFlow()
    .setBytecode(bytecode)
    .setGas(2_000_000); // bigger contract than the gate; generous ceiling, unused gas is refunded

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  console.log("Oversight contract deployed.");
  console.log("OVERSIGHT_CONTRACT_ID=" + receipt.contractId.toString());
  console.log("\nAdd that line to your .env file.");
}

main().catch((err) => {
  console.error("Oversight deployment failed:", err.message);
  process.exit(1);
});
