// The news agent: on a schedule (and whenever the portal is used and its
// results are stale) it runs a fixed set of Brave News searches, merges the
// results into a rolling 7-day store, and the feed API serves them alongside
// Google News / Bing / RSS. Query count per run is kept small so a free Brave
// plan lasts the month (see README for the maths).

import { DEFAULTS, SECTORS, TABS } from './config.js';
import { braveNews } from './brave.js';
import { readJson, writeJson } from './store.js';

const KEEP_DAYS = 7;
const MAX_ITEMS = 2000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const agentEnabled = () => Boolean(process.env.BRAVE_API_KEY);
export const intervalMin = () => Math.max(30, Number(process.env.AGENT_INTERVAL_MIN) || 480);
export const agentRegions = () => (process.env.AGENT_REGIONS || DEFAULTS.region).split(',').map(s => s.trim()).filter(Boolean);
const stateName = region => `agent/${region}.json`;

export function agentQueries() {
  const quoted = list => list.map(t => `"${t}"`).join(' OR ');
  const sectors = DEFAULTS.sectors.map(id => SECTORS.find(s => s.id === id)).filter(Boolean);
  const pairs = [];
  for (let i = 0; i < sectors.length; i += 2) pairs.push(sectors.slice(i, i + 2));
  return [
    ...['ma', 'pe', 'vc', 'ipo'].map(tab => ({ label: TABS[tab].label, q: TABS[tab].query })),
    ...pairs.map(p => ({ label: p.map(s => s.label).join(' + '), q: `${TABS.sector.query} (${p.map(s => s.q).join(' OR ')})` })),
    { label: 'Competitors', q: quoted(DEFAULTS.competitors.slice(0, 10)) },
    { label: 'Watchlist', q: quoted(DEFAULTS.watchlist.slice(0, 10)) },
  ];
}

export async function readAgentState(region, opts) {
  return (await readJson(stateName(region), opts)) ?? { region, items: [], runs: [] };
}

export async function runAgent(region, { key = process.env.BRAVE_API_KEY, search = braveNews, pauseMs = 1100 } = {}) {
  if (!key) throw new Error('BRAVE_API_KEY is not set');
  const prev = await readAgentState(region, { fresh: true });
  const started = Date.now();
  await writeJson(stateName(region), { ...prev, attemptedAt: new Date(started).toISOString() });

  const freshness = prev.items.length ? 'pd' : 'pw'; // first run backfills a week
  const found = [];
  const errors = [];
  const queries = agentQueries();
  for (const [i, { label, q }] of queries.entries()) {
    if (i) await sleep(pauseMs); // free plan: 1 request/second
    try {
      const items = await search(q, { region, freshness, key });
      for (const it of items) it.fetchedAt = new Date().toISOString();
      found.push(...items);
    } catch (err) {
      errors.push({ label, error: String(err?.message ?? err) });
    }
  }

  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const byLink = new Map();
  for (const it of [...found, ...prev.items]) {
    if (!byLink.has(it.link) && (!it.pubDate || Date.parse(it.pubDate) > cutoff)) byLink.set(it.link, it);
  }
  const items = [...byLink.values()]
    .sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0))
    .slice(0, MAX_ITEMS);
  const summary = {
    at: new Date().toISOString(), ms: Date.now() - started, queries: queries.length,
    found: found.length, newItems: items.length - prev.items.filter(i => byLink.has(i.link)).length,
    errors,
  };
  const state = {
    region, updatedAt: summary.at, attemptedAt: new Date(started).toISOString(),
    items, runs: [summary, ...(prev.runs ?? [])].slice(0, 20),
  };
  await writeJson(stateName(region), state);
  return summary;
}

// Called from the feed API: refresh in the background when results are stale.
const running = new Map(); // region -> promise (one run per instance at a time)
const isStale = state => Date.now() - (Date.parse(state.attemptedAt ?? '') || 0) >= intervalMin() * 60000;

export async function refreshIfStale(region) {
  if (!agentEnabled() || !agentRegions().includes(region)) return null;
  if (running.has(region)) return running.get(region);
  // Cheap memoised check first, then a fresh read before committing to a run.
  if (!isStale(await readAgentState(region))) return null;
  if (!isStale(await readAgentState(region, { fresh: true }))) return null;
  const p = runAgent(region).finally(() => running.delete(region));
  running.set(region, p);
  return p;
}

export function agentStatus(state) {
  return {
    enabled: agentEnabled(),
    intervalMin: intervalMin(),
    updatedAt: state?.updatedAt ?? null,
    stories: state?.items?.length ?? 0,
    lastRun: state?.runs?.[0] ?? null,
  };
}
