// scripts/compileContract.js
//
// Compiles contracts/BloodUnitGate.sol into bytecode + ABI using solc.
// Run this whenever you change the .sol file, before 03-deployContract.js.
//
//   npm install solc --save-dev
//   node scripts/compileContract.js
//
// Writes contracts/BloodUnitGate.json (abi + bytecode).

import solc from "solc";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "..", "contracts", "BloodUnitGate.sol");
const outputPath = path.join(__dirname, "..", "contracts", "BloodUnitGate.json");

const source = readFileSync(sourcePath, "utf-8");

const input = {
  language: "Solidity",
  sources: { "BloodUnitGate.sol": { content: source } },
  settings: {
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === "error");
  for (const e of output.errors) console.log(e.formattedMessage);
  if (fatal.length) process.exit(1);
}

const contract = output.contracts["BloodUnitGate.sol"]["BloodUnitGate"];

writeFileSync(
  outputPath,
  JSON.stringify(
    { abi: contract.abi, bytecode: contract.evm.bytecode.object },
    null,
    2
  )
);

console.log(`Compiled. Wrote ${outputPath}`);
