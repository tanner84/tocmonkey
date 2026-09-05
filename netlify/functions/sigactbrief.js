// SIGACT Brief — scheduled every 4 hours, one COCOM per run.
// OpenAI-backed generation + verification; Facebook publishing unchanged.
const { getStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

const COCOM_ROTATION = [
  { cocom:'EUCOM', full:'U.S. European Command', hours:[0,1,2,3], focus:'Ukraine conflict, Eastern European security, NATO posture, Balkans, Baltic states, European defense industry, Russian military activity', exclude:'Do NOT include items from the Middle East, Africa, or Asia — those belong to other COCOMs.' },
  { cocom:'CENTCOM', full:'U.S. Central Command', hours:[4,5,6,7], focus:'Middle East conflicts, Iraq, Syria, Iran, Yemen, Afghanistan, Central Asia, Red Sea/Arabian Gulf security, Israel-Gaza', exclude:'Do NOT include items from Europe, Sub-Saharan Africa, or Asia-Pacific.' },
  { cocom:'INDOPACOM', full:'U.S. Indo-Pacific Command', hours:[8,9,10,11], focus:'South China Sea, Taiwan Strait, North Korea, Indo-Pacific military activity, Southeast Asia security, Australia/Japan/South Korea alliances', exclude:'Do NOT include items from Europe, Middle East, or Africa.' },
  { cocom:'AFRICOM', full:'U.S. Africa Command', hours:[12,13,14,15], focus:'Sahel instability, Horn of Africa, West Africa coups/terror, East Africa maritime security, sub-Saharan conflicts, Russian activity in Africa', exclude:'Do NOT include items from Europe, Middle East, or Asia.' },
  { cocom:'SOUTHCOM', full:'U.S. Southern Command', hours:[16,17,18,19], focus:'Latin America and Caribbean security, Venezuela, Colombia, Haiti, narcotrafficking, regional instability', exclude:'Do NOT include items from Europe, Middle East, Africa, or Asia. Mexico belongs to NORTHCOM, not SOUTHCOM.' },
  { cocom:'NORTHCOM', full:'U.S. Northern Command', hours:[20,21,22,23], focus:'North American homeland security, U.S.-Canada-Mexico approaches, Arctic sovereignty, NORAD activity, domestic military readiness, cyber threats to U.S. infrastructure', exclude:'Do NOT include items outside North America or the Arctic region.' },
];

function getCocomForHour(hour) { return COCOM_ROTATION.find(c => c.hours.includes(hour)) || COCOM_ROTATION[0]; }
function publicCocom(id) { return id === 'INDOPACOM' ? 'PACOM' : id; }

async function fetchRSSItems(cocom, siteUrl) {
  const res = await fetch(`${siteUrl}/.netlify/functions/rss?cocom=${cocom}`, { signal:AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function postToFacebook(message) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message, access_token:pageToken}), signal:AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function verifyPost(rawSource, generatedPost, cocom, focus, exclude) {
  const prompt = `You are a fact-checking editor for a public military OSINT dashboard.\nReview the following SIGACT post for ${publicCocom(cocom)} and apply these rules strictly.\n\nAOR FOCUS: ${focus}\nGEOGRAPHIC RULE: ${exclude}\n\n1. Remove any bullet outside the AOR.\n2. Every remaining bullet must be traceable to a headline/snippet in SOURCE MATERIAL.\n3. Remove casualty numbers, unit/ship/commander names, locations, causal claims, intent, outcomes, or next steps not explicitly supported by SOURCE MATERIAL.\n4. If fewer than 2 bullets remain, return exactly SKIP.\n5. Return only the corrected post.\n\nSOURCE MATERIAL:\n${rawSource}\n\nPOST TO VERIFY:\n${generatedPost}`;
  const result = await generateText({
    prompt,
    model:process.env.OPENAI_VERIFY_MODEL || 'gpt-5.6-terra',
    maxOutputTokens:550,
    reasoningEffort:'low',
    retries:1,
  });
  return result.text.trim();
}

exports.handler = async function() {
  const { cocom, full, focus, exclude } = getCocomForHour(new Date().getUTCHours());
  const label = publicCocom(cocom);
  const timestamp = new Date().toISOString().replace('T',' ').slice(0,16);
  const dateKey = `sigact-${cocom}-${new Date().toISOString().slice(0,10)}`;
  const siteUrl = (process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');

  try {
    const store = getStore('sitrep-dedup');
    if (await store.get(dateKey)) return { statusCode:200, body:`Already posted for ${dateKey}` };
  } catch(e) { console.warn('Blobs dedup check failed (non-fatal):', e.message); }

  let items;
  try { items = await fetchRSSItems(cocom, siteUrl); }
  catch(e) { return { statusCode:500, body:`RSS fetch failed: ${e.message}` }; }

  const top = items.slice(0,20);
  if (!top.length) return { statusCode:200, body:'No RSS items — skipping post' };
  const itemsText = top.map((it,i) => `${i+1}. [${it.source || 'SOURCE'}] ${it.title}${it.desc ? ' — ' + it.desc.slice(0,120) : ''}`).join('\n');

  const prompt = `You are a military OSINT analyst writing a public SIGACT update for a geopolitical awareness page.\n\nAOR: ${full} (${label})\nFOCUS TOPICS: ${focus}\nSTRICT GEOGRAPHIC RULE: ${exclude}\n\nRAW RSS HEADLINES/SNIPPETS:\n${itemsText}\n\nWrite exactly:\n\n🔴 SIGACT UPDATE | ${label} | ${timestamp} UTC\n\n- [location] — [one factual, terse sentence]\n(3-6 items max)\n\n⚠️ DISCLAIMER: All reporting is derived from open-source media. Not verified by primary sources. For situational awareness only.\n\n#OSINT #${label} #TOCMonkey\n\nRules: only include in-AOR items; no speculation/editorial/invented context; use only source-stated details; return exactly SKIP if there is truly nothing relevant. Output only the post.`;

  let draftText;
  try {
    const generated = await generateText({
      prompt,
      model:process.env.OPENAI_SOCIAL_MODEL || 'gpt-5.6-luna',
      maxOutputTokens:550,
      reasoningEffort:'low',
      retries:2,
    });
    draftText = generated.text.trim();
  } catch (error) {
    console.error(`SIGACT ${label} OpenAI generation failed:`, error.message);
    return { statusCode:500, body:`OpenAI generation failed: ${error.message}` };
  }

  if (!draftText || draftText === 'SKIP') return { statusCode:200, body:`Skipped ${label} — insufficient relevant items` };

  let finalText = draftText;
  try {
    const verified = await verifyPost(itemsText, draftText, cocom, focus, exclude);
    if (verified === 'SKIP') return { statusCode:200, body:`Skipped ${label} — failed verification` };
    if (verified) finalText = verified;
  } catch (error) {
    console.error('OpenAI verification failed — using draft:', error.message);
  }

  try {
    const fbResult = await postToFacebook(finalText);
    const postId = fbResult.id || fbResult.post_id || 'unknown';
    try { await getStore('sitrep-dedup').set(dateKey, postId); } catch(e) { console.warn('Dedup write failed:', e.message); }
    return { statusCode:200, body:JSON.stringify({ok:true,cocom:label,fb_post_id:postId,brief:finalText,provider:'openai'}) };
  } catch (error) {
    return { statusCode:500, body:JSON.stringify({ok:false,cocom:label,error:error.message,brief:finalText,provider:'openai'}) };
  }
};
