// One article-level policy for RSS, SIGACTS, SITREP and the browser feed.
// Publisher location and account AOR tags are NOT evidence of story geography.
export const POLICY_VERSION = 'reporting-v1';
export const REGIONS = {
  EUCOM: 'europe|european|ukraine|ukrainian|kyiv|kiev|russia|russian|moscow|kremlin|belarus|moldova|poland|polish|germany|german|france|french|britain|british|united kingdom|italy|italian|spain|spanish|portugal|baltic|estonia|latvia|lithuania|finland|finnish|sweden|swedish|norway|norwegian|denmark|netherlands|belgium|romania|bulgaria|hungary|slovakia|slovenia|croatia|bosnia|serbia|kosovo|albania|montenegro|north macedonia|greece|greek|turkey|turkiye|georgia|armenia|azerbaijan|nato|black sea|crimea|kaliningrad|kursk|donetsk|kharkiv',
  CENTCOM: 'centcom|middle east|iran|iranian|tehran|iraq|iraqi|israel|israeli|gaza|palestine|palestinian|west bank|lebanon|lebanese|syria|syrian|jordan|jordanian|saudi|yemen|yemeni|oman|omani|qatar|qatari|bahrain|kuwait|uae|emirates|emirati|egypt|egyptian|afghanistan|afghan|pakistan|pakistani|kazakhstan|kyrgyzstan|tajikistan|turkmenistan|uzbekistan|red sea|hormuz|gulf of aden|bab el mandeb|hamas|hezbollah|houthi|houthis|irgc|quds force',
  INDOPACOM: 'pacom|indopacom|indo pacific|china|chinese|beijing|taiwan|taiwanese|taipei|japan|japanese|tokyo|north korea|south korea|korean|pyongyang|seoul|india|indian|australia|australian|new zealand|philippines|philippine|filipino|manila|indonesia|indonesian|vietnam|vietnamese|thailand|thai|malaysia|malaysian|singapore|cambodia|laos|myanmar|burma|bangladesh|sri lanka|nepal|mongolia|guam|south china sea|east china sea|spratly|paracel|scarborough shoal|second thomas shoal|aukus|fiji|papua new guinea|solomon islands|vanuatu|samoa|tonga|palau|micronesia|marshall islands|timor leste|bhutan|maldives',
  AFRICOM: 'africom|africa|african|algeria|morocco|tunisia|libya|sudan|south sudan|ethiopia|eritrea|djibouti|somalia|somali|kenya|uganda|rwanda|burundi|congo|drc|nigeria|nigerian|niger|mali|mauritania|senegal|gambia|guinea|sierra leone|liberia|ghana|togo|benin|burkina faso|chad|cameroon|central african republic|gabon|angola|namibia|botswana|zimbabwe|zambia|mozambique|malawi|tanzania|south africa|lesotho|eswatini|madagascar|sahel|darfur|tigray|al shabaab|jnim|boko haram|africa corps|gulf of guinea|cape verde|cabo verde|comoros|seychelles|mauritius',
  SOUTHCOM: 'southcom|south america|latin america|colombia|colombian|venezuela|venezuelan|brazil|brazilian|argentina|argentine|chile|chilean|peru|peruvian|ecuador|ecuadorian|bolivia|paraguay|uruguay|guyana|suriname|panama|cuba|haiti|haitian|dominican republic|jamaica|belize|guatemala|honduras|el salvador|nicaragua|costa rica|tren de aragua|farc|eln|clan del golfo|comando vermelho',
  NORTHCOM: 'northcom|norad|united states|u s|usa|american|canada|canadian|mexico|mexican|greenland|alaska|bahamas|sinaloa|cjng|jalisco new generation|gulf cartel|cartel del golfo|cartel del noreste|nueva familia michoacana|homeland security|border patrol|national guard|california|texas|florida|new york|washington dc'
};

