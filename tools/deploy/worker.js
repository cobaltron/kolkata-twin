// Serves the built app from an R2 bucket. Deployed as a Pages project's _worker.js by tools/deploy/cloudflare.mjs.
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml',
  bin: 'application/octet-stream', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8', wasm: 'application/wasm',
};

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);
    let key = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (key === '' || key.endsWith('/')) key += 'index.html';
    const object = await env.SITE.get(key, { onlyIf: request.headers, range: request.headers });
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    headers.set('content-type', TYPES[key.split('.').pop().toLowerCase()] ?? 'application/octet-stream');
    headers.set('etag', object.httpEtag);
    // Hashed bundles and versioned map tiles never change; everything else is revalidated.
    headers.set('cache-control', key.startsWith('assets/') || key.includes('/tiles/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    if (!('body' in object)) return new Response(null, { status: 304, headers }); // precondition matched
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  },
};
