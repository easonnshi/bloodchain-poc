// scripts/registerAllParties.js
//
// Convenience runner: associates the lab, hospital, and transport accounts
// with the BLOOD token in one go. Run this once, after 01-createToken.js,
// before demo.js.
//
//   node scripts/registerAllParties.js

import dotenv from "dotenv";
dotenv.config();

import { loadPartyCredentials } from "../src/hederaConfig.js";
import { registerParty } from "../src/registerParty.js";

const tokenId = process.env.TOKEN_ID;
if (!tokenId) {
  console.error("TOKEN_ID missing from .env - run scripts/01-createToken.js first.");
  process.exit(1);
}

async function main() {
  for (const prefix of ["LAB", "HOSPITAL", "TRANSPORT"]) {
    const { accountId, privateKey } = loadPartyCredentials(prefix);
    await registerParty(accountId, privateKey, tokenId);
  }
  console.log("All parties registered.");
}

main().catch((err) => {
  console.error("Registration failed:", err.message);
  process.exit(1);
});
