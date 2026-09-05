const { getStore } = require('@netlify/blobs');

const MANIFEST = require('../../enhancements/cocom-knowledge.json');
const COMMANDS = {
  EUCOM: require('../../enhancements/knowledge/EUCOM.json'),
  CENTCOM: require('../../enhancements/knowledge/CENTCOM.json'),
  INDOPACOM: require('../../enhancements/knowledge/INDOPACOM.json'),
  AFRICOM: require('../../enhancements/knowledge/AFRICOM.json'),
  SOUTHCOM: require('../../enhancements/knowledge/SOUTHCOM.json'),
  NORTHCOM: require('../../enhancements/knowledge/NORTHCOM.json')
};

function json(statusCode, body, cache = 'public, max-age=300, stale-while-revalidate=600') {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

function normalizeCommand(value = '') {
  const id = String(value).toUpperCase().trim();
  if (id === 'PACOM') return 'INDOPACOM';
  return id;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' }, 'no-store');

  const requested = normalizeCommand(event.queryStringParameters?.command || '');
  if (!requested) {
    return json(200, {
      version: MANIFEST.version,
      updated: MANIFEST.updated,
      disclaimer: MANIFEST.disclaimer,
      methodology: MANIFEST.methodology,
      commands: MANIFEST.commands
    });
  }
  if (!COMMANDS[requested]) return json(400, { error: 'Invalid COCOM' }, 'no-store');

  let runtime = null;
  try {
    const store = getStore('cocom-knowledge-runtime');
    runtime = await store.get('latest', { type: 'json' });
  } catch (_) {}

  const command = JSON.parse(JSON.stringify(COMMANDS[requested]));
  const signalMap = runtime?.actors || {};
  command.actors = command.actors.map(actor => ({
    ...actor,
    recentSignals: Array.isArray(signalMap[`${requested}:${actor.id}`]) ? signalMap[`${requested}:${actor.id}`] : []
  }));

  return json(200, {
    version: MANIFEST.version,
    updated: MANIFEST.updated,
    runtimeUpdated: runtime?.generatedAt || null,
    runtimeItemCount: runtime?.sourceItemCount || 0,
    disclaimer: MANIFEST.disclaimer,
    methodology: MANIFEST.methodology,
    command
  });
};
