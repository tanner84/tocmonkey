// NCAA Men's Basketball Scores — pulls verified final scores from ESPN API, posts logo + text to Facebook
// AM slot (14:40 UTC / 9:40am ET): shows overnight finals from yesterday
// PM slot (22:00 UTC / 6pm ET): shows today's afternoon finals
const { getStore } = require('@netlify/blobs');

function getYesterdayYMD() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function getTodayYMD() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchScores(ymd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${ymd}&limit=200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ESPN API ${res.status}`);
  const data = await res.json();

  const games = [];
  for (const event of (data.events || [])) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    // Validation: only include games ESPN marks as completed/final
    if (!comp.status?.type?.completed) continue;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeScore = parseInt(home.score, 10);
    const awayScore = parseInt(away.score, 10);
    if (isNaN(homeScore) || isNaN(awayScore)) continue;

    // OT detection
    const detail = comp.status.type.shortDetail || '';
    const ot = detail.includes('/') ? detail.split('/')[1] : false;

    // AP rankings — ESPN provides curatedRank.current (0 or unset = unranked)
    const awayRank = away.curatedRank?.current > 0 ? away.curatedRank.current : 0;
    const homeRank = home.curatedRank?.current > 0 ? home.curatedRank.current : 0;

    games.push({
      away: away.team.displayName,
      awayScore,
      awayRank,
      home: home.team.displayName,
      homeScore,
      homeRank,
      ot,
    });
  }

  // Sort: ranked matchups first, then by total score descending
  games.sort((a, b) => {
    const aRanked = (a.awayRank > 0 || a.homeRank > 0) ? 1 : 0;
    const bRanked = (b.awayRank > 0 || b.homeRank > 0) ? 1 : 0;
    if (bRanked !== aRanked) return bRanked - aRanked;
    return (b.awayScore + b.homeScore) - (a.awayScore + a.homeScore);
  });

  return games.slice(0, 15);
}

async function postToFacebook(message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://tocmonkey.com/logo.png', message, access_token: pageToken }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return await res.json();
}

exports.handler = async () => {
  const now  = new Date();
  const slot = now.getUTCHours() < 17 ? 'am' : 'pm';
  const ymd  = slot === 'am' ? getYesterdayYMD() : getTodayYMD();

  const gameDate = slot === 'am'
    ? new Date(Date.now() - 24 * 60 * 60 * 1000)
    : now;
  const dateStr = gameDate
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
    .toUpperCase();

  const dateKey = `ncaamb-${now.toISOString().slice(0, 10)}-${slot}`;

  try {
    const store = getStore('sports-card-dedup');
    if (await store.get(dateKey)) {
      console.log(`ncaamb-card: already posted ${dateKey}`);
      return { statusCode: 200, body: 'Already posted' };
    }
  } catch(e) { console.warn('dedup check failed:', e.message); }

  let games;
  try {
    games = await fetchScores(ymd);
    console.log(`ncaamb-card (${slot}): fetched ${games.length} completed games for ${ymd}`);
  } catch(e) {
    console.error('ncaamb-card fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  if (games.length < 1) {
    console.log('ncaamb-card: no completed games found — skipping');
    return { statusCode: 200, body: 'No games' };
  }

  const lines = games.map(g => {
    const ot      = g.ot ? ` (${g.ot})` : '';
    const awayRnk = g.awayRank ? `(#${g.awayRank}) ` : '';
    const homeRnk = g.homeRank ? `(#${g.homeRank}) ` : '';
    const winner  = g.awayScore > g.homeScore ? '>' : ' ';
    const winner2 = g.homeScore > g.awayScore ? '<' : ' ';
    return `${winner} ${awayRnk}${g.away} ${g.awayScore}  —  ${homeRnk}${g.home} ${g.homeScore} ${winner2}${ot}`.trim();
  });

  const message = `🏀 [CBB] SCORES | ${dateStr}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#CollegeBasketball #NCAAMBB #TOCMonkey`;

  try {
    const result = await postToFacebook(message);
    console.log('ncaamb-card posted:', result.id);
    try { await getStore('sports-card-dedup').set(dateKey, result.id); } catch(e) {}
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch(e) {
    console.error('ncaamb-card post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
