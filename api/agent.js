// /api/agent            -> run the Brave news agent now (cron or manual; needs CRON_SECRET)
// /api/agent?status=1   -> public status: last run, story counts (no secrets)

import { agentEnabled, agentRegions, agentStatus, readAgentState, runAgent } from '../lib/agent.js';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const regions = agentRegions();
  if (url.searchParams.has('status')) {
    const states = await Promise.all(regions.map(r => readAgentState(r, { fresh: true })));
    return send(res, 200, Object.fromEntries(regions.map((r, i) => [r, agentStatus(states[i])])));
  }
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || url.searchParams.get('secret');
  if (!secret || given !== secret) return send(res, 401, { error: 'Unauthorized: pass CRON_SECRET as a Bearer token or ?secret=' });
  if (!agentEnabled()) return send(res, 503, { error: 'BRAVE_API_KEY is not set on this deployment' });
  const out = {};
  for (const r of regions) {
    try { out[r] = await runAgent(r); } catch (err) { out[r] = { error: String(err?.message ?? err) }; }
  }
  send(res, 200, out);
}
