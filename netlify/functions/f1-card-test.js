// F1 Race Results — pulls verified results from Jolpica (Ergast) API, posts logo + text to Facebook
// Jolpica is the community-maintained Ergast replacement: https://jolpi.ca/ergast/
// No API key required. Returns official FIA-verified race results.

async function fetchResults() {
  const url = 'https://api.jolpi.ca/ergast/f1/current/last/results/';
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Jolpica API ${res.status}`);
  const data = await res.json();

  const races = data?.MRData?.RaceTable?.Races;
  if (!races || races.length === 0) throw new Error('No race data returned');

  const race = races[0];
  if (!race.Results || race.Results.length === 0) throw new Error('Race has no results yet');

  const top3 = race.Results.slice(0, 3).map(r => ({
    pos:    parseInt(r.position, 10),
    driver: `${r.Driver.givenName} ${r.Driver.familyName}`,
    team:   r.Constructor.name,
    // P1 gets race time, P2+ get gap
    time:   r.position === '1' ? (r.Time?.time || '') : (r.Time?.time || '+N/A'),
  }));

  return {
    race:    race.raceName,
    circuit: race.Circuit.circuitName,
    date:    race.date,
    results: top3,
  };
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
  let data;
  try {
    data = await fetchResults();
    console.log('f1-card-test: fetched', data.race, data.date);
  } catch(e) {
    console.error('f1-card-test fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  const MEDAL = ['', '🥇', '🥈', '🥉'];
  const lines = data.results.map(r => {
    const medal = MEDAL[r.pos] || `P${r.pos}`;
    return `${medal} ${r.driver} — ${r.team}${r.time ? ' — ' + r.time : ''}`;
  });

  // Format date from YYYY-MM-DD to "Mon DD, YYYY"
  const d = new Date(data.date + 'T12:00:00Z');
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

  const message = `🏎 [F1] ${data.race} | ${dateStr}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#F1 #Formula1 #TOCMonkey`;

  try {
    const result = await postToFacebook(message);
    console.log('f1-card-test posted:', result.id);
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch(e) {
    console.error('f1-card-test post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
