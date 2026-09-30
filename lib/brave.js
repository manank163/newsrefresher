// Brave Search News API client. Docs: https://api-dashboard.search.brave.com/app/documentation/news-search
import { stripHtml } from './rss.js';

const ENDPOINT = 'https://api.search.brave.com/res/v1/news/search';
const COUNTRY = { global: 'ALL', IN: 'IN', UK: 'GB', SG: 'SG', AE: 'AE', AU: 'AU' };

// Brave returns page_age like "2026-09-30T08:12:03" (UTC, no zone).
function toIso(pageAge) {
  if (!pageAge) return '';
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(pageAge) ? pageAge : `${pageAge}Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

export function mapBraveResults(json) {
  return (json?.results ?? []).map(r => ({
    title: stripHtml(r.title),
    link: r.url,
    pubDate: toIso(r.page_age),
    description: stripHtml(r.description),
    source: r.meta_url?.hostname?.replace(/^www\./, '') ?? '',
  })).filter(r => r.title && r.link);
}

export async function braveNews(query, { region = 'global', freshness = 'pd', count = 50, key, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    q: query.slice(0, 390), country: COUNTRY[region] ?? 'ALL', search_lang: 'en',
    count: String(count), freshness, spellcheck: '0', safesearch: 'off',
  });
  const res = await fetchImpl(`${ENDPOINT}?${params}`, {
    headers: { accept: 'application/json', 'x-subscription-token': key },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  return mapBraveResults(await res.json());
}
