// Direct browser -> Hedera mirror node reads. No wallet, no keys, no local
// server involved: anyone with this page and a serial number can pull the
// same history from the same public API and check it against HashScan.

import { MIRROR_BASE } from "./hashscan.js";

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mirror node ${res.status} ${res.statusText}`);
  return res.json();
}

function decodeMessage(m) {
  let payload = null;
  try {
    payload = JSON.parse(atob(m.message));
  } catch {
    payload = { raw: m.message };
  }
  return {
    sequenceNumber: m.sequence_number,
    consensusTimestamp: m.consensus_timestamp,
    payer: m.payer_account_id,
    ...payload,
  };
}

/** Newest-first page of topic messages (for the live feed). */
export async function recentTopicMessages(topicId, limit = 25) {
  const body = await get(`${MIRROR_BASE}/topics/${topicId}/messages?limit=${limit}&order=desc`);
  return (body.messages || []).map(decodeMessage);
}

/** Full topic history, oldest first (for custody trails). */
export async function allTopicMessages(topicId) {
  const out = [];
  let url = `${MIRROR_BASE}/topics/${topicId}/messages?limit=100&order=asc`;
  while (url) {
    const body = await get(url);
    out.push(...(body.messages || []).map(decodeMessage));
    url = body.links?.next ? `https://testnet.mirrornode.hedera.com${body.links.next}` : null;
  }
  return out;
}

/** Current owner + metadata for one NFT serial. */
export async function nftInfo(tokenId, serial) {
  const body = await get(`${MIRROR_BASE}/tokens/${tokenId}/nfts/${serial}`);
  let metadata = null;
  try {
    metadata = JSON.parse(atob(body.metadata));
  } catch {
    /* metadata is optional info */
  }
  return {
    accountId: body.account_id,
    deleted: body.deleted,
    createdTimestamp: body.created_timestamp,
    metadata,
  };
}
