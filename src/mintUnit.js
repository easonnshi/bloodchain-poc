// src/mintUnit.js
//
// Step 1 of the flow: a barcode scan at the collection center becomes an
// NFT. The serial number Hedera assigns is the unit's permanent ID for the
// rest of its life (test result, transfers, disposal all reference it).

import { TokenMintTransaction } from "@hashgraph/sdk";
import { client } from "./hederaConfig.js";
import { upsertUnit } from "./localIndex.js";
import { logEvent } from "./logEvent.js";

/**
 * @param {object} params
 * @param {string} params.tokenId - the BLOOD token ID
 * @param {string} params.topicId - the HCS topic ID
 * @param {string} params.donorBatchId - ties this unit to its donation event/session
 * @param {string} params.collectionCenterId - where it was collected
 * @returns {Promise<string>} the new NFT's serial number (the unit's ID)
 */
export async function mintUnit({ tokenId, topicId, donorBatchId, collectionCenterId }) {
  // HTS caps NFT metadata at 100 bytes, so it only carries the two IDs
  // needed to trace a unit back to its donation batch. Full detail
  // (timestamps, screening notes, etc.) belongs in HCS, not the metadata.
  const metadata = Buffer.from(JSON.stringify({ donorBatchId, collectionCenterId }));
  if (metadata.length > 100) {
    throw new Error(
      `NFT metadata too large (${metadata.length} bytes, max 100). Shorten donorBatchId/collectionCenterId.`
    );
  }

  const tx = await new TokenMintTransaction()
    .setTokenId(tokenId)
    .setMetadata([metadata])
    .freezeWith(client);
  // No explicit .sign() needed: the client's operator key IS the supply key
  // (see scripts/01-createToken.js), so execute() signs it automatically.

  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  const serial = receipt.serials[0].toString();

  upsertUnit(serial, {
    donorBatchId,
    collectionCenterId,
    status: "collected",
    holder: "blood_bank",
    mintedAt: new Date().toISOString(),
  });

  await logEvent(topicId, {
    unitId: serial,
    eventType: "COLLECTED",
    donorBatchId,
    collectionCenterId,
  });

  console.log(`Minted unit #${serial} (batch ${donorBatchId}, center ${collectionCenterId})`);
  return serial;
}
