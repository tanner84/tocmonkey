// ─────────────────────────────────────────────────────────────────────────────
// F1 Race Results Card — TEST FUNCTION (no dedup, always posts)
// Uses SVG + @resvg/resvg-js (self-contained Rust renderer, loads fonts
// directly from file — no system fontconfig needed on Lambda).
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');

const FONT_DIR = path.join(process.env.LAMBDA_TASK_ROOT || path.join(__dirname, '../..'), 'public/fonts');

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSVG(data) {
  const W = 1080, H = 1080;
  const F = 'Roboto Mono';

  const MEDAL = ['', '#FFD700', '#C0C0C0', '#CD7F32'];
  const results = Array.isArray(data.results) ? data.results.slice(0, 3) : [];

  const rows = results.map((r, i) => {
    const pos      = r.pos || (i + 1);
    const color    = MEDAL[pos] || '#FFFFFF';
    const rowY     = 240 + i * 220;
    const timeStr  = pos === 1 ? (r.time || '') : (r.gap || '');
    return `
    <rect x="20" y="${rowY}" width="1040" height="204" fill="#111111"/>
    <rect x="20" y="${rowY}" width="8"    height="204" fill="${color}"/>
    <text x="50"   y="${rowY + 100}" font-family="${F}" font-weight="bold"   font-size="80" fill="${color}">P${pos}</text>
    <text x="200"  y="${rowY + 72}"  font-family="${F}" font-weight="bold"   font-size="42" fill="#FFFFFF">${escXml(r.driver)}</text>
    <text x="200"  y="${rowY + 115}" font-family="${F}" font-weight="normal" font-size="28" fill="#888888">${escXml(r.team)}</text>
    <text x="1030" y="${rowY + 95}"  font-family="${F}" font-weight="bold"   font-size="32" fill="${color}" text-anchor="end">${escXml(timeStr)}</text>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>
  <rect x="0" y="0" width="${W}" height="8" fill="#E8002D"/>

  <text x="40"   y="120" font-family="${F}" font-weight="bold"   font-size="96" fill="#E8002D">F1</text>
  <text x="40"   y="165" font-family="${F}" font-weight="bold"   font-size="36" fill="#FFFFFF">RACE RESULTS</text>
  <text x="1040" y="100" font-family="${F}" font-weight="bold"   font-size="28" fill="#FFFFFF" text-anchor="end">${escXml((data.race || '').toUpperCase())}</text>
  <text x="1040" y="134" font-family="${F}" font-weight="normal" font-size="22" fill="#888888" text-anchor="end">${escXml(data.circuit)}</text>
  <text x="1040" y="164" font-family="${F}" font-weight="normal" font-size="22" fill="#888888" text-anchor="end">${escXml(data.date)}</text>

  <rect x="0" y="200" width="${W}" height="4" fill="#E8002D"/>

  ${rows}

  <rect x="0" y="1040" width="${W}" height="4" fill="#E8002D"/>
  <text x="40"   y="1068" font-family="${F}" font-weight="normal" font-size="20" fill="#444444">OPEN SOURCE · NOT VERIFIED</text>
  <text x="1040" y="1068" font-family="${F}" font-weight="normal" font-size="20" fill="#888888" text-anchor="end">tocmonkey.com</text>
</svg>`;
}

// ── Fetch F1 results via Claude web_search ────────────────────────────────────
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
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for the most recent Formula 1 Grand Prix race results. Return ONLY raw JSON, no markdown, no backticks, no explanation:
{"race":"Grand Prix Name","circuit":"Circuit Name","date":"Mon DD, YYYY","results":[{"pos":1,"driver":"Full Name","team":"Team Name","time":"H:MM:SS.mmm","gap":null},{"pos":2,"driver":"Full Name","team":"Team Name","time":null,"gap":"+X.XXXs"},{"pos":3,"driver":"Full Name","team":"Team Name","time":null,"gap":"+X.XXXs"}]}`,
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }
  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  const raw = textBlock.text.trim();
  // Extract first {...} block regardless of surrounding prose
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object found in response: ${raw.slice(0, 100)}`);
  return JSON.parse(match[0]);
}

// ── Post image to Facebook ────────────────────────────────────────────────────
async function postPhoto(imageBuffer, message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');

  const form = new FormData();
  form.append('source', new Blob([imageBuffer], { type: 'image/jpeg' }), 'card.jpg');
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

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  let data;
  try {
    data = await fetchResults(anthropicKey);
    console.log('f1-card-test: fetched', data.race, data.date);
  } catch(e) {
    console.error('f1-card-test fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  let imageBuffer;
  try {
    const svg = buildSVG(data);
    const resvg = new Resvg(svg, {
      font: {
        loadSystemFonts: false,
        fontFiles: [
          path.join(FONT_DIR, 'RobotoMono-Regular.ttf'),
          path.join(FONT_DIR, 'RobotoMono-Bold.ttf'),
        ],
      },
    });
    const rawPng = resvg.render().asPng();
    imageBuffer = await sharp(rawPng).jpeg({ quality: 88 }).toBuffer();
    console.log(`f1-card-test: rendered ${imageBuffer.length} bytes`);
  } catch(e) {
    console.error('f1-card-test render failed:', e.message);
    return { statusCode: 500, body: `Render failed: ${e.message}` };
  }

  const message = `[F1] ${data.race || 'RACE RESULTS'} | ${data.date || ''}\n\ntocmonkey.com\n\n#F1 #Formula1 #TOCMonkey`;

  try {
    const result = await postPhoto(imageBuffer, message);
    const postId = result.id || result.post_id || 'unknown';
    console.log('f1-card-test posted:', postId);
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: postId, race: data.race }) };
  } catch(e) {
    console.error('f1-card-test post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
