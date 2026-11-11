/**
 * Deploy the built app (dist/) to Cloudflare: files into an R2 bucket, served by a Worker.
 * Run: npm run build && node tools/deploy/cloudflare.mjs
 * Auth: CLOUDFLARE_API_TOKEN (Workers Scripts: Edit, Workers R2 Storage: Edit), or none where a network
 *       proxy adds the header. CLOUDFLARE_ACCOUNT_ID is optional when the token sees one account.
 *
 * Cloudflare Pages is the simpler home for a static site, but its upload step authenticates with a
 * short-lived token of its own, which does not pass through a proxy that rewrites the auth header.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DIST = path.join(ROOT, 'dist');
const BUCKET = process.env.SITE_BUCKET ?? 'kolkata-twin-site';
const WORKER = process.env.SITE_WORKER ?? 'kolkata-twin';
const auth = process.env.CLOUDFLARE_API_TOKEN ? { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } : {};
const API = 'https://api.cloudflare.com/client/v4';

async function call(method, route, body, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API + route, { method, headers: { ...auth, ...headers }, body });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`); }
      if (!json.success) {
        const error = new Error(`${method} ${route}: ${json.errors?.map((e) => e.message).join('; ')}`);
        error.fatal = res.status < 500;
        throw error;
      }
      return json.result;
    } catch (err) {
      if (err.fatal || attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 700 * attempt)); // gateways drop the odd upload
    }
  }
}

const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? (await call('GET', '/accounts?per_page=5'))[0].id;
const base = `/accounts/${account}`;

// 1. Bucket
const buckets = (await call('GET', `${base}/r2/buckets`)).buckets.map((b) => b.name);
if (!buckets.includes(BUCKET)) await call('POST', `${base}/r2/buckets`, JSON.stringify({ name: BUCKET }), { 'Content-Type': 'application/json' });

// 2. Files, a few at a time
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(DIST);
let done = 0, bytes = 0;
const queue = [...files];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const key = path.relative(DIST, file).split(path.sep).map(encodeURIComponent).join('/');
    const data = fs.readFileSync(file);
    await call('PUT', `${base}/r2/buckets/${BUCKET}/objects/${key}`, data, { 'Content-Type': 'application/octet-stream' });
    bytes += data.length;
    if (++done % 40 === 0) console.log(`  ${done}/${files.length} files`);
  }
}));
console.log(`uploaded ${done} files, ${(bytes / 1e6).toFixed(1)} MB, to R2 bucket ${BUCKET}`);

// 3. Worker bound to the bucket, on the account's workers.dev subdomain
const form = new FormData();
form.set('metadata', JSON.stringify({ main_module: 'worker.js', compatibility_date: '2026-01-01', bindings: [{ type: 'r2_bucket', name: 'SITE', bucket_name: BUCKET }] }));
form.set('worker.js', new Blob([fs.readFileSync(path.join(ROOT, 'tools', 'deploy', 'worker.js'))], { type: 'application/javascript+module' }), 'worker.js');
await call('PUT', `${base}/workers/scripts/${WORKER}`, form);
await call('POST', `${base}/workers/scripts/${WORKER}/subdomain`, JSON.stringify({ enabled: true, previews_enabled: false }), { 'Content-Type': 'application/json' });
const { subdomain } = await call('GET', `${base}/workers/subdomain`);
console.log(`deployed: https://${WORKER}.${subdomain}.workers.dev/`);
