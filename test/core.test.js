import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../lib/rss.js';
import { classify, extractAmount, extractDeal } from '../lib/extract.js';
import { buildFeed, isSafeFeedUrl, normalise, planSources } from '../lib/aggregate.js';
import { parseParams } from '../api/feed.js';

const now = new Date().toUTCString();
const GOOGLE_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Northwind to acquire Helix for $420 million - Mint</title>
<link>https://news.google.com/rss/articles/abc</link><pubDate>${now}</pubDate>
<description>&lt;a href="x"&gt;Northwind to acquire Helix for $420 million&lt;/a&gt;&amp;nbsp;Mint</description>
<source url="https://www.livemint.com">Mint</source></item>
<item><title><![CDATA[Cricket: India win the series - ESPN]]></title>
<link>https://news.google.com/rss/articles/def</link><pubDate>${now}</pubDate></item>
<item><title>Top 2 stocks to buy or sell for short-term: Cyient - Mint</title>
<link>https://news.google.com/rss/articles/tip</link><pubDate>${now}</pubDate></item>
<item><title>Old deal: Foo buys Bar - Reuters</title>
<link>https://news.google.com/rss/articles/old</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const BING_RSS = `<rss xmlns:News="https://www.bing.com/news/search?q=x&amp;format=rss"><channel>
<item><title>Northwind to acquire Helix for $420 million</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.example.com%2fstory&amp;c=1</link>
<description>Northwind Pharma agreed to buy diagnostics firm Helix.</description>
<pubDate>${now}</pubDate><News:Source>Example Times</News:Source></item>
</channel></rss>`;

test('parses RSS items incl. CDATA, entities and source', () => {
  const items = parseFeed(GOOGLE_RSS);
  assert.equal(items.length, 4);
  assert.equal(items[0].source, 'Mint');
  assert.equal(items[1].title, 'Cricket: India win the series - ESPN');
});

test('parses Atom entries', () => {
  const items = parseFeed(`<feed><entry><title>Hello &amp; bye</title><link rel="alternate" href="https://a.com/1"/><updated>2026-01-01T00:00:00Z</updated></entry></feed>`);
  assert.deepEqual(items.map(i => [i.title, i.link]), [['Hello & bye', 'https://a.com/1']]);
});

test('normalise strips publisher suffix and unwraps Bing links', () => {
  const g = normalise(parseFeed(GOOGLE_RSS)[0], { kind: 'google', name: 'Google News' });
  assert.equal(g.title, 'Northwind to acquire Helix for $420 million');
  assert.equal(g.summary, '');
  const b = normalise(parseFeed(BING_RSS)[0], { kind: 'bing', name: 'Bing News' });
  assert.equal(b.link, 'https://www.example.com/story');
  assert.equal(b.source, 'Example Times');
});

test('amounts: currencies, units and Indian crore', () => {
  assert.deepEqual(extractAmount('deal worth $1.2 billion'), { text: '$1.2 billion', currency: 'USD', usdM: 1200 });
  assert.equal(extractAmount('for Rs 850 crore').usdM, 96.6);
  assert.equal(extractAmount('₹1,200 crore buyout').currency, 'INR');
  assert.equal(extractAmount('€300m bid').usdM, 330);
  assert.equal(extractAmount('shares rise to $45'), null);
});

test('classifies deal types', () => {
  assert.equal(classify('Acme files DRHP for IPO'), 'IPO');
  assert.equal(classify('Granite Peak announces final close of Fund III'), 'Fund close');
  assert.equal(classify('Ledgerly raises $35 million in Series B funding'), 'Funding round');
  assert.equal(classify('A and B announce merger'), 'Merger');
  assert.equal(classify('PE firm sells entire stake in Zenith'), 'Exit');
  assert.equal(classify('Northwind to acquire Helix'), 'Acquisition');
  assert.equal(classify('Monsoon arrives early'), null);
});

test('extracts parties', () => {
  let d = extractDeal('Exclusive: Blackstone to buy majority stake in Acme Labs for $2.1 billion - sources');
  assert.equal(d.acquirer, 'Blackstone');
  assert.equal(d.target, 'Acme Labs');
  d = extractDeal('Solace Energy to be acquired by Meridian Partners for $1.2 billion');
  assert.deepEqual([d.acquirer, d.target], ['Meridian Partners', 'Solace Energy']);
  d = extractDeal('Ledgerly raises $35 million in Series B funding led by Beacon Ventures');
  assert.deepEqual([d.acquirer, d.target, d.round], ['Beacon Ventures', 'Ledgerly', 'Series B']);
  d = extractDeal('TalentX to acquire 80% of Tokyo recruiter Agent Cube');
  assert.equal(d.target, 'Tokyo recruiter Agent Cube');
  d = extractDeal('Evergreen Equity leads buyout of Crestline Packaging');
  assert.deepEqual([d.type, d.acquirer, d.target], ['Buyout', 'Evergreen Equity', 'Crestline Packaging']);
});

test('buildFeed filters irrelevant/old stories, dedupes across sources and tags sectors', async () => {
  const fetcher = async url => parseFeed(url.includes('bing.com') ? BING_RSS : url.includes('google') ? GOOGLE_RSS : '');
  const feed = await buildFeed({ tab: 'ma', region: 'IN', window: '3d', sectors: ['healthcare'] }, fetcher);
  assert.equal(feed.items.length, 1, 'cricket is irrelevant, 2024 story is outside window, bing dupe merged');
  const [item] = feed.items;
  assert.equal(item.deal.amountUsdM, 420);
  assert.ok(item.alsoIn.includes('Example Times'));
  assert.ok(feed.sources.every(s => s.ok));
});

test('buildFeed reports failing sources without failing the whole feed', async () => {
  const fetcher = async url => { if (url.includes('bing')) throw new Error('HTTP 503'); return parseFeed(GOOGLE_RSS); };
  const feed = await buildFeed({ tab: 'ma', region: 'global', window: '1d' }, fetcher);
  assert.equal(feed.items.length, 1);
  assert.ok(feed.sources.some(s => !s.ok && s.error === 'HTTP 503'));
});

test('watch tab keeps only stories naming a tracked term', async () => {
  const fetcher = async () => parseFeed(GOOGLE_RSS);
  const feed = await buildFeed({ tab: 'watch', region: 'IN', window: '3d', terms: ['Helix', 'Zenith'] }, fetcher);
  assert.deepEqual(feed.items.map(i => i.matched), [['Helix']]);
});

test('source plan: per-sector queries, region edition, custom feed guard', () => {
  const plan = planSources({ tab: 'pe', region: 'IN', window: '1d', sectors: ['fs', 'tech'],
    customFeeds: ['https://example.com/feed', 'http://127.0.0.1/admin', 'file:///etc/passwd'] });
  const google = plan.filter(p => p.kind === 'google');
  assert.equal(google.length, 3);
  assert.match(google[0].url, /gl=IN/);
  assert.match(decodeURIComponent(google[0].url), /when:1d/);
  assert.deepEqual(plan.filter(p => p.url.includes('example.com')).length, 1);
  assert.equal(isSafeFeedUrl('http://localhost:3000'), false);
  assert.equal(isSafeFeedUrl('http://192.168.1.1/rss'), false);
});

test('API param validation', () => {
  assert.ok(parseParams(new URLSearchParams('tab=nope')).error);
  assert.ok(parseParams(new URLSearchParams('tab=sector')).error);
  const { params } = parseParams(new URLSearchParams('tab=ma&region=XX&window=9d&sectors=fs,bogus'));
  assert.deepEqual([params.region, params.window, params.sectors], ['global', '3d', ['fs']]);
});
