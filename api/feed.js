// GET /api/feed?tab=ma|pe|vc|ipo|sector|watch&region=IN&window=3d
//   &sectors=healthcare,fs   (tag + extra per-sector queries; required for tab=sector)
//   &terms=Avendus|Equirus   (tab=watch only)
//   &feeds=https://a/rss|... (extra RSS feeds)
//   &demo=1                  (fictitious data, for previews)

import { REGIONS, SECTORS, TABS, WINDOWS } from '../lib/config.js';
import { buildFeed } from '../lib/aggregate.js';
import { buildDemoFeed } from '../lib/demo.js';
import { agentEnabled, agentRegions, agentStatus, readAgentState, refreshIfStale } from '../lib/agent.js';

// Lets the agent refresh after the response is sent (no-op outside Vercel).
async function inBackground(promise) {
  promise.catch(err => console.error('agent refresh failed:', err));
  try { (await import('@vercel/functions')).waitUntil(promise); } catch { /* local dev: just let it run */ }
}

const list = (v, sep) => (v ? v.split(sep).map(s => s.trim()).filter(Boolean) : []);

export function parseParams(searchParams) {
  const tab = searchParams.get('tab') ?? 'ma';
  const region = searchParams.get('region') ?? 'global';
  const window = searchParams.get('window') ?? '3d';
  const params = {
    tab,
    region: REGIONS[region] ? region : 'global',
    window: WINDOWS[window] ? window : '3d',
    sectors: list(searchParams.get('sectors'), ',').filter(id => SECTORS.some(s => s.id === id)).slice(0, 12),
    terms: list(searchParams.get('terms'), '|').map(t => t.slice(0, 60)).slice(0, 30),
    customFeeds: list(searchParams.get('feeds'), '|').slice(0, 10),
  };
  if (!TABS[tab]) return { error: `Unknown tab "${tab}"` };
  if (tab === 'sector' && !params.sectors.length) return { error: 'tab=sector needs sectors=<id>' };
  if (tab === 'watch' && !params.terms.length) return { error: 'tab=watch needs terms=a|b' };
  return { params };
}

function send(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', cacheSeconds
    ? `public, max-age=60, s-maxage=${cacheSeconds}, stale-while-revalidate=1800`
    : 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { params, error } = parseParams(url.searchParams);
  if (error) return send(res, 400, { error });
  const demo = process.env.DEMO_MODE === '1' || url.searchParams.get('demo') === '1';
  try {
    const useAgent = !demo && agentEnabled() && agentRegions().includes(params.region);
    const feed = demo ? await buildDemoFeed(params) : await buildFeed({ ...params, includeAgent: useAgent });
    const agent = useAgent ? agentStatus(await readAgentState(params.region)) : { enabled: false };
    send(res, 200, { ...feed, agent, region: params.region, window: params.window }, demo ? 0 : 600);
    if (useAgent) await inBackground(refreshIfStale(params.region));
  } catch (err) {
    send(res, 500, { error: String(err?.message ?? err) });
  }
}
