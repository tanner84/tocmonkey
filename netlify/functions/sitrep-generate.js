const { generateAll } = require('./_sitrep-service');

exports.handler = async function() {
  const results = await generateAll({ source:'scheduled' });
  const ok = results.filter(r => r.ok).length;
  const degraded = results.filter(r => r.degraded).length;
  return {
    statusCode: ok ? 200 : 500,
    headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
    body: JSON.stringify({
      ok:ok === results.length,
      generatedAt:new Date().toISOString(),
      completed:ok,
      degraded,
      total:results.length,
      results:results.map(r => ({
        cocomId:r.cocomId,
        ok:r.ok,
        skipped:Boolean(r.skipped),
        reason:r.reason || null,
        status:r.report?.status || null,
        mode:r.report?.mode || null,
        generatedAt:r.report?.generatedAt || null,
        sourceItemCount:r.report?.sourceItemCount || 0,
        error:r.error || null,
      }))
    })
  };
};
