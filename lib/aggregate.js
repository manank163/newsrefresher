// Fetches every source for a tab in parallel, normalises, filters for
// relevance, tags (sectors + deal fields), de-duplicates and sorts.

import { createHash } from 'node:crypto';
import { REGIONS, SECTORS, TABS, WINDOWS } from './config.js';
import { parseFeed } from './rss.js';
import { extractDeal } from './extract.js';
import { readAgentState } from './agent.js';

const UA = 'Mozilla/5.0 (compatible; DealPulse/0.1; +https://github.com/manank163/newsrefresher)';
const SOURCE_TTL_MS = 8 * 60 * 1000;
const cache = new Map(); // url -> { at, items }

export function googleNewsUrl(query, region, window) {
  const r = REGIONS[region] ?? REGIONS.global;
  const q = `${query} when:${window}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${r.hl}&gl=${r.gl}&ceid=${encodeURIComponent(r.ceid)}`;
}

export function bingNewsUrl(query, region) {
  const r = REGIONS[region] ?? REGIONS.global;
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=${r.mkt}&count=50&qft=${encodeURIComponent('sortbydate="1"')}`;
}

// Refuse obviously internal targets for user-supplied feed URLs.
export function isSafeFeedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return false;
  return true;
}

async function fetchFeed(url) {
  if (url.startsWith('agent:')) return (await readAgentState(url.slice(6))).items;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.items;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(9000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text());
  cache.set(url, { at: Date.now(), items });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return items;
}

function unwrapBingLink(link) {
  try {
    const u = new URL(link);
    if (/bing\.com$/i.test(u.hostname) && u.searchParams.get('url')) return u.searchParams.get('url');
  } catch { /* keep original */ }
  return link;
}

function hostOf(link) {
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function normalise(raw, origin) {
  let title = raw.title ?? '';
  let source = raw.source ?? '';
  // Google News titles look like "Headline - Publisher".
  const dash = title.lastIndexOf(' - ');
  if (dash > 20) {
    const tail = title.slice(dash + 3).trim();
    if (!source || tail.toLowerCase() === source.toLowerCase() || tail.length < 40) {
      source = source || tail;
      title = title.slice(0, dash).trim();
    }
  }
  const link = unwrapBingLink(raw.link ?? '');
  const ts = Date.parse(raw.pubDate);
  let summary = raw.description ?? '';
  // Google News descriptions just repeat the headline + publisher.
  if (summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) summary = '';
  return {
    title,
    link,
    source: source || origin.name || hostOf(link),
    publishedAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
    summary: summary.slice(0, 400),
    origin: origin.kind,
  };
}

// Headlines that match deal keywords but aren't deals (stock tips, filings).
const NOISE = /\b(stocks? to (buy|sell|watch)|buy or sell|shares to buy|stock picks?|target price|price target|Form 4|Form 8-K|SC 13[DG]|top \d+ stocks|multibagger|intraday|technical (view|analysis))\b/i;

export function dedupeKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
}

function sectorsFor(text) {
  return SECTORS.filter(s => s.kw.test(text)).map(s => s.id);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function planSources({ tab, region, window, sectors = [], terms = [], customFeeds = [], includeAgent = false }) {
  const cfg = TABS[tab];
  const queries = [];
  const sectorDefs = sectors.map(id => SECTORS.find(s => s.id === id)).filter(Boolean);
  if (tab === 'watch') {
    for (const group of chunk(terms, 6)) queries.push(group.map(t => `"${t.replace(/"/g, '')}"`).join(' OR '));
  } else if (tab === 'sector') {
    for (const s of sectorDefs) queries.push(`${cfg.query} (${s.q})`);
  } else {
    queries.push(cfg.query);
    for (const s of sectorDefs.slice(0, 6)) queries.push(`${cfg.query} (${s.q})`);
  }
  const plan = [];
  for (const q of queries) {
    plan.push({ kind: 'google', name: 'Google News', url: googleNewsUrl(q, region, window) });
    plan.push({ kind: 'bing', name: 'Bing News', url: bingNewsUrl(q, region) });
  }
  if (includeAgent) plan.push({ kind: 'brave', name: 'Brave Search agent', url: `agent:${region}` });
  for (const f of cfg.feeds) plan.push({ kind: 'rss', name: f.name, url: f.url });
  for (const url of customFeeds) if (isSafeFeedUrl(url)) plan.push({ kind: 'rss', name: hostOf(url), url });
  return plan;
}

export async function buildFeed(params, fetcher = fetchFeed) {
  const { tab, window = '3d', sectors = [], terms = [], limit = 150 } = params;
  const cfg = TABS[tab];
  if (!cfg) throw new Error(`Unknown tab: ${tab}`);
  const plan = planSources(params);
  const settled = await Promise.allSettled(plan.map(p => fetcher(p.url)));

  const cutoff = Date.now() - ((WINDOWS[window] ?? 3) * 24 + 2) * 3600 * 1000;
  const sectorFilter = tab === 'sector' ? SECTORS.filter(s => sectors.includes(s.id)) : [];
  const termRes = terms.map(t => ({ t, re: new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') }));

  const sources = [];
  const seen = new Map();
  settled.forEach((r, i) => {
    const p = plan[i];
    const status = { name: p.name, kind: p.kind, ok: r.status === 'fulfilled', count: 0 };
    if (r.status === 'rejected') status.error = String(r.reason?.message ?? r.reason);
    sources.push(status);
    if (r.status !== 'fulfilled') return;
    for (const raw of r.value) {
      const item = normalise(raw, p);
      if (!item.title || !/^https?:\/\//i.test(item.link)) continue;
      if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
      const text = `${item.title} ${item.summary}`;
      if (tab !== 'watch' && NOISE.test(item.title)) continue;
      if (cfg.match && !cfg.match.test(text)) continue;
      if (sectorFilter.length && !sectorFilter.some(s => s.kw.test(text))) continue;
      let matched;
      if (tab === 'watch') {
        matched = termRes.filter(x => x.re.test(text)).map(x => x.t);
        if (!matched.length) continue;
      }
      const key = dedupeKey(item.title);
      const existing = seen.get(key);
      if (existing) {
        if (!existing.alsoIn.includes(item.source)) existing.alsoIn.push(item.source);
        continue;
      }
      status.count++;
      seen.set(key, {
        id: createHash('sha1').update(key).digest('hex').slice(0, 12),
        ...item,
        sectors: sectorsFor(text),
        deal: extractDeal(item.title, item.summary),
        matched,
        alsoIn: [],
      });
    }
  });

  const items = [...seen.values()]
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
    .slice(0, limit);
  return { tab, fetchedAt: new Date().toISOString(), items, sources };
}
