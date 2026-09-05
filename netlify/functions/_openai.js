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
  tools = null,
  include = null,
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
      const payload = {
        model,
        input: prompt,
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: reasoningEffort },
        store: false,
      };
      if (Array.isArray(tools) && tools.length) payload.tools = tools;
      if (Array.isArray(include) && include.length) payload.include = include;

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json();
          detail = body?.error?.message || body?.message || '';
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
        raw: data,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
    }
  }
  throw lastError || new Error('OpenAI request failed');
}

module.exports = { generateText, DEFAULT_MODEL };
