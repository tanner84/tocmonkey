const PACKS = {
  EUCOM: [require('../../enhancements/knowledge/EUCOM-expansion.json')],
  CENTCOM: [require('../../enhancements/knowledge/CENTCOM-expansion.json')],
  INDOPACOM: [
    require('../../enhancements/knowledge/INDOPACOM-expansion-a.json'),
    require('../../enhancements/knowledge/INDOPACOM-expansion-b.json')
  ],
  AFRICOM: [require('../../enhancements/knowledge/AFRICOM-expansion.json')],
  SOUTHCOM: [require('../../enhancements/knowledge/SOUTHCOM-expansion.json')],
  NORTHCOM: [require('../../enhancements/knowledge/NORTHCOM-expansion.json')]
};

const COMMAND_SOURCES = {
  EUCOM: { label:'U.S. European Command', url:'https://www.eucom.mil/' },
  CENTCOM: { label:'U.S. Central Command', url:'https://www.centcom.mil/' },
  INDOPACOM: { label:'U.S. Pacific Command', url:'https://www.pacom.mil/' },
  AFRICOM: { label:'U.S. Africa Command', url:'https://www.africom.mil/' },
  SOUTHCOM: { label:'U.S. Southern Command', url:'https://www.southcom.mil/' },
  NORTHCOM: { label:'U.S. Northern Command', url:'https://www.northcom.mil/' }
};

function slug(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countryActor(commandId, country) {
  const source = COMMAND_SOURCES[commandId];
  return {
    id:`country-${slug(country)}`,
    name:country,
    type:'country',
    country,
    summary:`Country / territory reference node for ${country} inside the ${commandId === 'INDOPACOM' ? 'PACOM' : commandId} Task Org knowledge graph. Use the related defense-and-security node and search filters to move into armed forces, security institutions and non-state actors associated with this area.`,
    capabilities:['national security context','defense institutions','regional partnerships'],
    systems:[],
    relationships:[{ target:`defense-security-${slug(country)}`, kind:'defense & security index' }],
    keywords:[country],
    sources:[
      { label:'CIA World Factbook', url:'https://www.cia.gov/the-world-factbook/countries/' },
      source
    ].filter(Boolean),
    priority:3,
    signalEligible:false
  };
}

function defenseActor(commandId, country) {
  const source = COMMAND_SOURCES[commandId];
  return {
    id:`defense-security-${slug(country)}`,
    name:`Defense & Security Institutions — ${country}`,
    type:'defense-security',
    country,
    summary:`Umbrella defense-and-security reference for ${country}. This node keeps every country represented even where a deeper service-level order of battle has not yet been built, and links into more detailed military, maritime, security and non-state profiles as the knowledge base expands.`,
    capabilities:['armed forces reference','security institutions','defense policy','partner-force context'],
    systems:[],
    relationships:[{ target:`country-${slug(country)}`, kind:'national reference' }],
    keywords:[`${country} armed forces`, `${country} military`, `${country} defense`, `${country} security`],
    sources:[
      { label:'CIA World Factbook', url:'https://www.cia.gov/the-world-factbook/countries/' },
      { label:'U.S. State Department — Countries & Areas', url:'https://www.state.gov/countries-areas/' },
      source
    ].filter(Boolean),
    priority:3,
    signalEligible:false
  };
}

function systemFromRow(row) {
  if (!Array.isArray(row)) return row || null;
  const [name, category, url] = row;
  if (!name) return null;
  return { name, category:category || '', ...(url ? { url } : {}) };
}

function sourceFromRow(row) {
  if (!Array.isArray(row)) return row || null;
  const [label, url] = row;
  if (!label || !url) return null;
  return { label, url };
}

function profileFromRow(row, exactCountries) {
  if (!Array.isArray(row)) return row || null;
  const [id, name, type, country, summary, capabilities = [], systemRows = [], sourceRows = [], priority = 2] = row;
  if (!id || !name || !type) return null;
  return {
    id,
    name,
    type,
    country:country || '',
    summary:summary || '',
    capabilities:Array.isArray(capabilities) ? capabilities : [],
    systems:(Array.isArray(systemRows) ? systemRows : []).map(systemFromRow).filter(Boolean),
    relationships:exactCountries.has(country)
      ? [{ target:`country-${slug(country)}`, kind:'operates in / national reference' }]
      : [],
    keywords:unique([name, ...(type === 'organized-crime' ? [country] : [])]),
    sources:(Array.isArray(sourceRows) ? sourceRows : []).map(sourceFromRow).filter(Boolean),
    priority:Number.isFinite(priority) ? priority : 2,
    signalEligible:true
  };
}

function getExpansion(commandId) {
  const packs = PACKS[commandId] || [];
  if (!packs.length) return null;

  const countries = unique(packs.flatMap(pack => Array.isArray(pack.countries) ? pack.countries : []));
  const exactCountries = new Set(countries);
  const generated = countries.flatMap(country => [countryActor(commandId, country), defenseActor(commandId, country)]);
  const detailed = packs.flatMap(pack => {
    const rich = Array.isArray(pack.actors) ? pack.actors : [];
    const compact = (Array.isArray(pack.profiles) ? pack.profiles : [])
      .map(row => profileFromRow(row, exactCountries))
      .filter(Boolean);
    return [...rich, ...compact];
  });

  const actors = [];
  const seenIds = new Set();
  const seenNames = new Set();
  for (const actor of [...generated, ...detailed]) {
    if (!actor?.id || !actor?.name) continue;
    const nameKey = actor.name.trim().toLowerCase();
    if (seenIds.has(actor.id) || seenNames.has(nameKey)) continue;
    seenIds.add(actor.id);
    seenNames.add(nameKey);
    actors.push(actor);
  }

  const lastReviewed = packs
    .map(pack => pack.lastReviewed || '')
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    id:commandId,
    lastReviewed,
    countries,
    actors,
    references:[]
  };
}

module.exports = { getExpansion, slug };
