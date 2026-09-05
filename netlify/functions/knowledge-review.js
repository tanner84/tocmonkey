const { getStore } = require('@netlify/blobs');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store'
    },
    body: JSON.stringify(body)
  };
}

function authorized(event) {
  return Boolean(ADMIN_PASSWORD) && event.headers['x-admin-password'] === ADMIN_PASSWORD;
}

async function readJSON(store, key, fallback) {
  try {
    const value = await store.get(key, { type: 'json' });
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function summarize(queue = []) {
  const counts = { pending:0, approved:0, rejected:0 };
  queue.forEach(item => {
    if (counts[item.status] !== undefined) counts[item.status]++;
  });
  return counts;
}

exports.handler = async function(event) {
  if (!authorized(event)) return json(401, { error:'Unauthorized' });
  if (!['GET','POST'].includes(event.httpMethod)) return json(405, { error:'Method not allowed' });

  let reviewStore;
  let overrideStore;
  try {
    reviewStore = getStore('cocom-knowledge-review');
    overrideStore = getStore('cocom-knowledge-overrides');
  } catch (error) {
    return json(503, { error:'Knowledge review storage unavailable' });
  }

  let queue = await readJSON(reviewStore, 'queue', []);
  if (!Array.isArray(queue)) queue = [];

  if (event.httpMethod === 'GET') {
    const status = event.queryStringParameters?.status || 'pending';
    const filtered = status === 'all' ? queue : queue.filter(item => item.status === status);
    filtered.sort((a,b) => Date.parse(b.detectedAt || 0) - Date.parse(a.detectedAt || 0));
    const runtime = await readJSON(getStore('cocom-knowledge-runtime'), 'latest', null);
    return json(200, {
      generatedAt: new Date().toISOString(),
      runtimeUpdated: runtime?.generatedAt || null,
      counts: summarize(queue),
      proposals: filtered.slice(0,100)
    });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error:'Invalid JSON' }); }

  const action = String(body.action || '').toLowerCase();
  const id = String(body.id || '');
  if (!['approve','reject','reopen'].includes(action) || !id) {
    return json(400, { error:'Expected action approve, reject, or reopen and proposal id' });
  }

  const proposal = queue.find(item => item.id === id);
  if (!proposal) return json(404, { error:'Proposal not found' });

  if (action === 'approve') {
    proposal.status = 'approved';
    proposal.reviewedAt = new Date().toISOString();
    const approved = await readJSON(overrideStore, 'approved', {});
    const actorKey = `${proposal.commandId}:${proposal.actorId}`;
    approved[actorKey] = {
      field: proposal.field,
      value: proposal.newValue,
      source: proposal.source,
      url: proposal.url,
      confidence: proposal.confidence,
      approvedAt: proposal.reviewedAt,
      proposalId: proposal.id
    };
    await overrideStore.setJSON('approved', approved);
  } else if (action === 'reject') {
    proposal.status = 'rejected';
    proposal.reviewedAt = new Date().toISOString();
  } else {
    proposal.status = 'pending';
    proposal.reviewedAt = null;
  }

  await reviewStore.setJSON('queue', queue);
  return json(200, { ok:true, proposal, counts:summarize(queue) });
};
