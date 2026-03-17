// ─────────────────────────────────────────────────────────────────────────────
// UFC Score Card — Netlify Scheduled Function
// Schedule: Saturday at 07:00 UTC (3am ET) — captures Friday Fight Night results
//
// 1. Fetch UFC Fight Night results via Claude web_search
// 2. Render a 1080x1080 fight card image with @napi-rs/canvas
// 3. Deduplicate via Netlify Blobs (one post per Saturday)
// 4. POST to Facebook as photo (/photos endpoint)
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getStore } from '@netlify/blobs';

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:        '#0a0a0f',
  bgAlt:     '#0d0d15',
  border:    '#2d2d5a',
  accent:    '#c8102e',   // UFC red
  winGold:   '#ffd700',
  winText:   '#ffffff',
  loseText:  '#4a4a6a',
  dimBlue:   '#2a2a5a',
  faintBlue: '#1a1a3a',
  sep:       '#1a1a2a',
  at:        '#3a3a5a',
  ko:        '#c8102e',   // red
  tko:       '#ff6600',   // orange
  sub:       '#7b2d8b',   // purple
  dec:       '#00308F',   // blue
  nc:        '#555555',   // gray
};

// Method badge color
function methodColor(method) {
  const m = String(method || '').toUpperCase();
  if (m.startsWith('KO'))  return C.ko;
  if (m.startsWith('TKO')) return C.tko;
  if (m.startsWith('SUB')) return C.sub;
  if (m.startsWith('DEC')) return C.dec;
  return C.nc;
}

// ── Fetch results via Claude web_search ───────────────────────────────────────
async function fetchResults(anthropicKey) {
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
        content: `Search for this weekend's UFC Fight Night results including all main card and prelim fights.
Return ONLY raw JSON no markdown no backticks:
{"event": "UFC Fight Night: City", "date": "YYYY-MM-DD", "fights": [{"winner": "Fighter Name", "loser": "Fighter Name", "method": "KO/TKO/SUB/DEC/NC", "round": 3, "time": "2:15", "weightClass": "Lightweight"}]}
Prioritize main card fights first. Cap at 10 fights. If no recent UFC event found, return {"event": null, "fights": []}`,
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
    event:  parsed.event  || 'UFC FIGHT NIGHT',
    date:   parsed.date   || '',
    fights: Array.isArray(parsed.fights) ? parsed.fights : [],
  };
}

