# Deal Pulse

A live M&A / private equity / venture news portal. It pulls headlines from Google News, Bing News and trade RSS feeds, filters them for deal relevance, tags each story by sector, and parses out the deal type, buyer, target and disclosed value. The page refreshes itself on a timer.

## Tabs (v0.1)

| Tab | What it shows |
| --- | --- |
| **Dashboard** | 24h counts per feed, largest disclosed deals, sector heat for your tracked sectors, latest M&A / PE / VC |
| **M&A News** | Acquisitions, mergers, stake sales, takeovers |
| **Deal Radar** | Sortable table of parsed deals (buyer, target, type, value ≈ USD), CSV export |
| **PE Tracker** | Fund closes, buyouts, PE investments, exits |
| **VC Tracker** | Seed to late-stage rounds, with round and lead investor |
| **IPO Watch** | DRHP filings, launches, subscriptions, listings |
| **Sector Watch** | All deal activity in one sector (12 sectors) |
| **Competitive Intel** | Mentions of competing advisory firms (editable list) |
| **Company Watchlist** | Mentions of companies you follow (editable list) |
| **Settings** | Region, time window, refresh interval, tracked sectors, lists, extra RSS feeds |

Screener, Alerts & Digest and Leads show in the sidebar as "Soon".

Every feed view has search, sector and deal-type filters, a region and time-window switcher, **NEW** markers for stories published since your last visit, CSV export, and Print / PDF.

## Run locally

Requires Node 18+. There are no dependencies to install.

```bash
npm run dev     # live data   → http://localhost:3000
npm run demo    # fictitious demo data, no internet needed
npm test        # unit tests
```

You can also append `?demo=1` to any URL to preview with demo data.

## Deploy (Vercel)

1. Import this repo into Vercel (Framework preset: **Other**, no build command).
2. Deploy. `vercel.json` serves `public/` as the site and `api/*.js` as serverless functions.

API responses are edge-cached for 10 minutes (`s-maxage=600`), so any number of users only hits the news sources a few times an hour.

## How it works

```
api/feed.js      GET /api/feed?tab=ma|pe|vc|ipo|sector|watch&region=IN&window=3d&sectors=…&terms=…
api/config.js    GET /api/config  (tabs, sectors, regions, defaults for the UI)
lib/config.js    ← tune search queries, relevance filters, sectors, default lists and feeds here
lib/aggregate.js fetch all sources in parallel → normalise → relevance filter → dedupe → tag
lib/extract.js   headline → deal type, value (₹ crore, $, €, £ …), buyer, target, round
lib/rss.js       dependency-free RSS/Atom parser
public/          single-page front-end (vanilla JS, no build step)
```

- One failing source doesn't break a feed. Each view has a "source queries · N failed" list at the bottom.
- Deal values are converted to USD with fixed rough FX rates **for ranking only**. Use the original amount shown next to it.
- Buyer/target extraction is regex-based. It covers common headline shapes ("A to acquire B", "B acquired by A", "X raises $Nm led by Y") and leaves the field blank when it can't tell.
- Settings live in the browser's localStorage, so they're per user and per device for now.

## Roadmap ideas

- Daily email / Slack / Teams digest of new deals (Vercel Cron)
- Persist stories in Supabase for history, trend charts and deduplication across days
- Screener tab with market data (needs a data API key, e.g. FMP)
- LLM summarisation and better entity extraction for each deal
- Shared team watchlists and login
