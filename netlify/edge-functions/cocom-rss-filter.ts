const COCOMS = ['EUCOM','CENTCOM','INDOPACOM','AFRICOM','SOUTHCOM','NORTHCOM'];

const TERMS: Record<string,string[]> = {
  EUCOM: ['ukraine','ukrainian','kyiv','kiev','russia','russian','moscow','kremlin','nato','europe','european','baltic','poland','germany','france','britain','united kingdom','black sea','crimea','belarus','moldova','georgia','armenia','azerbaijan','balkans','serbia','kosovo','finland','sweden','norway','romania','bulgaria','kaliningrad','kyiv independent','politico europe','euronews','deutsche welle','rferl'],
  CENTCOM: ['iran','iranian','tehran','israel','israeli','gaza','hamas','palestin','hezbollah','houthi','yemen','iraq','iraqi','syria','syrian','jordan','lebanon','qatar','saudi','uae','emirates','bahrain','kuwait','oman','afghanistan','pakistan','red sea','hormuz','gulf of aden','bab el mandeb','centcom','irgc','quds force','middle east eye','al monitor','times of israel','jerusalem post','iran international','arab news','gulf news'],
  INDOPACOM: ['indo pacific','indo-pacific','pacific','china','chinese','beijing','taiwan','taipei','pla','south china sea','east china sea','philippines','philippine','manila','japan','japanese','tokyo','north korea','pyongyang','south korea','seoul','indonesia','vietnam','india','australia','guam','myanmar','burma','thailand','singapore','malaysia','cambodia','laos','aukus','quad','spratly','paracel','scarborough shoal','second thomas shoal','nikkei asia','south china morning post','rappler','japan times','taiwan news'],
  AFRICOM: ['africa','african','sudan','darfur','ethiopia','ethiopian','tigray','somalia','somali','kenya','sahel','mali','niger','burkina','chad','nigeria','mozambique','congo','drc','libya','algeria','morocco','tunisia','south africa','uganda','rwanda','cameroon','al shabaab','al-shabaab','jnim','boko haram','africa corps','horn of africa','gulf of guinea','allafrica','africanews','africa center'],
  SOUTHCOM: ['southcom','south america','latin america','caribbean','colombia','colombian','venezuela','venezuelan','brazil','brazilian','argentina','chile','peru','ecuador','bolivia','paraguay','uruguay','guyana','suriname','panama','cuba','haiti','dominican republic','jamaica','tren de aragua','farc','eln','clan del golfo','comando vermelho','pcc','insight crime','mercopress'],
  NORTHCOM: ['northcom','norad','alaska','canada','canadian','mexico','mexican','arctic','homeland security','border patrol','cbp','ice raid','ice agents','us immigration','u.s. immigration','fentanyl','sinaloa','cjng','jalisco new generation','gulf cartel','national guard','northern command','arctic today','high north news','mexico news daily']
};

function normalize(value='') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCommand(value='') {
  const id = String(value).toUpperCase().trim();
  if (id === 'PACOM') return 'INDOPACOM';
  return COCOMS.includes(id) ? id : null;
}

function relevant(item:any, command:string) {
  const sourceCocom = normalizeCommand(item?.cocom || '');
  if (sourceCocom) return sourceCocom === command;

  const text = ` ${normalize(`${item?.source || ''} ${item?.sourceHandle || ''} ${item?.title || ''} ${item?.desc || ''}`)} `;
  return (TERMS[command] || []).some(term => {
    const token = normalize(term);
    return text.includes(` ${token} `) || text.includes(token);
  });
}

function jsonResponse(payload:any, source:Response, headersOverride?:Headers) {
  const headers = headersOverride || new Headers(source.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(payload), {
    status:source.status,
    statusText:source.statusText,
    headers
  });
}

export default async (request:Request, context:any) => {
  const url = new URL(request.url);
  const command = normalizeCommand(url.searchParams.get('cocom') || '');
  const response = await context.next();
  if (!command || !response.ok) return response;

  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return response;

  let payload:any;
  try { payload = await response.json(); }
  catch (_) { return response; }
  if (!Array.isArray(payload)) return jsonResponse(payload, response);

  const filtered = payload.filter(item => relevant(item, command));
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=300');
  headers.set('X-TOCMonkey-COCOM-Filter', command === 'INDOPACOM' ? 'PACOM' : command);
  headers.set('X-TOCMonkey-Filtered-Items', String(filtered.length));

  return jsonResponse(filtered, response, headers);
};
