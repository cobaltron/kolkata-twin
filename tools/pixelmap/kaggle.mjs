/**
 * Runs stage 3 on Kaggle's free GPUs: uploads the block render as a private dataset, pushes
 * kaggle_paint.py as a private GPU script, waits for it and downloads the painted map.
 * Run: node tools/pixelmap/kaggle.mjs pilot [--no-upload]
 * Auth: KAGGLE_API_TOKEN (a "KGAT_..." token) as a bearer header, or none where a network proxy adds it.
 * Out: data/pixelmap/<name>/generated.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const name = process.argv[2] ?? 'pilot';
const dir = path.join(ROOT, 'data', 'pixelmap', name);
const API = 'https://www.kaggle.com/api/v1';
const auth = process.env.KAGGLE_API_TOKEN ? { Authorization: `Bearer ${process.env.KAGGLE_API_TOKEN}` } : {};

async function api(method, route, body) {
  const res = await fetch(API + route, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const user = (await api('GET', '/hello')).userName;
const dataset = `kolkata-pixelmap-${name}-render`, kernel = `kolkata-pixelmap-${name}-paint`;

// 1. Upload render.png as a private dataset (new dataset, or a new version of it).
// Pass --no-upload to reuse the render already on Kaggle (e.g. after changing only the paint script).
if (!process.argv.includes('--no-upload')) {
  const file = path.join(dir, 'render.png');
  const bytes = fs.readFileSync(file);
  const blob = await api('POST', '/blobs/upload', { type: 'DATASET', name: 'render.png', contentLength: bytes.length, lastModifiedEpochSeconds: Math.floor(fs.statSync(file).mtimeMs / 1000) });
  const put = await fetch(blob.createUrl, { method: 'PUT', body: bytes });
  if (!put.ok) throw new Error(`upload: HTTP ${put.status}`);
  const files = [{ token: blob.token }];
  let exists = true;
  try { await api('GET', `/datasets/view/${user}/${dataset}`); } catch { exists = false; }
  const made = exists
    ? await api('POST', `/datasets/create/version/${user}/${dataset}`, { versionNotes: 'new render', files })
    : await api('POST', '/datasets/create/new', { title: dataset, slug: dataset, ownerSlug: user, licenseName: 'unknown', isPrivate: true, files });
  if (made.error) throw new Error(`dataset: ${made.error}`);
  console.log(`dataset ${dataset}: ${exists ? 'new version' : 'created'} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  // Kaggle processes an upload for a short while before a script can mount it.
  for (let i = 0; i < 40; i++) {
    const status = await api('GET', `/datasets/status/${user}/${dataset}`).catch(() => ({}));
    if (JSON.stringify(status).includes('ready')) break;
    await sleep(10000);
  }
}

// 2. Push the paint script and wait for it.
const pushed = await api('POST', '/kernels/push', {
  slug: `${user}/${kernel}`, newTitle: kernel, text: fs.readFileSync(path.join(ROOT, 'tools', 'pixelmap', 'kaggle_paint.py'), 'utf8'),
  language: 'python', kernelType: 'script', isPrivate: true, enableGpu: true, enableInternet: true,
  datasetDataSources: [`${user}/${dataset}`], competitionDataSources: [], kernelDataSources: [], categoryIds: [],
});
if (pushed.error) throw new Error(`push: ${pushed.error}`);
console.log(`script ${kernel}: version ${pushed.versionNumber} running`);
let status = '';
for (;;) {
  await sleep(30000);
  status = (await api('GET', `/kernels/status?userName=${user}&kernelSlug=${kernel}`).catch(() => ({}))).status ?? status;
  if (['complete', 'error', 'cancelAcknowledged'].includes(status)) break;
}

// 3. Print the progress lines and download the result.
const out = await api('GET', `/kernels/output?userName=${user}&kernelSlug=${kernel}`);
let lines = [];
try { lines = JSON.parse(out.log).map((e) => (e.data ?? '').trimEnd()); } catch { lines = String(out.log ?? '').split('\n'); }
console.log(lines.filter((l) => /render \(|phase \d|done:|Error|Traceback|File "\/kaggle/.test(l)).slice(-25).join('\n'));
for (const f of out.files ?? []) {
  if (!/generated\.(png|jpg)$/.test(f.fileName)) continue;
  const res = await fetch(f.url);
  fs.writeFileSync(path.join(dir, path.basename(f.fileName)), Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${path.basename(f.fileName)}`);
}
console.log(`kaggle status: ${status}`);
if (status !== 'complete') process.exit(1);
