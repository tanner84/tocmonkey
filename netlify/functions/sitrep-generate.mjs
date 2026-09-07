// Dispatch within the scheduler's 30-second limit. Generation runs in a
// protected background function, where RSS collection and retries can finish.
export default async () => {
  const password = Netlify.env.get('ADMIN_PASSWORD');
  if (!password) throw new Error('SITREP dispatch is not configured');
  const origin = Netlify.env.get('URL') || 'https://tocmonkey.com';
  const response = await fetch(new URL('/.netlify/functions/sitrep-generate-background', origin), {
    method:'POST', headers:{ 'x-admin-password':password },
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`SITREP dispatch HTTP ${response.status}`);
  console.log('SITREP background generation dispatched');
};
