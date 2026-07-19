// src/hederaConfig.js
//
// Every other file imports `client` from here. Nothing else in the project
// is allowed to build its own Client or read process.env directly - this
// keeps credential handling in exactly one place.

import { Client, PrivateKey, AccountId, Hbar } from "@hashgraph/sdk";
import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

const operatorId = AccountId.fromString(requireEnv("OPERATOR_ID"));
const operatorKey = PrivateKey.fromStringDer(requireEnv("OPERATOR_KEY"));

const network = process.env.HEDERA_NETWORK || "testnet";

const client =
  network === "mainnet" ? Client.forMainnet() : Client.forTestnet();

client.setOperator(operatorId, operatorKey);

// Ceiling on what any single transaction is allowed to spend. Testnet HBAR
// is free from the faucet, so there's no real cost to keeping this generous -
// set too low (e.g. 2 Hbar) and things like TokenCreateTransaction or
// ContractCreateFlow can fail with INSUFFICIENT_TX_FEE depending on current
// network pricing, even though your account has plenty of balance.
client.setDefaultMaxTransactionFee(new Hbar(20));

export { client, operatorId, operatorKey };

// Convenience for scripts that need a party's own key (lab, hospital, transport)
export function loadPartyCredentials(prefix) {
  return {
    accountId: AccountId.fromString(requireEnv(`${prefix}_ACCOUNT_ID`)),
    privateKey: PrivateKey.fromStringDer(requireEnv(`${prefix}_ACCOUNT_KEY`)),
  };
}

// A full client that signs AS a specific party (lab, hospital, transport),
// paying its own fees. Needed for the oversight layer: when a hospital
// registers its bond or casts a DAO vote, the contract's msg.sender must
// be the hospital's own account, not the blood bank's operator account.
export function makePartyClient(prefix) {
  const { accountId, privateKey } = loadPartyCredentials(prefix);
  const partyClient =
    network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  partyClient.setOperator(accountId, privateKey);
  partyClient.setDefaultMaxTransactionFee(new Hbar(20));
  return { client: partyClient, accountId, privateKey };
}
