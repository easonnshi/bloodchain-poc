// src/closeUnit.js
//
// Final step in a unit's life: transfused into a patient, or disposed of
// safely. Either way the token is burned via TokenWipeTransaction, using
// the wipe key set at token creation. This keeps the set of "active" NFTs
// matching blood that is actually still in circulation - a query for
// "does this token still exist" doubles as "is this unit still out there."

import { TokenWipeTransaction } from "@hashgraph/sdk";
import { client, operatorKey } from "./hederaConfig.js";
import { upsertUnit } from "./localIndex.js";
import { logEvent } from "./logEvent.js";

/**
 * @param {object} params
 * @param {string} params.tokenId
 * @param {string} params.topicId
 * @param {string} params.serial
 * @param {AccountId} params.holderAccountId - whoever currently holds the unit (e.g. the hospital)
 * @param {"transfused"|"disposed"} [params.reason]
 */
export async function closeUnit({ tokenId, topicId, serial, holderAccountId, reason = "transfused" }) {
  const tx = await new TokenWipeTransaction()
    .setTokenId(tokenId)
    .setAccountId(holderAccountId)
    .setSerials([Number(serial)])
    .freezeWith(client)
    .sign(operatorKey); // wipe key holder signs, not the current holder - that's the point of a wipe key

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  upsertUnit(serial, { status: "closed", closeReason: reason, closedAt: new Date().toISOString() });

  await logEvent(topicId, {
    unitId: serial,
    eventType: reason === "transfused" ? "TRANSFUSED" : "DISPOSED",
    reason,
  });

  console.log(`Unit #${serial} closed (${reason}) - NFT burned (${receipt.status.toString()})`);
}
