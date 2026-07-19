// src/mirrorNode.js
//
// The Hedera SDK can submit transactions and fetch the receipt of the
// transaction you just ran, but it cannot page back through history - "give
// me every message ever posted to this topic" is not a thing the consensus
// nodes answer. That is what mirror nodes are for: they replay the ledger
// and expose it over a plain REST API. This file is the only place in the
// project that talks to that API.
//
// This is what you'd reach for to *rebuild* localIndex.js from scratch, or
// to prove to an outside auditor that the local index matches the chain.

const BASE_URL = "https://testnet.mirrornode.hedera.com/api/v1";

/** All HCS messages ever submitted to a topic, oldest first. */
export async function getTopicMessages(topicId) {
  const messages = [];
  let url = `${BASE_URL}/topics/${topicId}/messages?limit=100`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror node request failed: ${res.status} ${res.statusText}`);
    const body = await res.json();

    for (const m of body.messages) {
      messages.push({
        consensusTimestamp: m.consensus_timestamp,
        sequenceNumber: m.sequence_number,
        // HCS message contents are base64 on the wire
        content: Buffer.from(m.message, "base64").toString("utf-8"),
      });
    }

    url = body.links?.next ? `https://testnet.mirrornode.hedera.com${body.links.next}` : null;
  }

  return messages;
}

/**
 * The EVM address a Hedera account appears as inside a smart contract
 * (msg.sender). For ECDSA-keyed accounts this is the key's alias address,
 * for ED25519 accounts it's the "long-zero" form of the account number,
 * so deriving it locally is unreliable. Asking the mirror node gives the
 * correct answer for both. Needed by the oversight layer whenever an
 * account must be passed INTO a contract call (investigation subjects,
 * election candidates).
 */
export async function getEvmAddress(accountId) {
  const res = await fetch(`${BASE_URL}/accounts/${accountId.toString()}`);
  if (!res.ok) throw new Error(`Mirror node request failed: ${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.evm_address; // "0x..." string
}

/** Current on-chain info (owner, metadata) for one NFT serial. */
export async function getNftInfo(tokenId, serial) {
  const res = await fetch(`${BASE_URL}/tokens/${tokenId}/nfts/${serial}`);
  if (!res.ok) throw new Error(`Mirror node request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Every NFT serial currently minted under this token (i.e. all blood units ever created). */
export async function getAllNfts(tokenId) {
  const nfts = [];
  let url = `${BASE_URL}/tokens/${tokenId}/nfts?limit=100`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror node request failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    nfts.push(...body.nfts);
    url = body.links?.next ? `https://testnet.mirrornode.hedera.com${body.links.next}` : null;
  }

  return nfts;
}
