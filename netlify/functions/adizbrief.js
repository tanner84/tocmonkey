// ADIZ Brief — daily two-stage OpenAI pipeline.
// Stage 1: web research + structured snapshot. Stage 2: social formatting only.
const { getStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

async function postToFacebook(message){
  const pageId=process.env.FACEBOOK_PAGE_ID;
  const token=process.env.FACEBOOK_PAGE_ACCESS_TOKEN||process.env.FACEBOOK_ACCESS_TOKEN;
  if(!pageId||!token)throw new Error('Facebook env vars not set');
  const res=await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,access_token:token}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchADIZSnapshot(timestamp,dateStr){
  const prompt=`Use web search to identify ADIZ intercepts, sovereign airspace violations, close approaches, unusual military flight patterns, and airspace closures from the past 24 hours across NORTHCOM, EUCOM, PACOM, CENTCOM, SOUTHCOM, and AFRICOM. Prefer named government/military sources and major reputable reporting.\n\nCLASSIFICATION RULES:\n- SOVEREIGN VIOLATION: confirmed unannounced entry into sovereign national airspace.\n- ADIZ INTERCEPT: aircraft entered an ADIZ without filing and was intercepted/escorted.\n- CLOSE APPROACH: approached an ADIZ boundary without entering.\n- UNUSUAL PATTERN: atypical ISR/bomber routing or other unusual behavior.\n- AIRSPACE CLOSURE: sovereign/administrative closure affecting civil or military traffic.\n\nCONFIDENCE:\n- CONFIRMED: named government/military source.\n- CORROBORATED: multiple independent reliable sources.\n- SINGLE SOURCE: one credible report, no official confirmation.\n- UNVERIFIED: reported but not independently supported.\n\nDo not infer actor or aircraft type. Omit unconfirmed specifics. Distinguish description from assessment. Sparse data must produce sparse output. CENTCOM may be active-conflict airspace management rather than normal ADIZ behavior. Use PACOM publicly, not INDOPACOM.\n\nReturn exactly:\nADIZ SNAPSHOT | ${dateStr} ${timestamp} UTC\n[CLASSIFICATION: UNCLASSIFIED // OSINT]\n\nFor each active region:\n[REGION]\nEVENT: [factual description] [CONFIDENCE]\nRESPONSE: [intercept/escort/platform if confirmed, otherwise No intercept response confirmed]\nASSESSMENT: [pattern context, clearly separated from inference]\nSOURCE: [source name | headline/date | URL]\n\nFor inactive regions: [REGION]: No activity above baseline threshold.\n\nAll reporting derived from open-source media and publicly available data. Unverified. For situational awareness only. | tocmonkey.com`;
  return (await generateText({prompt,model:process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6-terra',maxOutputTokens:1600,reasoningEffort:'medium',timeoutMs:50000,retries:1,tools:[{type:'web_search'}]})).text.trim();
}

async function formatFacebookPost(snapshot,dateStr){
  const prompt=`You are a social formatter for TOC Monkey. Do not re-analyze or add facts. Compress the supplied ADIZ Snapshot into a Facebook post.\n\nVOICE: direct, informational, non-dramatic. Preserve confidence and hedging.\nPRIORITY: sovereign violation > confirmed above-baseline event > pattern event > corroborated above-baseline event. If nothing is above baseline, say so. Do not build urgency around single-source/unverified events.\n\nFORMAT:\nADIZ SNAPSHOT | ${dateStr} UTC\n\n[3-5 sentences maximum, no bullets. Lead with highest-signal event/pattern. Carry through reportedly/per open-source reporting where appropriate.]\n\nNot verified. For situational awareness only.\n\n#TOCMonkey #ADIZ #[relevant theater tags]\n\nNever assert actor intent, upgrade event types, or add details not present in the snapshot.\n\nSNAPSHOT:\n${snapshot}`;
  return (await generateText({prompt,model:process.env.OPENAI_SOCIAL_MODEL||'gpt-5.6-luna',maxOutputTokens:650,reasoningEffort:'low',retries:2})).text.trim();
}

exports.handler=async function(){
  const now=new Date(),dateStr=now.toISOString().slice(0,10),timestamp=now.toISOString().replace('T',' ').slice(0,16),dateKey=`adiz-${dateStr}`;
  try{const s=getStore('sitrep-dedup');if(await s.get(dateKey))return{statusCode:200,body:`Already posted for ${dateKey}`};}catch(e){console.warn('Dedup check failed:',e.message);}

  let snapshot;
  try{snapshot=await fetchADIZSnapshot(timestamp,dateStr);}catch(e){return{statusCode:500,body:`OpenAI ADIZ research failed: ${e.message}`};}
  let fbPost;
  try{fbPost=await formatFacebookPost(snapshot,dateStr);}catch(e){return{statusCode:500,body:`OpenAI ADIZ formatting failed: ${e.message}`};}
  if(!fbPost)return{statusCode:200,body:'Formatter returned empty — skipping'};

  try{const fb=await postToFacebook(fbPost),postId=fb.id||fb.post_id||'unknown';try{await getStore('sitrep-dedup').set(dateKey,postId);}catch(e){console.warn('Dedup write failed:',e.message);}return{statusCode:200,body:JSON.stringify({ok:true,fb_post_id:postId,snapshot,post:fbPost,provider:'openai'})};}
  catch(e){return{statusCode:500,body:JSON.stringify({ok:false,error:e.message,snapshot,post:fbPost,provider:'openai'})};}
};
