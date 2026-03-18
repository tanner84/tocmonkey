// ─────────────────────────────────────────────────────────────────────────────
// PGA Tour Leaderboard Card — Netlify Scheduled Function
// Schedule: 23:30 UTC Thu–Sun (7:30pm ET) — captures each day's completed round
//
// 1. Fetch top 10 leaderboard via Claude web_search
// 2. Render 1080x1080 leaderboard card with @napi-rs/canvas
// 3. Deduplicate via Netlify Blobs (one post per day)
// 4. POST to Facebook as photo
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { getStore } = require('@netlify/blobs');

// Register bundled fonts — Lambda has no system fonts
(function registerFonts() {
  const fontDir = path.join(process.env.LAMBDA_TASK_ROOT || path.join(__dirname, '../..'), 'public/fonts');
  try {
    GlobalFonts.register(fs.readFileSync(path.join(fontDir, 'RobotoMono-Regular.ttf')), 'RobotoMono');
    GlobalFonts.register(fs.readFileSync(path.join(fontDir, 'RobotoMono-Bold.ttf')), 'RobotoMono');
    console.log('pga-card fonts OK. Families:', GlobalFonts.families?.map(f => f.family).join(', '));
  } catch(e) {
    console.error('pga-card font registration failed:', e.message, '| dir:', fontDir);
  }
}());

const C = {
  bg:        '#030a03',
  bgAlt:     '#051205',
  border:    '#1a3a1a',
  accent:    '#006747',   // Augusta green
  gold:      '#CBA053',   // Masters gold
  goldDim:   '#8a6a2a',
  under:     '#4dff4d',   // under par — green
  even:      '#cccccc',   // even par — gray
  over:      '#ff6666',   // over par — red
  dimGreen:  '#2a4a2a',
  faintGreen:'#1a2a1a',
  sep:       '#0a1a0a',
  pos1:      '#FFD700',   // gold medal
  pos2:      '#C0C0C0',   // silver
  pos3:      '#CD7F32',   // bronze
};

function scoreColor(scoreStr) {
  if (!scoreStr || scoreStr === 'E') return C.even;
  const n = parseFloat(scoreStr);
  if (isNaN(n)) return C.even;
  if (n < 0) return C.under;
  if (n > 0) return C.over;
  return C.even;
}

function posColor(pos) {
  const p = String(pos).replace(/[^0-9]/g, '');
  if (p === '1') return C.pos1;
  if (p === '2') return C.pos2;
  if (p === '3') return C.pos3;
  return C.gold;
}

function formatScore(s) {
  if (!s || s === 'E') return 'E';
  const n = parseFloat(s);
  if (isNaN(n)) return String(s);
  if (n > 0) return `+${n}`;
  return String(n);
}

