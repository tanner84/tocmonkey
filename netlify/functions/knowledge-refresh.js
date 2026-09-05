const { getStore } = require('@netlify/blobs');

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

const MAX_SIGNALS_PER_ACTOR = 5;
const SIGNAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const MAX_REVIEW_QUEUE = 250;
const CHANGE_HINTS = [
  'appointed','named commander','new commander','replaced','relieved','renamed','redesignated','reorganized','restructured',
  'deployed','deployment','fielded','delivered','received','acquired','equipped','introduced','first operational',
  'sanctioned','designated','merged','split','formed','established','disbanded','ceased operations','ceasefire','joined'
];
const HIGH_CONFIDENCE_HOSTS = [
  '.mil','.gov','defense.gov','state.gov','treasury.gov','cia.gov','un.org','nato.int','europa.eu','interpol.int'
];
const MEDIUM_CONFIDENCE_HOSTS = [
  'unodc.org','europol.europa.eu','csis.org','rusi.org','understandingwar.org','crisisgroup.org','bellingcat.com','occrp.org','africacenter.org'
];

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesKeyword(text, keyword) {
  const k = normalize(keyword);
  if (!k) return false;
  if (/^[a-z0-9]{2,5}$/.test(k)) return text.split(' ').includes(k);
  return text.includes(k);
}

function itemDate(item) {
  const raw = item.pubDate || item.isoDate || item.date || item.published || '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function itemCommandMatches(item, commandId) {
  const c = String(item.cocom || item.aor || 'ALL').toUpperCase();
  return !c || c === 'ALL' || c === commandId || (commandId === 'INDOPACOM' && c === 'PACOM');
}

