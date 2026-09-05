// OCG Brief — scheduled organized-crime update via OpenAI web search.
const { getStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

const OCG_COCOM = {
  2:{cocom:'EUCOM',full:'U.S. European Command',aor:'Europe and Eurasia',regions:'Balkans, Eastern Europe, Caucasus, Western Europe'},
  6:{cocom:'CENTCOM',full:'U.S. Central Command',aor:'Middle East and Central Asia',regions:'Afghanistan, Iran, Iraq, Syria, Central Asia, Arabian Peninsula'},
  10:{cocom:'INDOPACOM',full:'U.S. Indo-Pacific Command',aor:'Indo-Pacific',regions:'Southeast Asia, South Asia, East Asia, Pacific Islands'},
  15:{cocom:'AFRICOM',full:'U.S. Africa Command',aor:'Africa',regions:'Sahel, Horn of Africa, West Africa, Central Africa, East Africa'},
  19:{cocom:'SOUTHCOM',full:'U.S. Southern Command',aor:'Latin America and Caribbean excluding Mexico',regions:'Central America south of Mexico, Colombia, Venezuela, Caribbean, Brazil, Andean region',sources:['https://insightcrime.org','https://www.reuters.com/world/americas/','https://apnews.com/hub/latin-america','https://igarape.org.br','https://www.connectas.org']},
  23:{cocom:'NORTHCOM',full:'U.S. Northern Command',aor:'North America',regions:'United States, Canada, Mexico, Arctic'},
};

function getCocom(hour){return OCG_COCOM[hour]||OCG_COCOM[2];}
function label(id){return id==='INDOPACOM'?'PACOM':id;}

function parseResearch(text){
  const post=(text.match(/POST_BEGIN\s*([\s\S]*?)\s*POST_END/i)||[])[1]?.trim();
  const sources=(text.match(/SOURCES_BEGIN\s*([\s\S]*?)\s*SOURCES_END/i)||[])[1]?.trim();
  return {draft:post||text.trim(),sources:sources||text.trim()};
}

async function fetchOCGSigacts(info,timestamp){
  const sourceBlock=info.sources?.length?`\nPriority domains when relevant: ${info.sources.join(', ')}\n`:'';
  const prompt=`Use web search to find current organized-crime/TCO activity from the past 24-48 hours in ${info.full} (${label(info.cocom)}), AOR: ${info.aor}. Focus on ${info.regions}.${sourceBlock}\nLook for drug trafficking/seizures, human smuggling, cartel/gang activity, money laundering/sanctions evasion, cybercrime, arms trafficking, corruption-linked arrests, and government crackdowns.\n\nGeographic rule: Mexico belongs to NORTHCOM, never SOUTHCOM.\n\nReturn exactly two marked blocks.\nPOST_BEGIN\n🟠 ORGANIZED CRIME SITREP | ${label(info.cocom)} | ${timestamp} UTC\n\n- [Country/Region] — [one factual terse sentence]\n(3-6 current items max)\n\n⚠️ DISCLAIMER: All reporting is derived from open-source media. Not verified by primary sources. For situational awareness only.\n\n#OSINT #OrganizedCrime #TransnationalCrime #${label(info.cocom)} #TOCMonkey\nPOST_END\nSOURCES_BEGIN\nFor every bullet used, include one line: SOURCE | publication/date if known | headline | exact supporting fact | URL.\nSOURCES_END\n\nRules: no speculation/editorial; no unsupported numbers or group attribution; if fewer than 2 credible current items exist, put exactly SKIP between POST_BEGIN/POST_END. Output nothing outside the marked blocks.`;
  const result=await generateText({prompt,model:process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6-terra',maxOutputTokens:1100,reasoningEffort:'medium',timeoutMs:45000,retries:1,tools:[{type:'web_search'}]});
  return parseResearch(result.text);
}

async function verifyPost(sources,draft,info){
  const prompt=`Fact-check this public organized-crime SITREP using only SOURCE NOTES below.\nAOR: ${info.full} (${label(info.cocom)}) — ${info.aor}; focus: ${info.regions}. Mexico belongs to NORTHCOM, never SOUTHCOM.\n\nKeep only actual reported criminal activity. Remove unsupported quantities, casualties, group attributions, causal claims, intent, alliances, or future operations. Every bullet must be supported by SOURCE NOTES and within the AOR. If fewer than 2 bullets survive, return exactly SKIP. Return only the corrected post.\n\nSOURCE NOTES:\n${sources}\n\nPOST:\n${draft}`;
  return (await generateText({prompt,model:process.env.OPENAI_VERIFY_MODEL||'gpt-5.6-terra',maxOutputTokens:650,reasoningEffort:'low',retries:1})).text.trim();
}

async function postToFacebook(message){const pageId=process.env.FACEBOOK_PAGE_ID;const token=process.env.FACEBOOK_PAGE_ACCESS_TOKEN||process.env.FACEBOOK_ACCESS_TOKEN;if(!pageId||!token)throw new Error('Facebook env vars not set');const r=await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,access_token:token}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Facebook API ${r.status}: ${await r.text()}`);return r.json();}

exports.handler=async function(){
  const info=getCocom(new Date().getUTCHours()),timestamp=new Date().toISOString().replace('T',' ').slice(0,16),dateKey=`ocg-${info.cocom}-${new Date().toISOString().slice(0,10)}`;
  try{const s=getStore('sitrep-dedup');if(await s.get(dateKey))return{statusCode:200,body:`Already posted for ${dateKey}`};}catch(e){console.warn('Dedup check failed:',e.message);}
  let draft,sources;
  try{({draft,sources}=await fetchOCGSigacts(info,timestamp));}catch(e){return{statusCode:500,body:`OpenAI research failed: ${e.message}`};}
  if(!draft||draft==='SKIP')return{statusCode:200,body:`Skipped ${label(info.cocom)} — no relevant OCG activity`};
  let finalText=draft;
  try{const verified=await verifyPost(sources,draft,info);if(verified==='SKIP')return{statusCode:200,body:`Skipped ${label(info.cocom)} — failed verification`};if(verified)finalText=verified;}catch(e){console.error('Verification failed — using draft:',e.message);}
  try{const fb=await postToFacebook(finalText),postId=fb.id||fb.post_id||'unknown';try{await getStore('sitrep-dedup').set(dateKey,postId);}catch(e){console.warn('Dedup write failed:',e.message);}return{statusCode:200,body:JSON.stringify({ok:true,cocom:label(info.cocom),fb_post_id:postId,provider:'openai'})};}
  catch(e){return{statusCode:500,body:JSON.stringify({ok:false,cocom:label(info.cocom),error:e.message,brief:finalText,provider:'openai'})};}
};
