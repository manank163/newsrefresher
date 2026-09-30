// Bundles the front-end + pre-computed demo API responses into one static
// HTML file, so the UI can be previewed anywhere without the Node server.
//   node scripts/build-preview.mjs [out.html]

import { readFile, writeFile } from 'node:fs/promises';
import { publicConfig, SECTORS, DEFAULTS } from '../lib/config.js';
import { buildDemoFeed } from '../lib/demo.js';

const out = process.argv[2] ?? 'preview.html';
const read = f => readFile(new URL(`../public/${f}`, import.meta.url), 'utf8');
const [html, css, js] = await Promise.all([read('index.html'), read('styles.css'), read('app.js')]);

const base = { region: DEFAULTS.region, window: DEFAULTS.window, customFeeds: [] };
const responses = {};
for (const tab of ['ma', 'pe', 'vc', 'ipo']) responses[tab] = await buildDemoFeed({ ...base, tab, sectors: [], terms: [] });
for (const s of SECTORS) responses[`sector:${s.id}`] = await buildDemoFeed({ ...base, tab: 'sector', sectors: [s.id], terms: [] });
for (const list of ['competitors', 'watchlist']) {
  const terms = DEFAULTS[list];
  responses[`watch:${terms.join('|')}`] = await buildDemoFeed({ ...base, tab: 'watch', sectors: [], terms });
}

const shim = `
const DEMO_CONFIG = ${JSON.stringify({ ...publicConfig(), demo: true })};
const DEMO_RESPONSES = ${JSON.stringify(responses).replace(/</g, '\\u003c')};
const BUILT_AT = ${Date.now()};
window.fetch = async input => {
  const u = new URL(String(input), 'https://preview.local/');
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.pathname.endsWith('/api/config')) return json(DEMO_CONFIG);
  const p = u.searchParams, tab = p.get('tab');
  const key = tab === 'sector' ? 'sector:' + p.get('sectors') : tab === 'watch' ? 'watch:' + p.get('terms') : tab;
  const hit = DEMO_RESPONSES[key] ?? { tab, items: [], sources: [], demo: true };
  await new Promise(r => setTimeout(r, 250));
  // Keep demo stories looking recent however long ago the preview was built.
  const shift = Date.now() - BUILT_AT;
  const items = hit.items.map(i => ({ ...i, publishedAt: new Date(Date.parse(i.publishedAt) + shift).toISOString() }));
  return json({ ...hit, items, fetchedAt: new Date().toISOString() });
};`;

const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[^>]*src="app\.js"[^>]*><\/script>/, '');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .replace(/<link rel="stylesheet" href="styles\.css">/, '')
  .replace(/<meta [^>]*>\s*/g, '');

await writeFile(out, `${head.trim()}
<style>
${css}
/* Preview build: the viewer frame blocks printing and file downloads. */
[data-act="print"], [data-act="csv"] { display: none !important; }
</style>
${body.trim()}
<script>${shim}</script>
<script type="module">
${js}
</script>
`);
console.log(`Wrote ${out}`);
