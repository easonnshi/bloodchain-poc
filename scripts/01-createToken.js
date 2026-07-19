// scripts/01-createToken.js
//
// Run once, at project setup. Defines the "blood unit" NFT class on Hedera.
// This is where the rule "who is allowed to mint/burn a blood-unit token"
// gets encoded on-chain instead of living as an internal policy document.
//
//   node scripts/01-createToken.js
//
// It prints a TOKEN_ID - paste that into your .env file. All later scripts
// read TOKEN_ID from .env, so this only needs to run once per environment.

import { TokenCreateTransaction, TokenType, TokenSupplyType } from "@hashgraph/sdk";
import { client, operatorId, operatorKey } from "../src/hederaConfig.js";

async function main() {
  const tx = await new TokenCreateTransaction()
    .setTokenName("BloodChain Unit")
    .setTokenSymbol("BLOOD")
    .setTokenType(TokenType.NonFungibleUnique) // each unit is medically distinct - not interchangeable
    .setSupplyType(TokenSupplyType.Infinite) // no cap on how many units can ever be minted
    .setTreasuryAccountId(operatorId) // the blood bank account; new NFTs are minted "to" this account
    .setSupplyKey(operatorKey) // controls who can call TokenMintTransaction / TokenBurnTransaction
    .setWipeKey(operatorKey) // controls who can forcibly pull a compromised unit out of circulation (closeUnit)
    .freezeWith(client)
    .sign(operatorKey);

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  console.log("Token created.");
  console.log("TOKEN_ID=" + receipt.tokenId.toString());
  console.log("\nAdd that line to your .env file before running any other script.");
}

main().catch((err) => {
  console.error("Token creation failed:", err.message);
  process.exit(1);
});