export function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function normalizeCommand(value = '') {
  const id = String(value).trim().toUpperCase();
  return id === 'PACOM' ? 'INDOPACOM' : Object.hasOwn(REGIONS, id) ? id : null;
}
function matches(text, terms) {
  const hay = ` ${normalize(text)} `;
  return terms.split('|').some(term => hay.includes(` ${term} `));
}
function titleOf(item) { return String(item?.title || item?.text || '').trim(); }
function summaryOf(item) { return String(item?.desc || item?.description || item?.summary || '').trim(); }
export function relevant(item, command) {
  const id = normalizeCommand(command);
  if (!id) return false;
  const headline = titleOf(item);
  // Direct cross-region stories can legitimately appear in both commands.
  if (matches(headline, REGIONS[id])) return true;
  if (Object.values(REGIONS).some(terms => matches(headline, terms))) return false;
  return matches(summaryOf(item), REGIONS[id]);
}

const SECURITY = 'military|army|navy|naval|air force|air defense|air defence|missile|missiles|drone|drones|artillery|himars|war|warfare|invasion|combat|airstrike|airstrikes|troops|soldiers|brigade|battalion|fighter jets|submarine|submarines|warship|warships|nuclear|weapons|armed forces|defense|defence|pentagon|nato|terrorism|terrorist|insurgent|insurgency|militia|militias|cartel|cartels|trafficking|smuggling|hostage|hostages|ceasefire|peace talks|sanctions|coup|martial law|unrest|riot|riots|election|elections|electoral|consulate|diplomatic|diplomats|ambassador|espionage|spyware|cyberattack|cyberattacks|ransomware|intelligence|border|blockade|piracy|shipping|chokepoint|mobilization|mobilisation|deterrence|arms|munitions|ammunition|corruption|money laundering|organized crime|organised crime|fuel theft|uranium|refugees|displacement|humanitarian|famine|earthquake|tsunami|typhoon|hurricane|critical infrastructure|power grid';
const VIOLENCE = /\b(bomb(?:ing|ings|ed)?|explosion|airstrike|killed|killings|massacre|terroris[mt]|hostages?|missile attack|drone strike|armed attack|police raid)\b/i;
const DISTRACTIONS = /\b(basketball|football|rugby|cricket|tennis|baseball|soccer|grand prix|box office|cinema|film festival|movie|movies|celebrity|celebrities|wine grape|wine harvest|champagne production|recipe|horoscope|k pop|k-pop)\b/i;
export function significant(item) {
  const headline = titleOf(item);
  if (DISTRACTIONS.test(headline) && !VIOLENCE.test(headline)) return false;
  const securityText = `${headline} ${summaryOf(item)}`.replace(/artificial intelligence/gi, 'AI');
  return VIOLENCE.test(headline) || matches(securityText, SECURITY);
}
export function validArticle(item, { now = Date.now(), maxAgeHours = 96 } = {}) {
  const title = titleOf(item);
  if (title.length < 12 || /^(dw|bbc|news|home|latest news|deutsche welle|dw — deutsche welle)$/i.test(title)) return false;
  try { if (!['http:', 'https:'].includes(new URL(item?.url || item?.link).protocol)) return false; }
  catch { return false; }
  const stamp = Date.parse(item?.pubDate || item?.isoDate || item?.date || item?.published || '');
  return Number.isFinite(stamp) && stamp <= now + 15 * 60000 && now - stamp <= maxAgeHours * 3600000;
}
export function filterReporting(items, command, { purpose = 'feed', now = Date.now(), maxAgeHours = purpose === 'sigacts' ? 90 * 24 : 96 } = {}) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!validArticle(item, { now, maxAgeHours }) || !relevant(item, command)) return false;
    if (purpose !== 'feed' && !significant(item)) return false;
    const key = normalize(titleOf(item));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Date.parse(b.pubDate || b.isoDate || b.date || b.published) - Date.parse(a.pubDate || a.isoDate || a.date || a.published));
}
