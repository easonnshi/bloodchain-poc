// src/logEvent.js
//
// Every other "event" function (mintUnit, submitTestResult, transferCustody,
// closeUnit, flagBatch) calls this instead of talking to HCS directly. One
// choke point means the message shape stays consistent, and it's the single
// place you'd add things like retry logic later.
//
// The tamper-proof part is not the JSON payload - it's that HCS timestamps
// and orders every message through network consensus, then the mirror node
// makes that order queryable. Nobody, including the blood bank, can quietly
// edit or reorder a message after it lands.

import { TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { client } from "./hederaConfig.js";

/**
 * @param {string} topicId - the HCS topic ID from .env
 * @param {object} payload - must include unitId and eventType at minimum
 */
export async function logEvent(topicId, payload) {
  const message = JSON.stringify({
    ...payload,
    loggedAt: new Date().toISOString(),
  });

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .freezeWith(client);

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  console.log(
    `HCS event logged: ${payload.eventType} for unit ${payload.unitId} (seq #${receipt.topicSequenceNumber})`
  );
  return receipt.topicSequenceNumber.toString();
}
