// Shared OpenAI Responses API helper for TOC Monkey backend jobs.
// Requires OPENAI_API_KEY in Netlify environment variables.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function generateText({
  prompt,
  model = DEFAULT_MODEL,
  maxOutputTokens = 900,
  reasoningEffort = 'low',
  timeoutMs = 30000,
  retries = 2,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY not configured');
    err.code = 'OPENAI_NOT_CONFIGURED';
    throw err;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt) await new Promise(r => setTimeout(r, attempt * 1200));
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: prompt,
          max_output_tokens: maxOutputTokens,
          reasoning: { effort: reasoningEffort },
          store: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const payload = await response.json();
          detail = payload?.error?.message || payload?.message || '';
        } catch (_) {}
        const err = new Error(`OpenAI API ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
        err.status = response.status;
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          lastError = err;
          continue;
        }
        throw err;
      }

      const data = await response.json();
      const text = extractOutputText(data);
      if (!text) throw new Error('OpenAI returned no output text');
      return {
        text,
        model: data.model || model,
        responseId: data.id || null,
        usage: data.usage || null,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
    }
  }
  throw lastError || new Error('OpenAI request failed');
}

module.exports = { generateText, DEFAULT_MODEL };
