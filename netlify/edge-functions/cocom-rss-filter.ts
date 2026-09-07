import { filterReporting, normalizeCommand } from '../../enhancements/reporting-policy.mjs';

export default async (request: Request, context: any) => {
  const url = new URL(request.url);
  const command = normalizeCommand(url.searchParams.get('cocom') || '');
  const response = await context.next();
  if (!command || !response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return response;
  let payload;
  try { payload = await response.clone().json(); } catch { return response; }
  if (!Array.isArray(payload)) return response;
  const purpose = ['sigacts','sitrep'].includes(url.searchParams.get('purpose') || '') ? url.searchParams.get('purpose') : 'feed';
  const filtered = filterReporting(payload, command, { purpose });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
  headers.set('X-TOCMonkey-COCOM-Filter', command === 'INDOPACOM' ? 'PACOM' : command);
  headers.set('X-TOCMonkey-Filtered-Items', String(filtered.length));
  return new Response(JSON.stringify(filtered), { status:response.status, headers });
};
