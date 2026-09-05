// TOC SITREP — daily transnational organized-crime briefing via OpenAI.
const { getStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

const COCOM_OCG = {
  EUCOM:{aor:'Europe and Eurasia',focus:'Russian organized crime, Vory networks, Eastern European trafficking, sanctions evasion, money laundering, Balkan crime groups',actors:'Solntsevskaya Bratva, Tambovskaya, Izmaylovskaya, Georgian Vory, Mogilevich'},
  CENTCOM:{aor:'Middle East and Central Asia',focus:'IRGC-linked procurement and sanctions evasion, hawala networks, Afghan narcotics, Gulf illicit finance, Hezbollah financial activity',actors:'IRGC-Quds Force, Hezbollah finance networks, Afghan narcotics networks, hawala brokers'},
  INDOPACOM:{aor:'Indo-Pacific',focus:'Triad activity, North Korean cybercrime and crypto theft, Southeast Asian trafficking corridors, scam compounds, fentanyl precursor networks',actors:'14K Triad, Bamboo Union, Lazarus Group, Cambodian/Myanmar scam networks'},
  NORTHCOM:{aor:'North America',focus:'Mexican cartel operations in Mexico and U.S. approaches, fentanyl distribution, cross-border trafficking, money laundering',actors:'Sinaloa Cartel, CJNG, Gulf Cartel, Northeast Cartel, MS-13'},
  SOUTHCOM:{aor:'Latin America and Caribbean excluding Mexico',focus:'South American and Caribbean trafficking networks, cocaine production and transit, Venezuelan crime-state nexus, gangs and guerrilla-OCG links',actors:'Tren de Aragua, FARC dissidents, PCC, Clan del Golfo, Haitian gang coalitions'},
  AFRICOM:{aor:'Africa',focus:'West African cybercrime/fraud, Sahel smuggling, natural-resource trafficking, terror-crime financing links, piracy and illicit logistics',actors:'Black Axe, Sahelian smuggling networks, gold trafficking networks, piracy networks'},
};

function label(id){return id==='INDOPACOM'?'PACOM':id;}
async function fetchRSSItems(cocom,siteUrl){const r=await fetch(`${siteUrl}/.netlify/functions/rss?cocom=${cocom}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`RSS ${cocom} failed: ${r.status}`);const d=await r.json();return Array.isArray(d)?d:[];}
async function postToFacebook(message){const pageId=process.env.FACEBOOK_PAGE_ID;const token=process.env.FACEBOOK_PAGE_ACCESS_TOKEN||process.env.FACEBOOK_ACCESS_TOKEN;if(!pageId||!token)throw new Error('Facebook env vars not set');const r=await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,access_token:token}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Facebook API ${r.status}: ${await r.text()}`);return r.json();}
function formatItems(items,max=15){return items.slice(0,max).map((it,i)=>`${i+1}. [${it.source||'SOURCE'}] ${it.title}${it.desc?' — '+it.desc.slice(0,120):''}`).join('\n')||'(no items)';}

async function verifyPost(rawSource,generatedPost){
  const aorLines=Object.entries(COCOM_OCG).map(([k,v])=>`- ${label(k)}: ${v.aor} — ${v.focus}`).join('\n');
  const prompt=`You are a fact-checking editor for a public military OSINT and organized-crime dashboard.\nReview the TOC SITREP below.\n\nAOR RULES:\n${aorLines}\n\nDelete bullets assigned to the wrong AOR; delete claims not traceable to SOURCE MATERIAL; remove unsupported actor names, financial figures, casualty numbers, causal claims, alliance/intent/future-operation speculation. If a section has fewer than 2 verified current bullets, replace it only with a SPOTLIGHT clearly labeled as background and using the known-actor background supplied in SOURCE MATERIAL; never present background as a current event. Return only the corrected post.\n\nSOURCE MATERIAL:\n${rawSource}\n\nPOST TO VERIFY:\n${generatedPost}`;
  const result=await generateText({prompt,model:process.env.OPENAI_VERIFY_MODEL||'gpt-5.6-terra',maxOutputTokens:1100,reasoningEffort:'low',retries:1});
  return result.text.trim();
}

exports.handler=async function(){
  const siteUrl=(process.env.URL||'https://tocmonkey.com').replace(/\/$/,'');
  const dateStr=new Date().toISOString().slice(0,10),dateKey=`tocsitrep-${dateStr}`;
  try{const s=getStore('sitrep-dedup');if(await s.get(dateKey))return{statusCode:200,body:`Already posted for ${dateKey}`};}catch(e){console.warn('Dedup check failed:',e.message);}

  const ids=['EUCOM','CENTCOM','INDOPACOM','NORTHCOM','SOUTHCOM','AFRICOM'];
  const settled=await Promise.allSettled(ids.map(id=>fetchRSSItems(id,siteUrl)));
  const data={}; ids.forEach((id,i)=>data[id]=settled[i].status==='fulfilled'?settled[i].value:[]);
  const texts={}; ids.forEach(id=>texts[id]=formatItems(data[id]));
  const rawSource=ids.map(id=>`${label(id)}:\n${texts[id]}\nKNOWN BACKGROUND ACTORS: ${COCOM_OCG[id].actors}`).join('\n\n');
  const aorBlock=ids.map(id=>`${label(id)} (${COCOM_OCG[id].aor}): ${COCOM_OCG[id].focus}`).join('\n');
  const sections=ids.map(id=>`${label(id)}:\n${texts[id]}`).join('\n\n');
  const prompt=`You are a transnational organized-crime analyst writing a daily public briefing.\n\nAOR AND FOCUS:\n${aorBlock}\n\nSOURCE ITEMS FROM THE LAST 24 HOURS:\n${sections}\n\nWrite:\n🕵️ TOC SITREP | ${dateStr} UTC\n\nUse one section for each AOR: EUCOM, CENTCOM, PACOM, NORTHCOM, SOUTHCOM, AFRICOM. In each section, lead each bullet with the specific actor/network and one terse factual sentence. Use only items from that AOR. If fewer than 2 real current items exist, use a clearly labeled SPOTLIGHT background block drawing only from the provided known-actor list, with no current operational claims.\n\n⚠️ All reporting derived from open-source media. Unverified. For situational awareness only. | tocmonkey.com\n\n#TOC #OSINT #OrganizedCrime #TOCMonkey\n\nRules: never move Mexico into SOUTHCOM; Mexico is NORTHCOM. Do not invent actors, quantities, outcomes, alliances, or causes. Consolidate duplicates. Max 4 current-event bullets per region. Output only the post.`;

  let draft;
  try{draft=(await generateText({prompt,model:process.env.OPENAI_SOCIAL_MODEL||'gpt-5.6-luna',maxOutputTokens:1050,reasoningEffort:'low',retries:2})).text.trim();}
  catch(e){return{statusCode:500,body:`OpenAI generation failed: ${e.message}`};}
  if(!draft)return{statusCode:500,body:'No content from OpenAI'};
  let finalText=draft;
  try{finalText=(await verifyPost(rawSource,draft))||draft;}catch(e){console.error('OpenAI verification failed — using draft:',e.message);}

  try{const fb=await postToFacebook(finalText);const postId=fb.id||fb.post_id||'unknown';try{await getStore('sitrep-dedup').set(dateKey,postId);}catch(e){console.warn('Dedup write failed:',e.message);}return{statusCode:200,body:JSON.stringify({ok:true,fb_post_id:postId,brief:finalText,provider:'openai'})};}
  catch(e){return{statusCode:500,body:JSON.stringify({ok:false,error:e.message,brief:finalText,provider:'openai'})};}
};
