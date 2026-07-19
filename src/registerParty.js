// src/registerParty.js
//
// Hedera requires an account to explicitly "associate" with a token before
// it can hold that token. This is a spam/rent protection built into the
// network, not something specific to this project - but it means every
// lab, hospital, and transport account MUST run this once before
// transferCustody() will work. If you skip this, the transfer transaction
// fails with TOKEN_NOT_ASSOCIATED_TO_ACCOUNT, not a helpful error.

import { TokenAssociateTransaction } from "@hashgraph/sdk";
import { client } from "./hederaConfig.js";

/**
 * @param {AccountId} accountId - the party's account (lab, hospital, transport)
 * @param {PrivateKey} privateKey - that party's own key (must sign - the
 *   treasury/operator key cannot associate on someone else's behalf)
 * @param {string} tokenId - the BLOOD token ID from .env
 */
export async function registerParty(accountId, privateKey, tokenId) {
  const tx = await new TokenAssociateTransaction()
    .setAccountId(accountId)
    .setTokenIds([tokenId])
    .freezeWith(client)
    .sign(privateKey);

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  console.log(`Registered ${accountId.toString()} for token ${tokenId} (status: ${receipt.status.toString()})`);
  return receipt;
}
