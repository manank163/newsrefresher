// Deal Pulse front-end: hash-routed single page, no build step.

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u ?? '') ? u : '#');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const DEAL_TABS = ['ma', 'pe', 'vc', 'ipo'];

const NAV = [
  { group: 'Overview' },
  { id: 'dashboard', label: 'Dashboard', ico: '▦' },
  { group: 'Deal flow' },
  { id: 'ma', label: 'M&A News', ico: '⇄', tab: 'ma', sub: 'Acquisitions, mergers, stake sales and takeovers.' },
  { id: 'radar', label: 'Deal Radar', ico: '◎' },
  { id: 'pe', label: 'PE Tracker', ico: '▣', tab: 'pe', sub: 'Private equity fund closes, buyouts, investments and exits.' },
  { id: 'vc', label: 'VC Tracker', ico: '➚', tab: 'vc', sub: 'Venture rounds from seed to late stage.' },
  { id: 'ipo', label: 'IPO Watch', ico: '◆', tab: 'ipo', sub: 'DRHP filings, IPO launches, subscriptions and listings.' },
  { group: 'Intelligence' },
  { id: 'sectors', label: 'Sector Watch', ico: '◧' },
  { id: 'competitors', label: 'Competitive Intel', ico: '⚑' },
  { id: 'watchlist', label: 'Company Watchlist', ico: '★' },
  { group: 'Coming soon' },
  { id: 'screener', label: 'Screener', ico: '≣', soon: true },
  { id: 'alerts', label: 'Alerts & Digest', ico: '✉', soon: true },
  { id: 'leads', label: 'Leads', ico: '◉', soon: true },
  { group: 'Workspace' },
  { id: 'settings', label: 'Settings', ico: '⚙' },
];

let CONFIG;
let settings;
let current = 'dashboard';
let nextRefreshAt = 0;
let lastError = null;
const viewState = {};
const feedCache = new Map();

// "New since your last visit": frozen for this session, persisted per view.
const lastSeen = store.get('dp.lastSeen', {});
const sessionSince = {};
const sinceFor = view => (sessionSince[view] ??= lastSeen[view] ?? Infinity);
function markSeen(view) { sinceFor(view); lastSeen[view] = Date.now(); store.set('dp.lastSeen', lastSeen); }

// ---------- helpers ----------
function rel(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
function ageClass(iso) {
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  return h < 24 ? 'age-fresh' : h < 72 ? 'age-mid' : 'age-old';
}
function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(+d) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtUsd(m) {
  if (m == null) return '—';
  return m >= 1000 ? `$${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}bn` : `$${m >= 100 ? Math.round(m) : m.toFixed(1)}m`;
}
const sectorLabel = id => CONFIG.sectors.find(s => s.id === id)?.label ?? id;
const isNew = (item, view) => Date.parse(item.publishedAt) > sinceFor(view);

function downloadCsv(name, header, rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- data ----------
async function getFeed(p, { force = false } = {}) {
  const params = { region: settings.region, window: settings.window, ...p };
  if (params.tab !== 'watch' && params.tab !== 'sector' && settings.sectors.length) params.sectors ??= settings.sectors.join(',');
  const feeds = settings.customFeeds.filter(f => f.tab === p.tab).map(f => f.url);
  if (feeds.length) params.feeds = feeds.join('|');
  if (DEMO) params.demo = '1';
  const key = new URLSearchParams(params).toString();
  const hit = feedCache.get(key);
  if (!force && hit?.promise) return hit.promise;
  if (!force && hit?.data && Date.now() - hit.at < settings.refreshMin * 60000) return hit.data;

  const promise = fetch(`/api/feed?${key}`).then(async r => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });
  feedCache.set(key, { ...hit, promise });
  try {
    const data = await promise;
    feedCache.set(key, { at: Date.now(), data });
    lastError = null;
    if (data.demo) $('#demoBanner').hidden = false;
    return data;
  } catch (err) {
    feedCache.set(key, { at: hit?.at ?? 0, data: hit?.data });
    lastError = err;
    if (hit?.data) return { ...hit.data, stale: true };
    throw err;
  } finally {
    updateBadges();
  }
}

function cachedTab(tab) {
  for (const [key, v] of feedCache) {
    const p = new URLSearchParams(key);
    if (p.get('tab') === tab && p.get('region') === settings.region && p.get('window') === settings.window && v.data) return v.data;
  }
  return null;
}

// ---------- shell ----------
function renderNav() {
  $('#nav').innerHTML = NAV.map(n => n.group
    ? `<div class="nav-group">${esc(n.group)}</div>`
    : `<a href="#/${n.id}" data-id="${n.id}" class="${n.soon ? 'soon' : ''} ${n.id === current ? 'active' : ''}">
         <span class="ico">${n.ico}</span>${esc(n.label)}<span class="count" data-badge="${n.id}" ${n.soon ? '' : 'hidden'}>${n.soon ? 'Soon' : ''}</span></a>`).join('');
  $('#regionFoot').textContent = `${CONFIG.regions[settings.region]} · ${settings.window}`;
}

function updateBadges() {
  for (const tab of DEAL_TABS) {
    const el = $(`[data-badge="${tab}"]`);
    const data = cachedTab(tab);
    if (!el || !data) continue;
    const n = tab === current ? 0 : data.items.filter(i => isNew(i, tab)).length;
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : n;
  }
}

function tickLive() {
  const pill = $('#livePill');
  const loading = [...feedCache.values()].some(v => v.promise);
  const secs = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000));
  pill.className = `live-pill ${loading ? 'loading' : lastError ? 'error' : ''}`;
  $('#liveText').textContent = loading ? 'Updating…'
    : lastError ? `Source error · retry in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    : `Live · refresh in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  if (secs === 0 && !loading && document.visibilityState === 'visible') refresh(true);
}

