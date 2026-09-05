const { generateCocom, generateAll, normalizeCocom } = require('./_sitrep-service');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function json(statusCode, body) {
  return { statusCode, headers:{ 'Content-Type':'application/json', 'Cache-Control':'private, no-store' }, body:JSON.stringify(body) };
}

function authorized(event) {
  return Boolean(ADMIN_PASSWORD) && event.headers['x-admin-password'] === ADMIN_PASSWORD;
}

exports.handler = async function(event) {
  if (!authorized(event)) return json(401, { error:'Unauthorized' });
  if (event.httpMethod !== 'POST') return json(405, { error:'Method not allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const requested = String(body.cocom || body.command || 'ALL').toUpperCase();

  if (requested === 'ALL') {
    const results = await generateAll({ force:true, source:'admin' });
    return json(200, { ok:results.every(r => r.ok), results });
  }

  const cocomId = normalizeCocom(requested);
  if (!cocomId) return json(400, { error:'Invalid COCOM' });
  try {
    const result = await generateCocom(cocomId, { force:true, source:'admin' });
    return json(200, { ok:true, ...result });
  } catch (error) {
    return json(500, { ok:false, error:String(error.message || error).slice(0,240) });
  }
};