function compactSignal(item) {
  const title = String(item.title || item.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const summary = String(item.desc || item.description || item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  const url = String(item.link || item.url || '').trim();
  const source = String(item.source || item.sourceName || item.name || item.handle || item.sourceHandle || '').trim().slice(0, 80);
  return {
    title,
    summary,
    url,
    source,
    pubDate: item.pubDate || item.isoDate || item.date || item.published || '',
    cocom: item.cocom || item.aor || 'ALL'
  };
}

function hostname(url = '') {
  try { return new URL(url).hostname.toLowerCase(); }
  catch (_) { return ''; }
}

function proposalConfidence(signal) {
  const host = hostname(signal.url);
  if (!host) return null;
  if (HIGH_CONFIDENCE_HOSTS.some(domain => host.endsWith(domain) || host === domain.replace(/^\./,''))) return 'HIGH';
  if (MEDIUM_CONFIDENCE_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`))) return 'MEDIUM';
  return null;
}

function hasChangeHint(signal) {
  const text = normalize(`${signal.title} ${signal.summary}`);
  return CHANGE_HINTS.some(hint => text.includes(normalize(hint)));
}

function proposalId(commandId, actorId, signal) {
  const source = `${commandId}|${actorId}|${signal.url}|${signal.title}`;
  let hash = 2166136261;
  for (let i=0; i<source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `kr-${(hash >>> 0).toString(16)}`;
}

function proposalFromSignal(commandId, actor, signal, approved) {
  const confidence = proposalConfidence(signal);
  if (!confidence || !hasChangeHint(signal)) return null;
  const actorKey = `${commandId}:${actor.id}`;
  const current = approved?.[actorKey]?.value || 'No approved analyst update note.';
  const newValue = `${signal.title}${signal.summary ? ` — ${signal.summary}` : ''}`.slice(0, 560);
  return {
    id: proposalId(commandId, actor.id, signal),
    commandId,
    commandDisplayName: commandId === 'INDOPACOM' ? 'PACOM' : commandId,
    actorId: actor.id,
    actorName: actor.name,
    actorType: actor.type,
    field: 'analystUpdateNote',
    currentValue: current,
    newValue,
    confidence,
    source: signal.source || hostname(signal.url) || 'Open source',
    url: signal.url,
    sourcePublishedAt: signal.pubDate || null,
    detectedAt: new Date().toISOString(),
    status: 'pending',
    reason: 'Approved-source reporting matched this actor and contained a potential organization, equipment, deployment, designation, or status-change indicator.'
  };
}

function actorsForCommand(commandId, command) {
  const actors = [...(command.actors || [])];
  const seen = new Set(actors.map(actor => actor.id));
  for (const actor of SUPPLEMENTS[commandId]?.actors || []) {
    if (!seen.has(actor.id)) {
      actors.push(actor);
      seen.add(actor.id);
    }
  }
  return actors;
}

async function fetchRss() {
  const base = (process.env.DEPLOY_PRIME_URL || process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${base}/.netlify/functions/rss`, {
      headers: { 'User-Agent': 'TOCMonkey-KnowledgeRefresh/1.0' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`RSS endpoint returned ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function readJSON(store, key, fallback) {
  try {
    const value = await store.get(key, { type: 'json' });
    return value ?? fallback;
  } catch (_) {
    return fallback;
  }
}

exports.handler = async function() {
  const runtimeStore = getStore('cocom-knowledge-runtime');
  const reviewStore = getStore('cocom-knowledge-review');
  const overrideStore = getStore('cocom-knowledge-overrides');

  const existing = await readJSON(runtimeStore, 'latest', null);
  const age = existing?.generatedAt ? Date.now() - Date.parse(existing.generatedAt) : Infinity;
  if (age < MIN_REFRESH_INTERVAL_MS) {
    return { statusCode: 200, body: JSON.stringify({ ok:true, skipped:true, generatedAt:existing.generatedAt }) };
  }

  const items = await fetchRss();
  const now = Date.now();
  const recent = items.filter(item => {
    const ts = itemDate(item);
    return !ts || (ts <= now + 5 * 60 * 1000 && now - ts <= SIGNAL_MAX_AGE_MS);
  });

  const actors = {};
  let matchedSignals = 0;
  const approved = await readJSON(overrideStore, 'approved', {});
  const queue = await readJSON(reviewStore, 'queue', []);
  const safeQueue = Array.isArray(queue) ? queue : [];
  const knownProposalIds = new Set(safeQueue.map(p => p.id));
  const newProposals = [];

  for (const [commandId, command] of Object.entries(COMMANDS)) {
    const commandItems = recent.filter(item => itemCommandMatches(item, commandId));
    for (const actor of actorsForCommand(commandId, command)) {
      const keywords = [actor.name, ...(actor.keywords || [])].filter(Boolean);
      const matches = commandItems
        .map(item => ({ item, text: normalize(`${item.title || item.text || ''} ${item.desc || item.description || item.summary || ''}`) }))
        .filter(({ text }) => keywords.some(keyword => matchesKeyword(text, keyword)))
        .sort((a,b) => itemDate(b.item) - itemDate(a.item))
        .slice(0, MAX_SIGNALS_PER_ACTOR)
        .map(({ item }) => compactSignal(item))
        .filter(signal => signal.title && signal.url);

      if (!matches.length) continue;
      const actorKey = `${commandId}:${actor.id}`;
      actors[actorKey] = matches;
      matchedSignals += matches.length;

      for (const signal of matches) {
        const proposal = proposalFromSignal(commandId, actor, signal, approved);
        if (proposal && !knownProposalIds.has(proposal.id)) {
          newProposals.push(proposal);
          knownProposalIds.add(proposal.id);
        }
      }
    }
  }

  const runtime = {
    generatedAt: new Date().toISOString(),
    source: 'TOC Monkey RSS aggregator',
    sourceItemCount: items.length,
    recentItemCount: recent.length,
    matchedSignals,
    actors
  };
  await runtimeStore.setJSON('latest', runtime);

  if (newProposals.length) {
    const merged = [...newProposals, ...safeQueue]
      .sort((a,b) => Date.parse(b.detectedAt || 0) - Date.parse(a.detectedAt || 0))
      .slice(0, MAX_REVIEW_QUEUE);
    await reviewStore.setJSON('queue', merged);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
    body: JSON.stringify({
      ok:true,
      generatedAt:runtime.generatedAt,
      sourceItemCount:runtime.sourceItemCount,
      recentItemCount:runtime.recentItemCount,
      matchedSignals:runtime.matchedSignals,
      actorCount:Object.keys(runtime.actors).length,
      proposalsAdded:newProposals.length
    })
  };
};
