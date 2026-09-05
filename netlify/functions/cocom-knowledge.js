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
const SUPPLEMENTS = {
  CENTCOM: require('../../enhancements/knowledge/CENTCOM-supplement.json')
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

async function readJSON(storeName, key, fallback) {
  try {
    const store = getStore(storeName);
    const value = await store.get(key, { type:'json' });
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function mergeSupplement(command, supplement) {
  if (!supplement) return command;
  const knownActorIds = new Set((command.actors || []).map(actor => actor.id));
  const knownRefs = new Set((command.references || []).map(ref => `${ref.label}|${ref.url}`));

  for (const actor of supplement.actors || []) {
    if (!knownActorIds.has(actor.id)) {
      command.actors.push(actor);
      knownActorIds.add(actor.id);
    }
  }
  for (const ref of supplement.references || []) {
    const key = `${ref.label}|${ref.url}`;
    if (!knownRefs.has(key)) {
      command.references.push(ref);
      knownRefs.add(key);
    }
  }
  if (supplement.lastReviewed && (!command.lastReviewed || supplement.lastReviewed > command.lastReviewed)) {
    command.lastReviewed = supplement.lastReviewed;
  }
  return command;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return json(405, { error:'Method not allowed' }, 'no-store');

  const requested = normalizeCommand(event.queryStringParameters?.command || '');
  if (!requested) {
    return json(200, {
      version:MANIFEST.version,
      updated:MANIFEST.updated,
      disclaimer:MANIFEST.disclaimer,
      methodology:MANIFEST.methodology,
      commands:MANIFEST.commands
    });
  }
  if (!COMMANDS[requested]) return json(400, { error:'Invalid COCOM' }, 'no-store');

  const [runtime, approved] = await Promise.all([
    readJSON('cocom-knowledge-runtime', 'latest', null),
    readJSON('cocom-knowledge-overrides', 'approved', {})
  ]);

  const command = mergeSupplement(
    JSON.parse(JSON.stringify(COMMANDS[requested])),
    SUPPLEMENTS[requested] ? JSON.parse(JSON.stringify(SUPPLEMENTS[requested])) : null
  );
  const signalMap = runtime?.actors || {};
  command.actors = command.actors.map(actor => {
    const actorKey = `${requested}:${actor.id}`;
    const approvedUpdate = approved?.[actorKey] || null;
    const approvedText = approvedUpdate?.value
      ? ` APPROVED ANALYST UPDATE (${String(approvedUpdate.approvedAt || '').slice(0,10)}): ${approvedUpdate.value}`
      : '';
    return {
      ...actor,
      summary:`${actor.summary}${approvedText}`,
      approvedUpdate,
      recentSignals:Array.isArray(signalMap[actorKey]) ? signalMap[actorKey] : []
    };
  });

  return json(200, {
    version:MANIFEST.version,
    updated:command.lastReviewed || MANIFEST.updated,
    runtimeUpdated:runtime?.generatedAt || null,
    runtimeItemCount:runtime?.sourceItemCount || 0,
    disclaimer:MANIFEST.disclaimer,
    methodology:MANIFEST.methodology,
    command
  });
};
