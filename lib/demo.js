// Demo mode: fictitious headlines so the UI can be previewed without network
// access (DEMO_MODE=1 or ?demo=1). Every item is labelled "Demo" in the UI.

import { buildFeed } from './aggregate.js';

const H = [
  ['Northwind Pharma to acquire Helix Diagnostics for $420 million', 'ma'],
  ['Aurora Foods agrees to buy 51% stake in Crumb & Co for Rs 850 crore', 'ma'],
  ['Kestrel Logistics merges with BlueLine Freight to create regional 3PL leader', 'ma'],
  ['Pinnacle Bank acquires digital lender QuickCred in all-stock deal', 'ma'],
  ['Solace Energy to be acquired by Meridian Infrastructure Partners for $1.2 billion', 'ma'],
  ['Vertex Chemicals completes acquisition of Polymark Coatings', 'ma'],
  ['Summit Hospitals buys Lakeside Clinic chain for ₹1,200 crore', 'ma'],
  ['Orbit Capital closes fourth growth fund at $750 million', 'pe'],
  ['Granite Peak Partners announces final close of Fund III at $1.1 billion', 'pe'],
  ['Harbor PE firm sells entire stake in Zenith Auto Components to strategic buyer', 'pe'],
  ['Evergreen Equity leads buyout of Crestline Packaging', 'pe'],
  ['Private equity major Atlas invests $150 million in renewable platform SunGrid', 'pe'],
  ['Ledgerly raises $35 million in Series B funding led by Beacon Ventures', 'vc'],
  ['AgriNext secures $8 million seed round to expand farm-to-fork platform', 'vc'],
  ['CloudNest raises $120 million Series D to scale AI data centres', 'vc'],
  ['MediTrack raises Rs 90 crore in Series A for hospital software', 'vc'],
  ['VoltRide EV startup raises $22 million in Series B funding', 'vc'],
  ['Crescent Retail files DRHP for Rs 2,500 crore IPO', 'ipo'],
  ['Skyline Infra IPO subscribed 12 times on final day; anchor investors include top funds', 'ipo'],
  ['BrightLearn edtech plans $300 million IPO next year', 'ipo'],
  ['Avendus advises Northwind Pharma on Helix Diagnostics acquisition', 'watch'],
  ['Houlihan Lokey named financial adviser on Solace Energy sale', 'watch'],
  ['Reliance Industries to acquire majority stake in regional FMCG brand for $90 million', 'watch'],
  ['Tata Group in talks to buy semiconductor packaging unit', 'watch'],
];

const SOURCES = ['Demo Wire', 'Demo Business Daily', 'Demo Deal Journal', 'Demo Markets'];

function demoFetcher(tab) {
  const now = Date.now();
  return async () => {
    const rows = H.filter(([, t]) => t === tab || tab === 'sector' || tab === 'watch');
    const items = rows.map(([title], i) => ({
      title: `${title} - ${SOURCES[i % SOURCES.length]}`,
      link: `https://example.com/demo/${i}`,
      pubDate: new Date(now - (i * 97 + 13) * 60 * 1000).toUTCString(),
      description: '',
      source: SOURCES[i % SOURCES.length],
    }));
    return items;
  };
}

export async function buildDemoFeed(params) {
  // Only query one "source" so every headline appears once.
  const feed = await buildFeed({ ...params, sectors: params.tab === 'sector' ? params.sectors : [], customFeeds: [] },
    demoFetcher(params.tab));
  feed.demo = true;
  return feed;
}
