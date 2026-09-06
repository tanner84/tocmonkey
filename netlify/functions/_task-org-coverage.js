const STANDARD = [
  ['command-authority','Command authority',true],
  ['defense-ministry','Defense ministry / joint command',true],
  ['land-force','Land force',true],
  ['air-component','Air component',false],
  ['interior-police','Interior / police',true],
  ['intelligence','Intelligence / internal security',true],
  ['border-security','Border security',false],
  ['special-operations','Special operations',false],
  ['operational-formations','Operational formations',false],
  ['systems','Major systems / equipment',false],
  ['non-state-threats','Non-state armed threats',true],
  ['criminal-networks','Organized crime / trafficking',false],
  ['external-relations','External sponsors / partners / cross-border relationships',false],
  ['bases-locations','Bases / garrisons / operating locations',false]
].map(([id,label,critical]) => ({ id,label,critical }));

function isGeneratedIndex(actor = {}) {
  return String(actor.id || '').startsWith('country-') ||
    String(actor.id || '').startsWith('defense-security-') && actor.signalEligible === false;
}

function inferredTags(actor = {}) {
  if (isGeneratedIndex(actor)) return [];
  const tags = new Set(Array.isArray(actor.coverageTags) ? actor.coverageTags : []);
  const name = String(actor.name || '').toLowerCase();
  const type = String(actor.type || '').toLowerCase();
  const caps = (actor.capabilities || []).join(' ').toLowerCase();

  if (/ministry of (national )?defen[cs]e|armed forces|general staff/.test(name)) tags.add('defense-ministry');
  if (/army|ground force|corps|division|brigade|land force/.test(name)) tags.add('land-force');
  if (/air force|air arm|aviation/.test(name)) tags.add('air-component');
  if (/interior|police|gendarmerie|national guard/.test(name)) tags.add('interior-police');
  if (/intelligence|security service|counterintelligence/.test(name)) tags.add('intelligence');
  if (/border|frontier|coast guard/.test(name)) tags.add('border-security');
  if (/special force|special operations|commando|sof\b/.test(`${name} ${caps}`)) tags.add('special-operations');
  if (/corps|division|brigade|fleet|theater command|regional command/.test(name)) tags.add('operational-formations');
  if ((actor.systems || []).length) tags.add('systems');
  if (type === 'terrorist-insurgent' || type === 'militia') tags.add('non-state-threats');
  if (type === 'organized-crime') tags.add('criminal-networks');
  if (/base|airfield|garrison|port|military hub/.test(name)) tags.add('bases-locations');
  return [...tags];
}

function belongsToCountry(actor = {}, country = '') {
  if (!actor.country || !country) return false;
  const a = String(actor.country).toLowerCase();
  const c = String(country).toLowerCase();
  return a === c || a.split(/\s*[/;,]\s*/).includes(c);
}

function coverageStatus(metCount, criticalMissing) {
  if (metCount <= 2) return 'INDEX ONLY';
  if (metCount <= 5) return 'BASIC';
  if (metCount <= 10) return 'DEVELOPED';
  if (criticalMissing.length === 0) return 'COMPREHENSIVE';
  return 'DEVELOPED';
}

function evaluateCountry(country, actors = []) {
  const relevant = actors.filter(actor => belongsToCountry(actor, country) && !isGeneratedIndex(actor));
  const tags = new Set(relevant.flatMap(inferredTags));
  const met = STANDARD.filter(item => tags.has(item.id));
  const missing = STANDARD.filter(item => !tags.has(item.id));
  const criticalMissing = missing.filter(item => item.critical);
  return {
    country,
    status:coverageStatus(met.length, criticalMissing),
    score:met.length,
    total:STANDARD.length,
    actorCount:relevant.length,
    met:met.map(item => item.id),
    missing:missing.map(item => item.id),
    criticalMissing:criticalMissing.map(item => item.id)
  };
}

function buildCoverage(command = {}) {
  const actors = Array.isArray(command.actors) ? command.actors : [];
  const countries = [...new Set(actors
    .filter(actor => actor.type === 'country' && actor.country)
    .map(actor => actor.country))]
    .sort((a,b) => String(a).localeCompare(String(b)));
  const rows = countries.map(country => evaluateCountry(country, actors));
  const counts = { comprehensive:0, developed:0, basic:0, indexOnly:0 };
  rows.forEach(row => {
    if (row.status === 'COMPREHENSIVE') counts.comprehensive++;
    else if (row.status === 'DEVELOPED') counts.developed++;
    else if (row.status === 'BASIC') counts.basic++;
    else counts.indexOnly++;
  });
  return {
    standardVersion:'1.0',
    categories:STANDARD,
    summary:{ countries:rows.length, ...counts },
    countries:rows
  };
}

module.exports = { STANDARD, buildCoverage, evaluateCountry, inferredTags };
