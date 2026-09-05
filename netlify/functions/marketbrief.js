// Market Brief — OpenAI-backed scheduled market summary.
// marketbrief-open.js / marketbrief-close.js call this handler on the existing schedule.
const { generateText } = require('./_openai');

function fmt(price,pct){const sign=Number(pct)>=0?'+':'';return `$${Number(price).toFixed(2)} (${sign}${Number(pct).toFixed(2)}%)`;}
function extractJson(text=''){const match=String(text).match(/\{[\s\S]*\}/);if(!match)throw new Error(`No JSON in OpenAI response: ${String(text).slice(0,140)}`);return JSON.parse(match[0]);}

async function postToFacebook(message){
  const pageId=process.env.FACEBOOK_PAGE_ID;
  const token=process.env.FACEBOOK_PAGE_ACCESS_TOKEN||process.env.FACEBOOK_ACCESS_TOKEN;
  if(!pageId||!token)throw new Error('Facebook env vars not set');
  const res=await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,access_token:token}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchPrices(){
  const prompt=`Use web search to find the most recent available market price and daily percent change for these instruments: WTI crude oil, Brent crude oil, U.S. natural gas, AAPL, MSFT, NVDA, GOOGL, PFE, JNJ, MRK. Prefer current-session or most recent official/major-market reporting. Return ONLY raw JSON with no markdown or commentary using keys WTI, BRENT, NAT_GAS, AAPL, MSFT, NVDA, GOOGL, PFE, JNJ, MRK and values {"price":number,"change":number,"asOf":"short source/time note"}. Omit any key you cannot verify. Do not estimate or reuse stale example values.`;
  const result=await generateText({prompt,model:process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6-terra',maxOutputTokens:900,reasoningEffort:'low',timeoutMs:45000,retries:1,tools:[{type:'web_search'}]});
  return extractJson(result.text);
}

exports.handler=async function(){
  const utcHour=new Date().getUTCHours();
  const bell=(utcHour>=13&&utcHour<=15)?'OPEN':'CLOSE';
  const dateStr=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'}).toUpperCase();

  let prices;
  try{prices=await fetchPrices();}catch(e){return{statusCode:500,body:`OpenAI market research failed: ${e.message}`};}
  const validated=Object.fromEntries(Object.entries(prices||{}).filter(([_,v])=>Number.isFinite(Number(v?.price))&&Number(v.price)>0&&Number.isFinite(Number(v?.change))));
  if(Object.keys(validated).length<3)return{statusCode:500,body:'Insufficient verified market price data'};

  const lines=[];
  if(validated.WTI)lines.push(`WTI: ${fmt(validated.WTI.price,validated.WTI.change)}`);
  if(validated.BRENT)lines.push(`Brent: ${fmt(validated.BRENT.price,validated.BRENT.change)}`);
  if(validated.NAT_GAS)lines.push(`Natural gas: ${fmt(validated.NAT_GAS.price,validated.NAT_GAS.change)}`);
  const stockSymbols=['AAPL','MSFT','NVDA','GOOGL','PFE','JNJ','MRK'];
  const stocks=stockSymbols.filter(s=>validated[s]).map(s=>({symbol:s,...validated[s]}));
  const notable=[...stocks].sort((a,b)=>Math.abs(Number(b.change))-Math.abs(Number(a.change))).slice(0,4).map(s=>`${s.symbol} ${Number(s.change)>=0?'+':''}${Number(s.change).toFixed(2)}%`).join(' · ');
  const sourceNotes=Object.entries(validated).map(([k,v])=>`${k}: ${v.asOf||'current web result'}`).join('\n');

  const prompt=`You are a market-intelligence writer for TOC Monkey. Write the ${bell==='OPEN'?'open':'close'} bell summary for ${dateStr}.\n\nVERIFIED PRICE DATA:\n${lines.join('\n')}\nStocks: ${stocks.map(s=>`${s.symbol} ${fmt(s.price,s.change)}`).join(' | ')||'unavailable'}\n\nSOURCE/TIMING NOTES:\n${sourceNotes}\n\nWrite exactly:\n📊 ${bell} BELL | ${dateStr}\n\n[2-3 terse sentences. Lead with the highest-confidence operationally significant signal. Explain a geopolitical driver only when supported by current reporting; otherwise describe the move without inventing a cause. For equities, prefer a discrete company catalyst if supported. Use exact percentages from the verified data.]\n\nNotable moves: ${notable||'n/a'}\n\n#Markets #Commodities #TOCMonkey\n\nNot investment advice.\n\nRules: do not estimate unavailable figures; do not invent causal links; hedge ambiguous context. Output only the post.`;

  let briefText;
  try{briefText=(await generateText({prompt,model:process.env.OPENAI_SOCIAL_MODEL||'gpt-5.6-luna',maxOutputTokens:450,reasoningEffort:'low',retries:2})).text.trim();}
  catch(e){return{statusCode:500,body:`OpenAI brief generation failed: ${e.message}`};}

  try{const fb=await postToFacebook(briefText);return{statusCode:200,body:JSON.stringify({ok:true,fb_post_id:fb.id,bell,brief:briefText,provider:'openai'})};}
  catch(e){return{statusCode:500,body:JSON.stringify({ok:false,error:e.message,brief:briefText,provider:'openai'})};}
};
