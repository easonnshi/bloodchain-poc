// scripts/compileContract.js
//
// Compiles a contract from contracts/ into bytecode + ABI using solc.
// Run whenever you change a .sol file, before the matching deploy script.
//
//   node scripts/compileContract.js                  (compiles BloodUnitGate)
//   node scripts/compileContract.js BloodOversight   (compiles BloodOversight)
//
// Writes contracts/<Name>.json (abi + bytecode). Assumes the contract
// inside the file has the same name as the file.

import solc from "solc";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const name = process.argv[2] || "BloodUnitGate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "..", "contracts", `${name}.sol`);
const outputPath = path.join(__dirname, "..", "contracts", `${name}.json`);

const source = readFileSync(sourcePath, "utf-8");

const input = {
  language: "Solidity",
  sources: { [`${name}.sol`]: { content: source } },
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

const contract = output.contracts[`${name}.sol`][name];

writeFileSync(
  outputPath,
  JSON.stringify(
    { abi: contract.abi, bytecode: contract.evm.bytecode.object },
    null,
    2
  )
);

console.log(`Compiled ${name}. Wrote ${outputPath}`);
