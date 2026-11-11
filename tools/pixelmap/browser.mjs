// Shared by the pixelmap render drivers: a headless Chromium page served by Vite, with Google tile
// requests relayed through Node.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    // Cloud containers ship Playwright outside the project; PLAYWRIGHT_DIR points at that install.
    const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? '/opt/node-tools/node_modules', 'x.js'));
    return require('playwright').chromium;
  }
}

/**
 * Google tile requests are made by Node, not the page. Where the API key is attached by a network
 * proxy as a header (GOOGLE_MAPS_API_KEY unset), the page's placeholder key parameter is removed;
 * where the variable is set (your own machine), it is used as the key.
 */
async function relayGoogle(route) {
  const url = new URL(route.request().url());
  if (process.env.GOOGLE_MAPS_API_KEY) url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY);
  else url.searchParams.delete('key');
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'city-3d-preprocess/0.1' } });
      const body = Buffer.from(await res.arrayBuffer());
      return route.fulfill({ status: res.status, body, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'access-control-allow-origin': '*' } });
    } catch (err) {
      if (attempt >= 4) return route.abort();
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

/** Open `pagePath` (relative to the repo root) with `renderConfig` injected as window.__RENDER_CONFIG__. */
export async function openRenderPage(pagePath, renderConfig, routes = () => {}) {
  const server = await createServer({ root: ROOT, configFile: false, server: { port: 5199, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const chromium = await loadChromium();
  // Software GL works everywhere; set PIXELMAP_GPU=1 on a machine with a real GPU for speed.
  const args = process.env.PIXELMAP_GPU ? ['--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.route('https://tile.googleapis.com/**', relayGoogle);
  await routes(page);
  await page.addInitScript((c) => (window.__RENDER_CONFIG__ = c), renderConfig);
  await page.goto(server.resolvedUrls.local[0] + pagePath);
  await page.waitForFunction('window.RENDERER_READY === true', null, { timeout: 300000 });
  return { page, close: async () => { await browser.close(); await server.close(); } };
}
