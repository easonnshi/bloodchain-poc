// scripts/02-createTopic.js
//
// Run once. Creates the HCS topic that every custody event (test result,
// storage check, transport, transfusion, flag) gets written to. One topic
// is enough for the whole POC - individual messages carry the unit's
// serial number so you can filter later.
//
//   node scripts/02-createTopic.js
//
// Prints TOPIC_ID - add it to .env.

import { TopicCreateTransaction } from "@hashgraph/sdk";
import { client, operatorKey } from "../src/hederaConfig.js";

async function main() {
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("BloodChain custody event log")
    .setSubmitKey(operatorKey) // only holders of this key can submit messages - stops randoms from writing fake events
    .freezeWith(client)
    .sign(operatorKey);

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);

  console.log("Topic created.");
  console.log("TOPIC_ID=" + receipt.topicId.toString());
  console.log("\nAdd that line to your .env file.");
}

main().catch((err) => {
  console.error("Topic creation failed:", err.message);
  process.exit(1);
});
