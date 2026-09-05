// Maritime SITREP — daily OpenAI-backed naval/shipping brief.
const { getStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

async function fetchRSSItems(cocom, siteUrl) {
  const res = await fetch(`${siteUrl}/.netlify/functions/rss?cocom=${cocom}`, { signal:AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RSS ${cocom} failed: ${res.status}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function postToFacebook(message) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !token) throw new Error('Facebook env vars not set');
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message,access_token:token}), signal:AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return res.json();
}

function formatItems(items,max=15){return items.slice(0,max).map((it,i)=>`${i+1}. [${it.source||'SOURCE'}] ${it.title}${it.desc?' — '+it.desc.slice(0,120):''}`).join('\n')||'(no items)';}

async function verifyPost(rawSource,draft){
  const prompt=`You are a fact-checking editor for a public naval OSINT SITREP. Review the draft strictly against SOURCE MATERIAL. Remove any unsupported intercept/casualty figures, munition types, precise target descriptions, actor attribution, causal claims, or static chokepoint claims. Route events to the correct theater. Preserve inline hedging for unconfirmed details. Remove any bullet not traceable to SOURCE MATERIAL. Prefer operational-level wording over unsupported specificity. Return only the corrected post.\n\nSOURCE MATERIAL:\n${rawSource}\n\nPOST TO VERIFY:\n${draft}`;
  return (await generateText({prompt,model:process.env.OPENAI_VERIFY_MODEL||'gpt-5.6-terra',maxOutputTokens:1050,reasoningEffort:'low',retries:1})).text.trim();
}

exports.handler=async function(){
  const siteUrl=(process.env.URL||'https://tocmonkey.com').replace(/\/$/,'');
  const dateStr=new Date().toISOString().slice(0,10),dateKey=`maritime-${dateStr}`;
  try{const s=getStore('sitrep-dedup');if(await s.get(dateKey))return{statusCode:200,body:`Already posted for ${dateKey}`};}catch(e){console.warn('Dedup check failed:',e.message);}

  const [centcomRes,pacomRes,eucomRes,northcomRes,allRes]=await Promise.allSettled([
    fetchRSSItems('CENTCOM',siteUrl),fetchRSSItems('INDOPACOM',siteUrl),fetchRSSItems('EUCOM',siteUrl),fetchRSSItems('NORTHCOM',siteUrl),fetchRSSItems('ALL',siteUrl)
  ]);
  const centcom=centcomRes.status==='fulfilled'?centcomRes.value:[];
  const pacom=pacomRes.status==='fulfilled'?pacomRes.value:[];
  const eucom=eucomRes.status==='fulfilled'?eucomRes.value:[];
  const northcom=northcomRes.status==='fulfilled'?northcomRes.value:[];
  const allItems=allRes.status==='fulfilled'?allRes.value:[];
  const maritimeHandles=new Set(['GCAPTAIN','NAVALNEWS','MARITIMEEXEC','USNI','LLOYDSLIST','SPLASH247']);
  const maritime=allItems.filter(it=>maritimeHandles.has(String(it.source||'').toUpperCase()));
  if(!centcom.length&&!pacom.length&&!eucom.length&&!northcom.length&&!maritime.length)return{statusCode:200,body:'No maritime source items — skipping'};

  const rawSource=[
    `DEDICATED MARITIME SOURCES:\n${formatItems(maritime,20)}`,
    `CENTCOM / RED SEA / GULF:\n${formatItems(centcom,10)}`,
    `PACOM / WESTERN PACIFIC:\n${formatItems(pacom,10)}`,
    `EUCOM / BLACK SEA / BALTIC / MED:\n${formatItems(eucom,10)}`,
    `NORTHCOM / ARCTIC / NORTH ATLANTIC:\n${formatItems(northcom,8)}`,
  ].join('\n\n');

  const prompt=`You are a naval OSINT analyst writing a daily public maritime SITREP using only the source material below.\n\n${rawSource}\n\nWrite:\n⚓ MARITIME SITREP | ${dateStr} UTC\n\n🟡 RED SEA / GULF OF ADEN\n- [vessel/location] — [factual terse sentence]\n\n🔴 SOUTH CHINA SEA / PACIFIC\n- [vessel/location] — [factual terse sentence]\n\n🔵 BLACK SEA / BALTIC / MED\n- [vessel/location] — [factual terse sentence]\n\n🟤 ARCTIC / NORTH ATLANTIC\n- [vessel/location] — [factual terse sentence]\n\n🌊 SHIPPING & CHOKEPOINTS\n- [route/chokepoint] — [current traffic/disruption/threat status]\n\n⚠️ All reporting derived from open-source media. Unverified. For situational awareness only. | tocmonkey.com\n\n#Maritime #NavalOSINT #ShippingSecurity #TOCMonkey\n\nRules: use only source-supported facts; no invented munitions, casualty/intercept figures, ship/unit names, or causal claims. Use status language such as limited transits/partial traffic/reopening attempts instead of unsupported open/closed absolutes. Hedge unconfirmed reporting inline. Consolidate duplicate events. Omit thin sections instead of padding. Max 4 bullets per region. Output only the post.`;

  let draft;
  try{draft=(await generateText({prompt,model:process.env.OPENAI_SOCIAL_MODEL||'gpt-5.6-luna',maxOutputTokens:950,reasoningEffort:'low',retries:2})).text.trim();}
  catch(e){return{statusCode:500,body:`OpenAI generation failed: ${e.message}`};}
  if(!draft)return{statusCode:500,body:'No content from OpenAI'};
  let finalText=draft;
  try{finalText=(await verifyPost(rawSource,draft))||draft;}catch(e){console.error('OpenAI verification failed — using draft:',e.message);}

  try{const fb=await postToFacebook(finalText),postId=fb.id||fb.post_id||'unknown';try{await getStore('sitrep-dedup').set(dateKey,postId);}catch(e){console.warn('Dedup write failed:',e.message);}return{statusCode:200,body:JSON.stringify({ok:true,fb_post_id:postId,brief:finalText,provider:'openai'})};}
  catch(e){return{statusCode:500,body:JSON.stringify({ok:false,error:e.message,brief:finalText,provider:'openai'})};}
};