// ── Render 1080x1080 card ─────────────────────────────────────────────────────
async function buildCard(eventName, fights, dateStr) {
  const W = 1080, H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ── Border ──────────────────────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Logo ────────────────────────────────────────────────────────────────────
  try {
    const logoPath = (process.env.LAMBDA_TASK_ROOT || '.') + '/public/logo.png';
    const logo = await loadImage(logoPath);
    ctx.drawImage(logo, 20, 20, 160, 160);
  } catch(e) {
    ctx.fillStyle = C.dimBlue;
    ctx.fillRect(20, 20, 160, 160);
    console.warn('Logo not found:', e.message);
  }

  // ── Sport label "UFC" ────────────────────────────────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 72px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('UFC', W - 30, 105);

  // ── Date ────────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.dimBlue;
  ctx.font = '24px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 30, 140);

  // ── Event name ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.winGold;
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'right';
  const evLabel = String(eventName).toUpperCase().slice(0, 38);
  ctx.fillText(evLabel, W - 30, 170);

  // ── Accent bar (UFC red, 6px at y=200) ──────────────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 200, W, 6);

  // ── Column header ───────────────────────────────────────────────────────────
  ctx.fillStyle = C.dimBlue;
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('WINNER', 30, 218);
  ctx.textAlign = 'right';
  ctx.fillText('LOSER', W - 30, 218);
  ctx.textAlign = 'center';
  ctx.fillText('METHOD · RD · TIME', W / 2, 218);

  // ── Fight rows ───────────────────────────────────────────────────────────────
  const ROW_H  = 74;
  const START_Y = 226;
  const MAX    = Math.min(fights.length, 10);

  for (let i = 0; i < MAX; i++) {
    const f    = fights[i];
    const rowY = START_Y + i * ROW_H;

    // Alternating background
    ctx.fillStyle = i % 2 === 0 ? C.bg : C.bgAlt;
    ctx.fillRect(0, rowY, W, ROW_H);

    // Separator
    ctx.strokeStyle = C.sep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rowY + ROW_H - 1);
    ctx.lineTo(W, rowY + ROW_H - 1);
    ctx.stroke();

    const midY      = rowY + ROW_H * 0.45;
    const subY      = rowY + ROW_H * 0.78;
    const mColor    = methodColor(f.method);
    const methodStr = String(f.method || '').toUpperCase();
    const detailStr = `RD ${f.round || '?'} · ${f.time || ''}`.trim();
    const wcStr     = String(f.weightClass || '').toUpperCase().slice(0, 20);

    // ── Winner (left) ─────────────────────────────────────────────────────────
    ctx.fillStyle = C.winGold;
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(f.winner || '').slice(0, 18), 30, midY);

    // Winner "W" badge
    ctx.fillStyle = mColor;
    ctx.fillRect(28, rowY + 4, 6, 14);

    // ── Loser (right) ─────────────────────────────────────────────────────────
    ctx.fillStyle = C.loseText;
    ctx.font = '18px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(f.loser || '').slice(0, 18), W - 30, midY);

    // ── Method badge (center) ─────────────────────────────────────────────────
    const badgeW = 160;
    const badgeH = 26;
    const badgeX = W / 2 - badgeW / 2;
    const badgeY = rowY + 8;

    ctx.fillStyle = mColor;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(methodStr, W / 2, badgeY + 18);

    // ── Round · Time · Weight class (center sub-row) ──────────────────────────
    ctx.fillStyle = C.at;
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${detailStr}  ·  ${wcStr}`, W / 2, subY);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.faintBlue;
  ctx.font = '20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('OPEN SOURCE · NOT VERIFIED', 30, 1040);

  ctx.fillStyle = C.dimBlue;
  ctx.font = '22px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('tocmonkey.com', W - 30, 1040);

  return canvas.toBuffer('image/png');
}

// ── Post photo to Facebook ────────────────────────────────────────────────────
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

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  }).toUpperCase();
  const dateKey = `ufc-${now.toISOString().slice(0, 10)}`;

  // ── Deduplication ───────────────────────────────────────────────────────────
  try {
    const store    = getStore('sports-card-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`ufc-card: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

  // ── Fetch results ───────────────────────────────────────────────────────────
  let result;
  try {
    result = await fetchResults(anthropicKey);
  } catch(e) {
    console.error('UFC fetch failed:', e.message);
    return { statusCode: 500, body: `UFC fetch failed: ${e.message}` };
  }

  if (!result.event || result.fights.length < 3) {
    console.log(`ufc-card: only ${result.fights.length} fights found — skipping`);
    return { statusCode: 200, body: `Only ${result.fights.length} fights — skipping` };
  }

  console.log(`ufc-card: ${result.fights.length} fights for ${result.event}`);

  // ── Build card ──────────────────────────────────────────────────────────────
  let imageBuffer;
  try {
    imageBuffer = await buildCard(result.event, result.fights, dateStr);
    console.log(`ufc-card: rendered (${imageBuffer.length} bytes)`);
  } catch(e) {
    console.error('Card render failed:', e.message);
    return { statusCode: 500, body: `Card render failed: ${e.message}` };
  }

  // ── Post to Facebook ────────────────────────────────────────────────────────
  const message = `[UFC] FIGHT NIGHT RESULTS | ${dateStr}\n\ntocmonkey.com\n\n#UFC #MMA #TOCMonkey`;
  try {
    const fbResult = await postPhoto(imageBuffer, message);
    const postId   = fbResult.id || fbResult.post_id || 'unknown';
    console.log(`ufc-card posted: ${postId}`);

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
