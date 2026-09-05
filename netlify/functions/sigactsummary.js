// 24-Hour SIGACT Summary — OpenAI-backed scheduled function.
const { getStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

const COCOM_AOR = {
  EUCOM:'Europe and Eurasia — Ukraine conflict, NATO posture, Balkans, Baltic states, Russian military activity, European defense industry. NOT Middle East, Africa, or Asia.',
  CENTCOM:'Middle East and Central Asia — Iraq, Syria, Iran, Yemen, Afghanistan, Red Sea/Arabian Gulf, Israel-Gaza. NOT Europe, Sub-Saharan Africa, or Asia-Pacific.',
  INDOPACOM:'Indo-Pacific — South China Sea, Taiwan Strait, North Korea, Southeast Asia, Australia/Japan/South Korea alliances. NOT Europe, Middle East, or Africa.',
};

async function fetchRSSItems(cocom, siteUrl) {
  const res = await fetch(`${siteUrl}/.netlify/functions/rss?cocom=${cocom}`, { signal:AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RSS ${cocom} failed: ${res.status}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function postToFacebook(message) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message,access_token:pageToken}), signal:AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return res.json();
}

function formatItems(items, max=20) {
  return items.slice(0,max).map((it,i) => `${i+1}. [${it.source || 'SOURCE'}] ${it.title}${it.desc ? ' — ' + it.desc.slice(0,120) : ''}`).join('\n');
}

async function verifyPost(rawSource, generatedPost) {
  const prompt = `You are a fact-checking editor for a public military OSINT dashboard.\nReview the following 24-hour SIGACT summary and enforce these AOR rules:\n- EUCOM: ${COCOM_AOR.EUCOM}\n- CENTCOM: ${COCOM_AOR.CENTCOM}\n- PACOM: ${COCOM_AOR.INDOPACOM}\n\nRemove any bullet outside its AOR, any bullet not traceable to SOURCE MATERIAL, and any unsupported casualty numbers, unit/ship/commander names, causal claims, speculation, intent, outcomes, or next steps. If a section has fewer than 2 verified bullets, omit the entire section. Return only the corrected post.\n\nSOURCE MATERIAL:\n${rawSource}\n\nPOST TO VERIFY:\n${generatedPost}`;
  const result = await generateText({ prompt, model:process.env.OPENAI_VERIFY_MODEL || 'gpt-5.6-terra', maxOutputTokens:850, reasoningEffort:'low', retries:1 });
  return result.text.trim();
}

exports.handler = async function() {
  const siteUrl = (process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');
  const dateStr = new Date().toISOString().slice(0,10);
  const dateKey = `sigactsummary-${dateStr}`;

  try {
    const store = getStore('sitrep-dedup');
    if (await store.get(dateKey)) return { statusCode:200, body:`Already posted for ${dateKey}` };
  } catch(e) { console.warn('Blobs dedup check failed:', e.message); }

  const [eucomRes,centcomRes,indopacomRes] = await Promise.allSettled([
    fetchRSSItems('EUCOM',siteUrl), fetchRSSItems('CENTCOM',siteUrl), fetchRSSItems('INDOPACOM',siteUrl)
  ]);
  const eucom = eucomRes.status === 'fulfilled' ? eucomRes.value : [];
  const centcom = centcomRes.status === 'fulfilled' ? centcomRes.value : [];
  const indopacom = indopacomRes.status === 'fulfilled' ? indopacomRes.value : [];
  if (!eucom.length && !centcom.length && !indopacom.length) return { statusCode:200, body:'No RSS items for any COCOM — skipping' };

  const eucomText = formatItems(eucom), centcomText = formatItems(centcom), indopacomText = formatItems(indopacom);
  const rawSource = `EUCOM:\n${eucomText}\n\nCENTCOM:\n${centcomText}\n\nPACOM:\n${indopacomText}`;
  const prompt = `You are a military OSINT analyst writing a 24-hour SIGACT summary for a public geopolitical awareness page.\n\nAOR RULES:\n- EUCOM: ${COCOM_AOR.EUCOM}\n- CENTCOM: ${COCOM_AOR.CENTCOM}\n- PACOM: ${COCOM_AOR.INDOPACOM}\n\nSOURCE MATERIAL:\n${rawSource}\n\nWrite exactly:\n🌐 24-HR SIGACT SUMMARY | ${dateStr} UTC\n\n🔵 EUCOM\n- [location] — [factual, terse sentence]\n\n🟡 CENTCOM\n- [location] — [factual, terse sentence]\n\n🔴 PACOM\n- [location] — [factual, terse sentence]\n\n⚠️ All reporting derived from open-source media. Unverified. For situational awareness only. | tocmonkey.com\n\n#OSINT #EUCOM #CENTCOM #PACOM #TOCMonkey\n\nRules: each section uses only its own source list; minimum 3 real bullets or omit that section; locations first; no speculation/editorial/adjectives; do not add unsupported context; consolidate duplicates; max 5 bullets per section. Output only the post.`;

  let draftText;
  try {
    const result = await generateText({ prompt, model:process.env.OPENAI_SOCIAL_MODEL || 'gpt-5.6-luna', maxOutputTokens:850, reasoningEffort:'low', retries:2 });
    draftText = result.text.trim();
  } catch (error) {
    return { statusCode:500, body:`OpenAI generation failed: ${error.message}` };
  }
  if (!draftText) return { statusCode:500, body:'No content from OpenAI' };

  let finalText = draftText;
  try { finalText = (await verifyPost(rawSource,draftText)) || draftText; }
  catch(e) { console.error('OpenAI verification failed — using draft:', e.message); }

  try {
    const fb = await postToFacebook(finalText);
    const postId = fb.id || fb.post_id || 'unknown';
    try { await getStore('sitrep-dedup').set(dateKey,postId); } catch(e) { console.warn('Dedup write failed:', e.message); }
    return { statusCode:200, body:JSON.stringify({ok:true,fb_post_id:postId,brief:finalText,provider:'openai'}) };
  } catch(error) {
    return { statusCode:500, body:JSON.stringify({ok:false,error:error.message,brief:finalText,provider:'openai'}) };
  }
};
