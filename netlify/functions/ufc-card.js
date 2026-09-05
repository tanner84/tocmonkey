// UFC Results — OpenAI web-search backed Facebook sports card.
const { getStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

function extractJson(text='') {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in OpenAI response: ${String(text).slice(0,120)}`);
  return JSON.parse(match[0]);
}

async function fetchResults() {
  const prompt = `Use web search to find the most recent completed UFC or UFC Fight Night event from last night or this week. Return ONLY raw JSON, no markdown or commentary, using exactly this shape:\n{"event":"UFC 000: NAME","date":"Mon DD YYYY","fights":[{"fighter1":"NAME","fighter2":"NAME","winner":"NAME","method":"KO/TKO","round":1,"time":"1:23","mainCard":true}]}\nInclude completed main-card fights only. Verify winner/method/round/time from reliable current sources. If no recent completed event exists, return {"event":"","date":"","fights":[]}.`;
  const result = await generateText({
    prompt,
    model:process.env.OPENAI_RESEARCH_MODEL || 'gpt-5.6-terra',
    maxOutputTokens:850,
    reasoningEffort:'low',
    timeoutMs:40000,
    retries:1,
    tools:[{type:'web_search'}],
  });
  return extractJson(result.text);
}

async function postToFacebook(message) {
  const pageId=process.env.FACEBOOK_PAGE_ID;
  const pageToken=process.env.FACEBOOK_PAGE_ACCESS_TOKEN||process.env.FACEBOOK_ACCESS_TOKEN;
  if(!pageId||!pageToken)throw new Error('Facebook env vars not set');
  const res=await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://tocmonkey.com/logo.png',message,access_token:pageToken}),signal:AbortSignal.timeout(15000)
  });
  if(!res.ok)throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return res.json();
}

exports.handler=async()=>{
  const now=new Date(),dateKey=`ufc-${now.toISOString().slice(0,10)}`;
  try{const store=getStore('sports-card-dedup');if(await store.get(dateKey))return{statusCode:200,body:'Already posted'};}catch(e){console.warn('dedup check failed:',e.message);}

  let data;
  try{data=await fetchResults();}catch(e){return{statusCode:500,body:`OpenAI research failed: ${e.message}`};}
  if(!data.event||!Array.isArray(data.fights)||!data.fights.length)return{statusCode:200,body:'No event'};

  const lines=data.fights.filter(f=>f.mainCard!==false).map(f=>{
    const loser=f.winner===f.fighter1?f.fighter2:f.fighter1;
    const method=[f.method,f.round?`R${f.round}`:'',f.time].filter(Boolean).join(' ');
    return `🥊 ${f.winner} def. ${loser} — ${method}`;
  });
  const message=`🥋 [UFC] RESULTS | ${data.event} | ${data.date}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#UFC #MMA #TOCMonkey`;
  try{const result=await postToFacebook(message);try{await getStore('sports-card-dedup').set(dateKey,result.id);}catch(_){}return{statusCode:200,body:JSON.stringify({ok:true,id:result.id,provider:'openai'})};}
  catch(e){return{statusCode:500,body:`Post failed: ${e.message}`};}
};
