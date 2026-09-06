const { refreshMarketData } = require('./_market-ticker');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async function(event = {}) {
  const requestedForce = String(event?.queryStringParameters?.force || '') === '1';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const supplied = event?.headers?.['x-admin-password'] || event?.headers?.['X-Admin-Password'] || '';
  const force = requestedForce && Boolean(adminPassword) && supplied === adminPassword;

  try {
    const result = await refreshMarketData({ force });
    return json(200, {
      ok: true,
      updatedAt: result.updatedAt || null,
      coverage: result.coverage || null,
      skipped: Boolean(result.skipped),
      skipReason: result.skipReason || null,
      errors: result.errors || [],
      provider: 'EIA + verified web research cache',
    });
  } catch (error) {
    console.error('ticker-refresh failed:', error);
    return json(500, { ok:false, error:error.message || 'Market refresh failed' });
  }
};
