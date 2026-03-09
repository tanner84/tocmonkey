// ─────────────────────────────────────────────────────────────────────────────
// Topic Tagger - Extracts topic tags from content
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_PATTERNS = {
  cartel: ['cartel', 'narco', 'drug trafficking', 'sinaloa', 'jalisco', 'cjng'],
  terrorism: ['terrorist', 'terrorism', 'isis', 'isil', 'al-qaeda', 'al qaeda', 'boko haram', 'al-shabaab'],
  militia: ['militia', 'paramilitary', 'armed group', 'irregular forces'],
  naval_activity: ['naval', 'ship', 'fleet', 'carrier', 'destroyer', 'submarine', 'maritime'],
  air_activity: ['aircraft', 'fighter', 'bomber', 'drone', 'uav', 'airspace', 'flight'],
  missile_strike: ['missile', 'strike', 'rocket', 'ballistic', 'cruise missile'],
  proxy_warfare: ['proxy', 'proxy war', 'proxy forces', 'wagner', 'pmc'],
  border_violence: ['border', 'border crossing', 'border security', 'illegal crossing'],
  pmc_activity: ['private military', 'pmc', 'wagner', 'mercenary', 'contractors'],
  cyber: ['cyber', 'cyberattack', 'hacking', 'ransomware', 'ddos'],
  space: ['space', 'satellite', 'orbital', 'space force'],
  nuclear: ['nuclear', 'atomic', 'icbm', 'warhead'],
  humanitarian: ['humanitarian', 'refugees', 'aid', 'relief', 'famine', 'disaster'],
  diplomatic: ['diplomatic', 'diplomacy', 'ambassador', 'embassy', 'treaty', 'summit'],
  exercises: ['exercise', 'drill', 'maneuver', 'training', 'war game'],
  deployment: ['deployment', 'deploy', 'forward deployed', 'rotational'],
  sanctions: ['sanction', 'embargo', 'export control', 'trade restriction'],
  trade: ['trade', 'export', 'import', 'tariff', 'commerce'],
  energy: ['oil', 'gas', 'energy', 'pipeline', 'lng', 'petroleum']
};

function extractTopicTags(content) {
  const normalized = content.toLowerCase();
  const tags = [];

  for (const [tag, patterns] of Object.entries(TOPIC_PATTERNS)) {
    const matched = patterns.some(pattern => normalized.includes(pattern));
    if (matched) {
      tags.push(tag);
    }
  }

  return tags;
}

module.exports = { extractTopicTags };