function scheduleNext() { nextRefreshAt = Date.now() + settings.refreshMin * 60000; }

function refresh(force = false) {
  scheduleNext();
  const nav = NAV.find(n => n.id === current);
  if (nav?.soon) return;
  (VIEWS[current] ?? VIEWS.dashboard)({ force });
}

function route() {
  const id = location.hash.replace(/^#\/?/, '') || 'dashboard';
  current = NAV.some(n => n.id === id && !n.soon) ? id : 'dashboard';
  document.body.classList.remove('menu-open');
  renderNav();
  refresh(false);
  window.scrollTo(0, 0);
}

// ---------- shared UI pieces ----------
function pageHead(title, sub, extra = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><div class="sub">${sub}</div></div>
    <div class="actions">${extra}
      <button class="btn" data-act="refresh">↻ Refresh</button>
      <button class="btn primary" data-act="print">⎙ Print / PDF</button></div></div>`;
}

function bindHeadActions(root) {
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') refresh(true);
    if (act === 'print') window.print();
  });
}

function storyHtml(item, view, { compact = false } = {}) {
  const d = item.deal ?? {};
  const fresh = isNew(item, view);
  const pills = [
    fresh && '<span class="pill new">NEW</span>',
    d.type && `<span class="pill type">${esc(d.type)}${d.round && d.type === 'Funding round' ? ` · ${esc(d.round)}` : ''}</span>`,
    d.amountText && `<span class="pill amt" title="≈ ${fmtUsd(d.amountUsdM)}">${esc(d.amountText)}</span>`,
    ...(item.matched ?? []).map(m => `<span class="pill match">${esc(m)}</span>`),
    ...(compact ? [] : (item.sectors ?? []).slice(0, 3).map(s => `<span class="pill sector">${esc(sectorLabel(s))}</span>`)),
  ].filter(Boolean).join('');
  const also = item.alsoIn?.length ? ` · +${item.alsoIn.length} more` : '';
  return `<li class="story ${fresh ? 'new' : ''}">
    <a class="title" href="${esc(safeUrl(item.link))}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>
    ${!compact && item.summary ? `<div class="summary">${esc(item.summary)}</div>` : ''}
    <div class="meta"><span>${esc(item.source)}${also}</span><span class="pill ${ageClass(item.publishedAt)}">${rel(item.publishedAt) || 'undated'}</span>${pills}</div>
  </li>`;
}

function sourcesHtml(feeds) {
  const all = feeds.flatMap(f => f?.sources ?? []);
  if (!all.length) return '';
  const bad = all.filter(s => !s.ok);
  const byName = new Map();
  for (const s of all) {
    const k = s.name;
    const e = byName.get(k) ?? { name: k, ok: 0, bad: 0, count: 0, error: '' };
    s.ok ? e.ok++ : (e.bad++, e.error = s.error);
    e.count += s.count;
    byName.set(k, e);
  }
  return `<details class="sources"><summary>${all.length} source queries · ${bad.length} failed</summary><ul>
    ${[...byName.values()].map(s => `<li class="${s.bad && !s.ok ? 'bad' : ''}">${esc(s.name)}: ${s.count} unique stories${s.bad ? ` · ${s.bad} failed (${esc(s.error)})` : ''}</li>`).join('')}
  </ul></details>`;
}

function filterSelects() {
  const regions = Object.entries(CONFIG.regions).map(([k, v]) => `<option value="${k}" ${k === settings.region ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const windows = CONFIG.windows.map(w => `<option value="${w}" ${w === settings.window ? 'selected' : ''}>Last ${w.replace('d', ' day')}${w === '1d' ? '' : 's'}</option>`).join('');
  return `<select data-set="region" aria-label="Region">${regions}</select><select data-set="window" aria-label="Time window">${windows}</select>`;
}

function bindFilterSelects(root) {
  $$('[data-set]', root).forEach(sel => sel.addEventListener('change', () => {
    settings[sel.dataset.set] = sel.value;
    store.set('dp.settings', settings);
    renderNav();
    $('#view').dataset.view = ''; // repaint so the new region/window is fetched
    refresh(false);
  }));
}

function loadingHtml(n = 5) { return Array.from({ length: n }, () => '<div class="skeleton"></div>').join(''); }
const errorHtml = err => `<div class="error-box">Couldn't load news: ${esc(err.message)}.<br>Check your connection or try Refresh.</div>`;

// ---------- feed view (M&A / PE / VC / IPO / sector / watch) ----------
async function feedView({ view, title, sub, request, force, chipsFrom = 'type', emptyHint = '', top = '', onPaint }) {
  const st = (viewState[view] ??= { q: '', chip: 'all', sector: 'all' });
  const root = $('#view');
  const firstPaint = root.dataset.view !== view;
  if (firstPaint) {
    root.dataset.view = view;
    root.innerHTML = `${pageHead(title, sub, '<button class="btn" data-act="csv">⇩ Export CSV</button>')}${top}
      <div class="toolbar">
        <input type="search" placeholder="Search headlines, companies, sources…" value="${esc(st.q)}" id="q">
        <select id="sectorSel" aria-label="Sector" ${top ? 'hidden' : ''}><option value="all">All sectors</option>
          ${CONFIG.sectors.map(s => `<option value="${s.id}" ${st.sector === s.id ? 'selected' : ''}>${settings.sectors.includes(s.id) ? '★ ' : ''}${esc(s.label)}</option>`).join('')}
        </select>${filterSelects()}
      </div>
      <div class="chips" id="chips"></div>
      <div class="meta-line" id="metaLine"></div>
      <div class="card"><ul class="stories" id="list">${loadingHtml()}</ul></div>
      <div id="sources"></div>`;
    bindHeadActions(root);
    bindFilterSelects(root);
    onPaint?.(root);
    $('#q').addEventListener('input', e => { st.q = e.target.value; draw(); });
    $('#sectorSel').addEventListener('change', e => { st.sector = e.target.value; draw(); });
    $('#chips').addEventListener('click', e => {
      const c = e.target.closest('[data-chip]');
      if (c) { st.chip = c.dataset.chip; draw(); }
    });
    root.addEventListener('click', e => {
      if (e.target.closest('[data-act="csv"]') && root._items) {
        downloadCsv(view, ['Published', 'Headline', 'Source', 'Type', 'Value', 'Approx USD m', 'Buyer / Investor', 'Target', 'Sectors', 'Link'],
          root._items.map(i => [i.publishedAt, i.title, i.source, i.deal?.type, i.deal?.amountText, i.deal?.amountUsdM, i.deal?.acquirer, i.deal?.target, (i.sectors ?? []).map(sectorLabel).join('; '), i.link]));
      }
    });
  } else if (!force) {
    return draw();
  }

  let data;
  try {
    data = await request(force);
  } catch (err) {
    if (current === viewKey(view)) $('#list').innerHTML = errorHtml(err);
    return;
  }
  if (root.dataset.view !== view) return; // user navigated away meanwhile
  root._data = data;
  draw();
  markSeen(view);

  function draw() {
    const d = root._data;
    if (!d) return;
    const q = st.q.trim().toLowerCase();
    const base = d.items.filter(i =>
      (st.sector === 'all' || i.sectors?.includes(st.sector)) &&
      (!q || `${i.title} ${i.summary} ${i.source} ${i.deal?.acquirer ?? ''} ${i.deal?.target ?? ''}`.toLowerCase().includes(q)));
    const keyOf = chipsFrom === 'matched' ? i => i.matched ?? [] : i => [i.deal?.type ?? 'Other'];
    const counts = new Map();
    base.forEach(i => keyOf(i).forEach(k => counts.set(k, (counts.get(k) ?? 0) + 1)));
    if (st.chip !== 'all' && !counts.has(st.chip)) st.chip = 'all';
    const items = st.chip === 'all' ? base : base.filter(i => keyOf(i).includes(st.chip));
    root._items = items;
    $('#chips').innerHTML = [`<button class="chip ${st.chip === 'all' ? 'on' : ''}" data-chip="all">All<span class="n">${base.length}</span></button>`,
      ...[...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<button class="chip ${st.chip === k ? 'on' : ''}" data-chip="${esc(k)}">${esc(k)}<span class="n">${n}</span></button>`)].join('');
    const fresh = items.filter(i => isNew(i, view)).length;
    $('#metaLine').innerHTML = `<span>${items.length} stories${fresh ? ` · <b>${fresh} new since your last visit</b>` : ''}</span>
      <span>Updated ${new Date(d.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${d.stale ? ' (showing cached — latest refresh failed)' : ''}</span>`;
    $('#list').innerHTML = items.length ? items.map(i => storyHtml(i, view)).join('')
      : `<div class="empty">No stories match these filters.${emptyHint}</div>`;
    $('#sources').innerHTML = sourcesHtml(d.feeds ?? [d]);
  }
}

const viewKey = v => (v.startsWith('sector:') ? 'sectors' : v);

function tabView(id) {
  const nav = NAV.find(n => n.id === id);
  return ({ force }) => feedView({
    view: id, title: nav.label, force,
    sub: `${esc(nav.sub)} ${esc(CONFIG.regions[settings.region])}, last ${esc(settings.window)}.`,
    request: f => getFeed({ tab: nav.tab }, { force: f }),
  });
}

// ---------- dashboard ----------
async function dashboard({ force }) {
  const root = $('#view');
  root.dataset.view = 'dashboard';
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  root.innerHTML = `${pageHead(hello, `${esc(today)} · ${esc(CONFIG.regions[settings.region])} deal flow, last ${esc(settings.window)}`, `<span class="toolbar" style="margin:0">${filterSelects()}</span>`)}
    <div class="kpis" id="kpis">${DEAL_TABS.map(() => '<div class="card kpi"><div class="skeleton" style="margin:0;height:52px"></div></div>').join('')}</div>
    <div class="grid-2">
      <div class="card card-pad"><h3>Largest disclosed deals <a href="#/radar">Deal Radar →</a></h3><div id="bigDeals">${loadingHtml(3)}</div></div>
      <div class="card card-pad"><h3>Sector heat <a href="#/sectors">Sector Watch →</a></h3><div id="heat">${loadingHtml(3)}</div></div>
    </div>
    <div class="grid-3" id="columns"></div>
    <div id="sources"></div>`;
  bindHeadActions(root);
  bindFilterSelects(root);

  const results = await Promise.allSettled(DEAL_TABS.map(tab => getFeed({ tab }, { force })));
  if (root.dataset.view !== 'dashboard') return;
  const feeds = Object.fromEntries(DEAL_TABS.map((t, i) => [t, results[i].status === 'fulfilled' ? results[i].value : null]));
  const day = Date.now() - 24 * 36e5;

  $('#kpis').innerHTML = DEAL_TABS.map(t => {
    const nav = NAV.find(n => n.id === t);
    const f = feeds[t];
    if (!f) return `<a class="card kpi" href="#/${t}"><div class="label">${esc(nav.label)}</div><div class="value">—</div><div class="hint">Failed to load</div></a>`;
    const last24 = f.items.filter(i => Date.parse(i.publishedAt) > day).length;
    const fresh = f.items.filter(i => isNew(i, t)).length;
    return `<a class="card kpi" href="#/${t}"><div class="label">${esc(nav.label)} · 24h</div><div class="value">${last24}</div>
      <div class="hint">${f.items.length} in last ${esc(settings.window)}${fresh ? ` · ${fresh} new` : ''}</div></a>`;
  }).join('');

  const all = dedupe(Object.values(feeds).filter(Boolean).flatMap(f => f.items));
  const big = all.filter(i => i.deal?.amountUsdM).sort((a, b) => b.deal.amountUsdM - a.deal.amountUsdM).slice(0, 8);
  $('#bigDeals').innerHTML = big.length ? `<div class="table-wrap"><table><tbody>${big.map(i => `<tr>
      <td class="num"><b>${fmtUsd(i.deal.amountUsdM)}</b></td>
      <td><a href="${esc(safeUrl(i.link))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><div class="meta" style="font-size:12px;color:var(--muted)">${esc(i.deal.type ?? '')} · ${esc(i.source)} · ${rel(i.publishedAt)}</div></td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No disclosed deal values in this window yet.</div>';

  const heat = settings.sectors.map(id => [id, all.filter(i => i.sectors?.includes(id)).length]).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...heat.map(h => h[1]));
  $('#heat').innerHTML = heat.length ? `<div class="bars">${heat.map(([id, n]) => `<a class="bar-row" href="#/sectors" data-sector="${id}" style="text-decoration:none">
      <span>${esc(sectorLabel(id))}</span><span class="track"><span class="fill" style="display:block;width:${(n / max) * 100}%"></span></span><span class="num">${n}</span></a>`).join('')}</div>`
    : '<div class="empty">Pick sectors to track in <a href="#/settings">Settings</a>.</div>';
  $$('#heat [data-sector]').forEach(a => a.addEventListener('click', () => { (viewState.sectors ??= {}).selected = a.dataset.sector; }));

  $('#columns').innerHTML = ['ma', 'pe', 'vc'].map(t => {
    const nav = NAV.find(n => n.id === t);
    const f = feeds[t];
    return `<div class="card card-pad compact"><h3>Latest · ${esc(nav.label)} <a href="#/${t}">All →</a></h3>
      ${f ? `<ul class="stories">${f.items.slice(0, 7).map(i => storyHtml(i, t, { compact: true })).join('') || '<div class="empty">Nothing yet.</div>'}</ul>` : errorHtml(results[DEAL_TABS.indexOf(t)].reason)}</div>`;
  }).join('');
  $('#sources').innerHTML = sourcesHtml(Object.values(feeds).filter(Boolean));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(i => !seen.has(i.id) && seen.add(i.id));
}

// ---------- deal radar ----------
async function radar({ force }) {
  const st = (viewState.radar ??= { q: '', chip: 'all', sort: 'date', dir: -1 });
  const root = $('#view');
  const firstPaint = root.dataset.view !== 'radar';
  if (firstPaint) {
    root.dataset.view = 'radar';
    root.innerHTML = `${pageHead('Deal Radar', `Deals parsed automatically from M&A, PE and VC headlines — buyer, target and disclosed value. ${esc(CONFIG.regions[settings.region])}, last ${esc(settings.window)}. Values are approximate USD for ranking only.`, '<button class="btn" data-act="csv">⇩ Export CSV</button>')}
      <div class="toolbar"><input type="search" id="q" placeholder="Search buyer, target, headline…" value="${esc(st.q)}">${filterSelects()}</div>
      <div class="chips" id="chips"></div>
      <div class="meta-line" id="metaLine"></div>
      <div class="card"><div class="table-wrap" id="table">${loadingHtml()}</div></div>
      <div id="sources"></div>`;
    bindHeadActions(root);
    bindFilterSelects(root);
    $('#q').addEventListener('input', e => { st.q = e.target.value; draw(); });
    $('#chips').addEventListener('click', e => { const c = e.target.closest('[data-chip]'); if (c) { st.chip = c.dataset.chip; draw(); } });
    root.addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (th) { st.dir = st.sort === th.dataset.sort ? -st.dir : -1; st.sort = th.dataset.sort; draw(); }
      if (e.target.closest('[data-act="csv"]') && root._rows) {
        downloadCsv('deal-radar', ['Published', 'Type', 'Round', 'Buyer / Investor', 'Target / Company', 'Disclosed value', 'Approx USD m', 'Sectors', 'Headline', 'Source', 'Link'],
          root._rows.map(i => [i.publishedAt, i.deal.type, i.deal.round, i.deal.acquirer, i.deal.target, i.deal.amountText, i.deal.amountUsdM, (i.sectors ?? []).map(sectorLabel).join('; '), i.title, i.source, i.link]));
      }
    });
  } else if (!force) {
    return draw();
  }
  const results = await Promise.allSettled(['ma', 'pe', 'vc'].map(tab => getFeed({ tab }, { force })));
  if (root.dataset.view !== 'radar') return;
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!ok.length) { $('#table').innerHTML = errorHtml(results[0].reason); return; }
  root._data = { feeds: ok, items: dedupe(ok.flatMap(f => f.items)).filter(i => i.deal?.type && (i.deal.acquirer || i.deal.target || i.deal.amountUsdM)) };
  draw();
  markSeen('radar');

  function draw() {
    const d = root._data;
    if (!d) return;
    const q = st.q.trim().toLowerCase();
    const base = d.items.filter(i => !q || `${i.title} ${i.deal.acquirer ?? ''} ${i.deal.target ?? ''}`.toLowerCase().includes(q));
    const counts = new Map();
    base.forEach(i => counts.set(i.deal.type, (counts.get(i.deal.type) ?? 0) + 1));
    if (st.chip !== 'all' && !counts.has(st.chip)) st.chip = 'all';
    const val = { date: i => Date.parse(i.publishedAt) || 0, value: i => i.deal.amountUsdM ?? -1, buyer: i => (i.deal.acquirer ?? '~').toLowerCase(), target: i => (i.deal.target ?? '~').toLowerCase(), type: i => i.deal.type };
    const rows = (st.chip === 'all' ? base : base.filter(i => i.deal.type === st.chip))
      .sort((a, b) => { const x = val[st.sort](a), y = val[st.sort](b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    root._rows = rows;
    $('#chips').innerHTML = [`<button class="chip ${st.chip === 'all' ? 'on' : ''}" data-chip="all">All<span class="n">${base.length}</span></button>`,
      ...[...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<button class="chip ${st.chip === k ? 'on' : ''}" data-chip="${esc(k)}">${esc(k)}<span class="n">${n}</span></button>`)].join('');
    const disclosed = rows.filter(r => r.deal.amountUsdM);
    const total = disclosed.reduce((s, r) => s + r.deal.amountUsdM, 0);
    $('#metaLine').innerHTML = `<span>${rows.length} deals · ${disclosed.length} with disclosed value (≈ ${fmtUsd(total)} combined)</span>`;
    const arrow = k => `<span class="sort">${st.sort === k ? (st.dir < 0 ? '↓' : '↑') : '⇅'}</span>`;
    $('#table').innerHTML = rows.length ? `<table><thead><tr>
        <th data-sort="date">Date${arrow('date')}</th><th data-sort="type">Type${arrow('type')}</th>
        <th data-sort="buyer">Buyer / Investor${arrow('buyer')}</th><th data-sort="target">Target / Company${arrow('target')}</th>
        <th data-sort="value" style="text-align:right">Value${arrow('value')}</th><th>Sectors</th><th style="min-width:280px">Headline</th></tr></thead><tbody>
      ${rows.map(i => `<tr>
        <td style="white-space:nowrap">${fmtDate(i.publishedAt)}${isNew(i, 'radar') ? ' <span class="pill new">NEW</span>' : ''}</td>
        <td><span class="pill type">${esc(i.deal.type)}${i.deal.round && i.deal.type === 'Funding round' ? ` · ${esc(i.deal.round)}` : ''}</span></td>
        <td>${esc(i.deal.acquirer ?? '—')}</td><td><b>${esc(i.deal.target ?? '—')}</b></td>
        <td class="num">${i.deal.amountText ? `${esc(i.deal.amountText)}<div style="font-size:11px;color:var(--muted)">≈ ${fmtUsd(i.deal.amountUsdM)}</div>` : '—'}</td>
        <td>${(i.sectors ?? []).slice(0, 2).map(s => `<span class="pill sector">${esc(sectorLabel(s))}</span>`).join(' ')}</td>
        <td><a href="${esc(safeUrl(i.link))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><div style="font-size:12px;color:var(--muted)">${esc(i.source)}</div></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">No parsable deals for these filters.</div>';
    $('#sources').innerHTML = sourcesHtml(d.feeds);
  }
}

// ---------- sector watch ----------
async function sectors({ force }) {
  const st = (viewState.sectors ??= {});
  st.selected ??= settings.sectors[0] ?? CONFIG.sectors[0].id;
  const order = [...CONFIG.sectors].sort((a, b) => settings.sectors.includes(b.id) - settings.sectors.includes(a.id));
  await feedView({
    view: `sector:${st.selected}`, force, title: 'Sector Watch',
    sub: `All deal activity — M&A, PE, VC and IPOs — in one sector. ${esc(CONFIG.regions[settings.region])}, last ${esc(settings.window)}.`,
    request: f => getFeed({ tab: 'sector', sectors: st.selected }, { force: f }),
    top: `<div class="chips" id="sectorChips">${order.map(s =>
      `<button class="chip ${s.id === st.selected ? 'on' : ''}" data-pick="${s.id}">${settings.sectors.includes(s.id) ? '★ ' : ''}${esc(s.label)}</button>`).join('')}</div>`,
    onPaint: root => $('#sectorChips', root).addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b && b.dataset.pick !== st.selected) { st.selected = b.dataset.pick; sectors({ force: false }); }
    }),
  });
}

// ---------- competitors & watchlist ----------
function watchView(id, key, title, sub) {
  return ({ force }) => {
    const terms = settings[key];
    if (!terms.length) {
      $('#view').dataset.view = id;
      $('#view').innerHTML = `${pageHead(title, sub)}<div class="card empty">Your list is empty. Add names in <a href="#/settings">Settings</a>.</div>`;
      return bindHeadActions($('#view'));
    }
    return feedView({
      view: id, title, force, chipsFrom: 'matched',
      sub: `${sub} Tracking ${terms.length} names · <a href="#/settings">edit list</a>.`,
      request: f => getFeed({ tab: 'watch', terms: terms.join('|') }, { force: f }),
    });
  };
}

// ---------- settings ----------
function settingsView() {
  const root = $('#view');
  root.dataset.view = 'settings';
  const tabOpts = ['ma', 'pe', 'vc', 'ipo'].map(t => `<option value="${t}">${esc(CONFIG.tabs[t].label)}</option>`).join('');
  root.innerHTML = `<div class="page-head"><div><h1>Settings</h1><div class="sub">Saved in this browser only.</div></div>
      <div class="actions"><button class="btn" id="reset">Reset to defaults</button><button class="btn primary" id="save">Save settings</button></div></div>
    <div class="settings">
      <div class="card card-pad">
        <div class="field"><label for="sRegion">Region</label>
          <select id="sRegion">${Object.entries(CONFIG.regions).map(([k, v]) => `<option value="${k}" ${k === settings.region ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
          <span class="help">Sets the edition used for Google News and Bing News searches.</span></div>
        <div class="field"><label for="sWindow">Default time window</label>
          <select id="sWindow">${CONFIG.windows.map(w => `<option ${w === settings.window ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
        <div class="field"><label for="sRefresh">Auto-refresh every (minutes)</label>
          <input type="text" inputmode="numeric" id="sRefresh" value="${settings.refreshMin}">
          <span class="help">Between 2 and 120. Refresh pauses while the tab is hidden.</span></div>
        <div class="field"><label>Sectors you track</label>
          <div class="checks">${CONFIG.sectors.map(s => `<label><input type="checkbox" value="${s.id}" ${settings.sectors.includes(s.id) ? 'checked' : ''}> ${esc(s.label)}</label>`).join('')}</div>
          <span class="help">Tracked sectors get their own search queries (up to 6) and appear on the dashboard heat map.</span></div>
      </div>
      <div class="card card-pad">
        <div class="field"><label for="sComp">Competitors (Competitive Intel)</label>
          <textarea id="sComp">${esc(settings.competitors.join('\n'))}</textarea><span class="help">One firm per line, up to 30.</span></div>
        <div class="field"><label for="sWatch">Company watchlist</label>
          <textarea id="sWatch">${esc(settings.watchlist.join('\n'))}</textarea><span class="help">Clients, targets, likely acquirers — one per line.</span></div>
      </div>
      <div class="card card-pad">
        <div class="field"><label>Extra RSS feeds</label>
          <span class="help">Add any public RSS/Atom feed (a trade publication, a regulator, a PE firm's newsroom) to a tab. Stories are still filtered for relevance.</span>
          <div id="feedList"></div>
          <div class="toolbar"><select id="fTab">${tabOpts}</select><input type="text" id="fUrl" placeholder="https://example.com/feed/" style="flex:1;min-width:0"><button class="btn" id="fAdd">Add</button></div></div>
        <div class="field"><label>Built-in sources</label>
          <span class="help">Google News + Bing News searches (per tab and per tracked sector)${Object.entries(CONFIG.tabs).filter(([, t]) => t.feeds.length).map(([, t]) => `; ${esc(t.label)}: ${t.feeds.map(esc).join(', ')}`).join('')}.</span></div>
      </div>
    </div>`;
  const feeds = [...settings.customFeeds];
  const drawFeeds = () => {
    $('#feedList').innerHTML = feeds.length ? feeds.map((f, i) => `<div class="meta-line"><span class="pill type">${esc(CONFIG.tabs[f.tab].label)}</span><span style="word-break:break-all">${esc(f.url)}</span><button class="linkish" data-rm="${i}">remove</button></div>`).join('') : '<div class="help">None yet.</div>';
  };
  drawFeeds();
  $('#feedList').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { feeds.splice(+b.dataset.rm, 1); drawFeeds(); } });
  $('#fAdd').addEventListener('click', () => {
    const url = $('#fUrl').value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return alert('Enter a full http(s) feed URL.');
    feeds.push({ tab: $('#fTab').value, url });
    $('#fUrl').value = '';
    drawFeeds();
  });
  const lines = v => [...new Set(v.split('\n').map(s => s.trim()).filter(Boolean))].slice(0, 30);
  $('#save').addEventListener('click', () => {
    const refreshMin = Math.min(120, Math.max(2, parseInt($('#sRefresh').value, 10) || 10));
    settings = {
      ...settings,
      region: $('#sRegion').value,
      window: $('#sWindow').value,
      refreshMin,
      sectors: $$('.checks input:checked').map(c => c.value),
      competitors: lines($('#sComp').value),
      watchlist: lines($('#sWatch').value),
      customFeeds: feeds.slice(0, 10),
    };
    store.set('dp.settings', settings);
    feedCache.clear();
    scheduleNext();
    renderNav();
    $('#save').textContent = 'Saved ✓';
    setTimeout(() => { if ($('#save')) $('#save').textContent = 'Save settings'; }, 1500);
  });
  $('#reset').addEventListener('click', () => {
    if (!confirm('Reset all settings to defaults?')) return;
    settings = structuredClone(CONFIG.defaults);
    store.set('dp.settings', settings);
    feedCache.clear();
    renderNav();
    settingsView();
  });
}

const VIEWS = {
  dashboard,
  ma: tabView('ma'),
  pe: tabView('pe'),
  vc: tabView('vc'),
  ipo: tabView('ipo'),
  radar,
  sectors,
  competitors: watchView('competitors', 'competitors', 'Competitive Intel', 'Mandates, league-table mentions and deals involving competing advisory firms.'),
  watchlist: watchView('watchlist', 'watchlist', 'Company Watchlist', 'Every mention of the companies you follow.'),
  settings: settingsView,
};

// ---------- boot ----------
async function boot() {
  try {
    CONFIG = await (await fetch('/api/config')).json();
  } catch {
    $('#view').innerHTML = '<div class="error-box">Could not reach the Deal Pulse API. Run <code>npm run dev</code> or deploy to Vercel.</div>';
    return;
  }
  if (CONFIG.demo || DEMO) $('#demoBanner').hidden = false;
  settings = { ...structuredClone(CONFIG.defaults), ...store.get('dp.settings', {}) };
  $('#menuBtn').addEventListener('click', () => document.body.classList.add('menu-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('menu-open'));
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() > nextRefreshAt) refresh(true); });
  // Keep nav badges meaningful: warm the four deal feeds in the background.
  route();
  if (current !== 'dashboard') DEAL_TABS.forEach(tab => getFeed({ tab }).catch(() => {}));
  setInterval(tickLive, 1000);
}

boot();
