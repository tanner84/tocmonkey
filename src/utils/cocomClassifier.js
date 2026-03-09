// ─────────────────────────────────────────────────────────────────────────────
// COCOM Classification Engine
// Classifies content by Combatant Command theater
// ─────────────────────────────────────────────────────────────────────────────

const COCOM_DEFINITIONS = {
  NORTHCOM: {
    name: 'U.S. Northern Command',
    regions: ['united states', 'usa', 'u.s.', 'america', 'canada', 'mexico', 'north america', 'alaska', 'greenland', 'arctic'],
    countries: ['united states', 'canada', 'mexico', 'bahamas'],
    keywords: ['border', 'cartel', 'ice', 'cbp', 'dhs', 'fbi', 'homeland security', 'border patrol', 'customs', 'dea', 'domestic terrorism', 'protest', 'norad', 'coast guard', 'fentanyl', 'migration crisis', 'drug trafficking', 'human smuggling', 'national guard'],
    cities: ['washington', 'new york', 'los angeles', 'chicago', 'houston', 'tijuana'],
    waterways: ['gulf of mexico', 'atlantic coast', 'pacific coast', 'hudson bay', 'bering strait'],
    airspace: ['us airspace', 'canada airspace', 'mexico airspace', 'norad', 'alaska airspace'],
    weight: 1.0
  },
  SOUTHCOM: {
    name: 'U.S. Southern Command',
    regions: ['central america', 'south america', 'latin america', 'caribbean'],
    countries: ['colombia', 'venezuela', 'brazil', 'argentina', 'chile', 'peru', 'ecuador', 'bolivia', 'paraguay', 'uruguay', 'guyana', 'suriname', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'costa rica', 'panama', 'belize', 'cuba', 'haiti', 'dominican republic', 'jamaica'],
    keywords: ['cartel', 'narco', 'cocaine', 'farc', 'eln', 'gang', 'ms-13', 'migration', 'maduro', 'ortega', 'bukele', 'petro', 'lula', 'drug trade', 'organized crime', 'coup', 'sinaloa', 'jalisco', 'cjng', 'narcotics', 'trafficking'],
    cities: ['bogota', 'caracas', 'brasilia', 'buenos aires', 'lima', 'santiago'],
    waterways: ['caribbean sea', 'panama canal', 'drake passage', 'magellan strait'],
    airspace: ['caribbean airspace', 'central america airspace', 'colombia airspace'],
    weight: 1.0
  },
  EUCOM: {
    name: 'U.S. European Command',
    regions: ['europe', 'european union', 'nato', 'balkans', 'scandinavia', 'eastern europe', 'western europe', 'caucasus', 'black sea', 'baltic'],
    countries: ['ukraine', 'russia', 'poland', 'germany', 'france', 'united kingdom', 'uk', 'britain', 'italy', 'spain', 'romania', 'bulgaria', 'greece', 'turkey', 'finland', 'sweden', 'norway', 'denmark', 'estonia', 'latvia', 'lithuania', 'belarus', 'moldova', 'georgia', 'armenia', 'azerbaijan', 'serbia', 'croatia', 'bosnia', 'kosovo', 'albania', 'netherlands', 'belgium', 'portugal', 'austria', 'hungary', 'czechia', 'slovakia', 'slovenia'],
    keywords: ['nato', 'putin', 'kremlin', 'zelensky', 'russia', 'ukraine war', 'donbas', 'crimea', 'bakhmut', 'kherson', 'zaporizhzhia', 'wagner', 'prigozhin', 'lukashenko', 'european union', 'brexit', 'article 5', 'stoltenberg', 'baltic states', 'kaliningrad', 'suwalki gap', 'leopard', 'challenger', 'himars', 'patriot', 'f-16'],
    cities: ['kyiv', 'kiev', 'moscow', 'warsaw', 'berlin', 'london', 'paris', 'rome', 'madrid'],
    waterways: ['baltic sea', 'north sea', 'mediterranean', 'black sea', 'barents sea', 'norwegian sea', 'english channel', 'bosphorus', 'dardanelles'],
    airspace: ['european airspace', 'nato airspace', 'baltic airspace', 'poland airspace', 'ukraine airspace'],
    weight: 1.0
  },
  CENTCOM: {
    name: 'U.S. Central Command',
    regions: ['middle east', 'central asia', 'persian gulf', 'arabian peninsula', 'levant', 'mesopotamia', 'gulf states'],
    countries: ['afghanistan', 'iran', 'iraq', 'syria', 'yemen', 'saudi arabia', 'uae', 'qatar', 'kuwait', 'bahrain', 'oman', 'jordan', 'lebanon', 'israel', 'egypt', 'pakistan', 'kazakhstan', 'uzbekistan', 'turkmenistan', 'tajikistan', 'kyrgyzstan'],
    keywords: ['taliban', 'isis', 'isil', 'islamic state', 'al-qaeda', 'houthi', 'hezbollah', 'irgc', 'quds force', 'soleimani', 'khamenei', 'saudi aramco', 'strait of hormuz', 'red sea', 'bab el-mandeb', 'shia', 'sunni', 'kurds', 'peshmerga', 'pkk', 'ypg', 'sdf', 'assad', 'erdogan', 'netanyahu', 'hamas', 'gaza', 'west bank', 'abraham accords', 'yemen war', 'saudi', 'iranian'],
    cities: ['kabul', 'tehran', 'baghdad', 'damascus', 'sanaa', 'riyadh', 'dubai', 'tel aviv', 'jerusalem'],
    waterways: ['persian gulf', 'strait of hormuz', 'red sea', 'gulf of oman', 'bab el-mandeb', 'suez canal', 'arabian sea', 'gulf of aden'],
    airspace: ['middle east airspace', 'iraq airspace', 'syria airspace', 'afghanistan airspace', 'persian gulf airspace'],
    weight: 1.0
  },
  INDOPACOM: {
    name: 'U.S. Indo-Pacific Command',
    regions: ['asia pacific', 'indo-pacific', 'south china sea', 'east china sea', 'pacific ocean', 'indian ocean', 'southeast asia', 'east asia'],
    countries: ['china', 'taiwan', 'north korea', 'south korea', 'japan', 'philippines', 'vietnam', 'thailand', 'myanmar', 'burma', 'cambodia', 'laos', 'malaysia', 'singapore', 'indonesia', 'brunei', 'australia', 'new zealand', 'papua new guinea', 'india', 'bangladesh', 'sri lanka', 'mongolia', 'fiji', 'solomon islands', 'guam', 'samoa'],
    keywords: ['pla', 'peoples liberation army', 'xi jinping', 'kim jong', 'ccp', 'taiwan strait', 'south china sea', 'scarborough shoal', 'spratly', 'paracel', 'senkaku', 'diaoyu', 'quad', 'aukus', 'brics', 'belt and road', 'one china', 'semiconductor', 'tsmc', 'chip war', 'marcos', 'yoon', 'kishida', 'modi', 'second thomas shoal', 'nine-dash line', 'strategic competition', 'indo-pacific strategy'],
    cities: ['beijing', 'taipei', 'pyongyang', 'seoul', 'tokyo', 'manila', 'hanoi', 'bangkok', 'singapore'],
    waterways: ['south china sea', 'east china sea', 'taiwan strait', 'luzon strait', 'malacca strait', 'philippine sea', 'sea of japan', 'yellow sea', 'indian ocean'],
    airspace: ['south china sea airspace', 'taiwan adiz', 'japan adiz', 'korean adiz', 'guam airspace'],
    weight: 1.0
  },
  AFRICOM: {
    name: 'U.S. Africa Command',
    regions: ['africa', 'sub-saharan africa', 'sahel', 'horn of africa', 'west africa', 'east africa', 'central africa', 'southern africa', 'maghreb', 'north africa'],
    countries: ['nigeria', 'somalia', 'ethiopia', 'kenya', 'sudan', 'south sudan', 'mali', 'niger', 'burkina faso', 'chad', 'mauritania', 'senegal', 'drc', 'congo', 'uganda', 'tanzania', 'mozambique', 'zimbabwe', 'south africa', 'angola', 'ghana', 'ivory coast', 'cameroon', 'libya', 'tunisia', 'algeria', 'morocco', 'egypt', 'eritrea'],
    keywords: ['boko haram', 'al-shabaab', 'aqim', 'wagner', 'jnim', 'isis-sahel', 'coup', 'junta', 'french withdrawal', 'ecowas', 'african union', 'amisom', 'peacekeeping', 'ebola', 'famine', 'drought', 'piracy', 'gulf of guinea', 'lake chad', 'tigray', 'darfur', 'russia africa', 'chinese influence'],
    cities: ['lagos', 'mogadishu', 'addis ababa', 'nairobi', 'khartoum', 'bamako', 'niamey', 'cair
// ...truncated for brevity...

function classifyByCOCOM(text) {
  // Simple keyword/region/country matching for demo
  const found = [];
  const lower = text.toLowerCase();
  for (const [code, def] of Object.entries(COCOM_DEFINITIONS)) {
    if (
      def.regions.some(r => lower.includes(r)) ||
      def.countries.some(c => lower.includes(c)) ||
      def.keywords.some(k => lower.includes(k)) ||
      def.cities?.some(city => lower.includes(city)) ||
      def.waterways?.some(w => lower.includes(w)) ||
      def.airspace?.some(a => lower.includes(a))
    ) {
      found.push(code);
    }
  }
  return found;
}

module.exports = { classifyByCOCOM };
