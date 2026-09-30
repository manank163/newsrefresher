import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapBraveResults } from '../lib/brave.js';
import { agentQueries, readAgentState, runAgent } from '../lib/agent.js';
import { buildFeed } from '../lib/aggregate.js';

const region = `test${process.pid}`;
const hoursAgo = h => new Date(Date.now() - h * 36e5).toISOString().replace(/\.\d+Z$/, '');

test('maps Brave news results (strips HTML, treats page_age as UTC)', () => {
  const [r] = mapBraveResults({ results: [{ title: 'Acme <strong>acquires</strong> Beta', url: 'https://x.com/a',
    description: 'Deal &amp; more', page_age: '2026-09-30T08:00:00', meta_url: { hostname: 'www.x.com' } }] });
  assert.deepEqual(r, { title: 'Acme acquires Beta', link: 'https://x.com/a', pubDate: '2026-09-30T08:00:00.000Z', description: 'Deal & more', source: 'x.com' });
});

test('agent query plan stays small enough for a free Brave plan', () => {
  const q = agentQueries();
  assert.ok(q.length <= 10, `${q.length} queries per run`);
  assert.ok(q.every(x => x.q.length <= 390));
});

test('agent run merges, dedupes and feeds into buildFeed', async () => {
  let calls = 0;
  const search = async (q, opts) => {
    calls++;
    assert.equal(opts.freshness, 'pw', 'first run backfills a week');
    return [
      { title: 'Northwind to acquire Helix for $420 million', link: 'https://news.example/1', pubDate: new Date(hoursAgo(2) + 'Z').toISOString(), description: '', source: 'news.example' },
      { title: 'Ancient deal', link: 'https://news.example/old', pubDate: '2020-01-01T00:00:00.000Z', description: '', source: 'news.example' },
    ];
  };
  const summary = await runAgent(region, { key: 'k', search, pauseMs: 0 });
  assert.equal(calls, agentQueries().length);
  assert.equal(summary.errors.length, 0);
  const state = await readAgentState(region, { fresh: true });
  assert.deepEqual(state.items.map(i => i.link), ['https://news.example/1'], 'deduped, stale item dropped');

  // Second run: failures are recorded, existing items kept.
  const s2 = await runAgent(region, { key: 'k', search: async () => { throw new Error('Brave HTTP 429'); }, pauseMs: 0 });
  assert.equal(s2.errors[0].error, 'Brave HTTP 429');
  assert.equal((await readAgentState(region, { fresh: true })).items.length, 1);

  const feed = await buildFeed({ tab: 'ma', region, window: '1d', includeAgent: true },
    async url => (url.startsWith('agent:') ? (await readAgentState(url.slice(6))).items : []));
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].origin, 'brave');
});