// ── Fetch leaderboard via Claude web_search ───────────────────────────────────
async function fetchLeaderboard(anthropicKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for the current PGA Tour tournament leaderboard today including round number and scores.
Return ONLY raw JSON no markdown no backticks:
{"tournament": "Tournament Name", "round": "R1", "players": [{"pos": "1", "name": "Player Name", "total": "-12", "today": "-4", "thru": "F"}]}
Top 10 players only. Use "F" for thru if round complete, or hole number (e.g. "14") if still playing.
Total and today are scores relative to par (e.g. "-4", "+2", "E").
If no active PGA event return {"tournament": null, "players": []}`,
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  let parsed;
  try {
    const text = textBlock.text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(text);
  } catch(e) {
    throw new Error(`JSON parse failed: ${textBlock.text.slice(0, 300)}`);
  }

  return {
    tournament: parsed.tournament || null,
    round:      parsed.round || '',
    players:    Array.isArray(parsed.players) ? parsed.players : [],
  };
}

// ── Render 1080x1080 leaderboard card ────────────────────────────────────────
async function buildCard(tournament, round, players, dateStr) {
  const W = 1080, H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // Logo
  try {
    const logo = await loadImage((process.env.LAMBDA_TASK_ROOT || '.') + '/public/logo.png');
    ctx.drawImage(logo, 20, 20, 160, 160);
  } catch(e) {
    ctx.fillStyle = C.dimGreen;
    ctx.fillRect(20, 20, 160, 160);
  }

  // Sport label "PGA"
  ctx.fillStyle = C.gold;
  ctx.font = 'bold 72px RobotoMono';
  ctx.textAlign = 'right';
  ctx.fillText('PGA', W - 30, 105);

  // Round indicator
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 28px RobotoMono';
  ctx.textAlign = 'right';
  ctx.fillText(round ? `ROUND ${round.replace(/[^0-9]/g, '')}` : '', W - 30, 145);

  // Date
  ctx.fillStyle = C.dimGreen;
  ctx.font = '22px RobotoMono';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 30, 175);

  // Tournament name (below logo, left side)
  ctx.fillStyle = C.gold;
  ctx.font = 'bold 22px RobotoMono';
  ctx.textAlign = 'left';
  const tnLabel = String(tournament || 'PGA TOUR').toUpperCase().slice(0, 34);
  ctx.fillText(tnLabel, 200, 80);

  // Accent bar
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 200, W, 6);

  // Column headers
  ctx.fillStyle = C.goldDim;
  ctx.font = '16px RobotoMono';
  ctx.textAlign = 'center';
  ctx.fillText('POS', 55, 220);
  ctx.textAlign = 'left';
  ctx.fillText('PLAYER', 110, 220);
  ctx.textAlign = 'center';
  ctx.fillText('TOTAL', 700, 220);
  ctx.fillText('TODAY', 840, 220);
  ctx.fillText('THRU', 980, 220);

  // Leaderboard rows
  const ROW_H  = 76;
  const START_Y = 228;
  const MAX    = Math.min(players.length, 10);

  for (let i = 0; i < MAX; i++) {
    const p    = players[i];
    const rowY = START_Y + i * ROW_H;

    ctx.fillStyle = i % 2 === 0 ? C.bg : C.bgAlt;
    ctx.fillRect(0, rowY, W, ROW_H);

    ctx.strokeStyle = C.sep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rowY + ROW_H - 1);
    ctx.lineTo(W, rowY + ROW_H - 1);
    ctx.stroke();

    const midY = rowY + ROW_H * 0.62;

    // Position
    ctx.fillStyle = posColor(p.pos);
    ctx.font = 'bold 22px RobotoMono';
    ctx.textAlign = 'center';
    ctx.fillText(String(p.pos || '').slice(0, 4), 55, midY);

    // Tie indicator bar for T positions
    if (String(p.pos).startsWith('T')) {
      ctx.fillStyle = C.goldDim;
      ctx.fillRect(4, rowY + 4, 4, ROW_H - 8);
    }

    // Player name
    ctx.fillStyle = C.even;
    ctx.font = 'bold 22px RobotoMono';
    ctx.textAlign = 'left';
    ctx.fillText(String(p.name || '').slice(0, 22), 110, midY);

    // Total score
    const totalStr = formatScore(p.total);
    ctx.fillStyle = scoreColor(p.total);
    ctx.font = 'bold 26px RobotoMono';
    ctx.textAlign = 'center';
    ctx.fillText(totalStr, 700, midY);

    // Today's score
    const todayStr = formatScore(p.today);
    ctx.fillStyle = scoreColor(p.today);
    ctx.font = '22px RobotoMono';
    ctx.textAlign = 'center';
    ctx.fillText(todayStr, 840, midY);

    // Thru
    const thruStr = String(p.thru || '-');
    ctx.fillStyle = thruStr === 'F' ? C.dimGreen : C.gold;
    ctx.font = thruStr === 'F' ? '18px RobotoMono' : '20px RobotoMono';
    ctx.textAlign = 'center';
    ctx.fillText(thruStr, 980, midY);
  }

  // Footer
  ctx.fillStyle = C.faintGreen;
  ctx.font = '20px RobotoMono';
  ctx.textAlign = 'left';
  ctx.fillText('OPEN SOURCE · NOT VERIFIED', 30, 1040);

  ctx.fillStyle = C.dimGreen;
  ctx.font = '22px RobotoMono';
  ctx.textAlign = 'right';
  ctx.fillText('tocmonkey.com', W - 30, 1040);

  return canvas.toBuffer('image/png');
}

async function postPhoto(imageBuffer, message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');

  const form = new FormData();
  form.append('source', new Blob([imageBuffer], { type: 'image/png' }), 'card.png');
  form.append('message', message);
  form.append('access_token', pageToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return await res.json();
}

exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  }).toUpperCase();
  const dateKey = `pga-${now.toISOString().slice(0, 10)}`;

  // Dedup — one post per day
  try {
    const store    = getStore('sports-card-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`pga-card: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

  let result;
  try {
    result = await fetchLeaderboard(anthropicKey);
  } catch(e) {
    console.error('Leaderboard fetch failed:', e.message);
    return { statusCode: 500, body: `Leaderboard fetch failed: ${e.message}` };
  }

  if (!result.tournament || result.players.length < 5) {
    console.log(`pga-card: no active event or insufficient data (${result.players.length} players) — skipping`);
    return { statusCode: 200, body: 'No active PGA event or insufficient data — skipping' };
  }

  console.log(`pga-card: ${result.players.length} players, ${result.tournament} ${result.round}`);

  let imageBuffer;
  try {
    imageBuffer = await buildCard(result.tournament, result.round, result.players, dateStr);
    console.log(`pga-card: rendered (${imageBuffer.length} bytes)`);
  } catch(e) {
    console.error('Card render failed:', e.message);
    return { statusCode: 500, body: `Card render failed: ${e.message}` };
  }

  const message = `[PGA] LEADERBOARD | ${result.tournament} ${result.round} | ${dateStr}\n\ntocmonkey.com\n\n#PGA #Golf #TOCMonkey`;
  try {
    const fbResult = await postPhoto(imageBuffer, message);
    const postId   = fbResult.id || fbResult.post_id || 'unknown';
    console.log(`pga-card posted: ${postId}`);

    try {
      const store = getStore('sports-card-dedup');
      await store.set(dateKey, postId);
    } catch(e) {
      console.warn('Blobs dedup write failed (non-fatal):', e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: postId }) };
  } catch(e) {
    console.error('Facebook post failed:', e.message);
    return { statusCode: 500, body: `Facebook post failed: ${e.message}` };
  }
};
