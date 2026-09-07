import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { generateAll } = require('./_sitrep-service.js');

export default async (req) => {
  const password = Netlify.env.get('ADMIN_PASSWORD');
  if (req.method !== 'POST' || !password || req.headers.get('x-admin-password') !== password) return;
  const results = await generateAll({ source:'scheduled-background' });
  console.log('SITREP generation completed', results.map(r => ({
    cocom:r.cocomId, ok:r.ok, degraded:Boolean(r.degraded), mode:r.report?.mode,
    reason:r.reason || null, error:r.error || r.report?.generationError || null
  })));
};
