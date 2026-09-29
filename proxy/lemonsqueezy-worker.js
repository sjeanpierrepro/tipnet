// OPTIONAL. Not needed today: Lemon Squeezy's license API allows direct browser calls (CORS verified).
// Only deploy this if that ever changes. It is a free Cloudflare Worker that forwards
// /activate, /validate and /deactivate to Lemon Squeezy and adds CORS headers.
// It stores nothing and logs nothing. After deploying, paste the worker URL into
// billing-config.js as proxyUrl (for example 'https://tipnet-license.yourname.workers.dev').
const ALLOWED = ['activate', 'validate', 'deactivate'];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const action = new URL(request.url).pathname.split('/').filter(Boolean).pop();
    if (request.method !== 'POST' || !ALLOWED.includes(action)) return new Response('Not found', { status: 404, headers: CORS });
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/' + action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: await request.text(),
    });
    return new Response(await res.text(), { status: res.status, headers: { ...CORS, 'content-type': 'application/json' } });
  },
};
