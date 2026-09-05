import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateCocom, generateAll, normalizeCocom } = require('./_sitrep-service.js');

function env(name) {
  try { return Netlify.env.get(name) || process.env[name] || ''; }
  catch (_) { return process.env[name] || ''; }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

function authorized(req) {
  const password = env('ADMIN_PASSWORD');
  return Boolean(password) && req.headers.get('x-admin-password') === password;
}

export default async (req) => {
  if (!authorized(req)) return json(401, { error: 'Unauthorized' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body = {};
  try { body = await req.json(); } catch (_) {}
  const requested = String(body.cocom || body.command || 'ALL').toUpperCase();

  if (requested === 'ALL') {
    try {
      const results = await generateAll({ force: true, source: 'admin' });
      return json(200, { ok: results.every((r) => r.ok), results });
    } catch (error) {
      return json(500, { ok: false, error: String(error.message || error).slice(0, 240) });
    }
  }

  const cocomId = normalizeCocom(requested);
  if (!cocomId) return json(400, { error: 'Invalid COCOM' });

  try {
    const result = await generateCocom(cocomId, { force: true, source: 'admin' });
    return json(200, { ok: true, ...result });
  } catch (error) {
    return json(500, { ok: false, error: String(error.message || error).slice(0, 240) });
  }
};
