// Central configuration: tabs, sectors, regions and default source feeds.
// Everything the UI shows (sector list, regions, defaults) is served from here
// via /api/config so there is a single place to tune queries.

export const REGIONS = {
  global: { label: 'Global', hl: 'en-US', gl: 'US', ceid: 'US:en', mkt: 'en-US' },
  IN: { label: 'India', hl: 'en-IN', gl: 'IN', ceid: 'IN:en', mkt: 'en-IN' },
  UK: { label: 'United Kingdom', hl: 'en-GB', gl: 'GB', ceid: 'GB:en', mkt: 'en-GB' },
  SG: { label: 'Singapore / SEA', hl: 'en-SG', gl: 'SG', ceid: 'SG:en', mkt: 'en-SG' },
  AE: { label: 'Middle East (UAE)', hl: 'en-AE', gl: 'AE', ceid: 'AE:en', mkt: 'en-AE' },
  AU: { label: 'Australia', hl: 'en-AU', gl: 'AU', ceid: 'AU:en', mkt: 'en-AU' },
};

export const WINDOWS = { '1d': 1, '3d': 3, '7d': 7 };

// `query` is what we send to the news search engines; `match` decides whether a
// returned headline is actually relevant (search engines are noisy).
export const TABS = {
  ma: {
    label: 'M&A News',
    query: '(acquisition OR acquires OR "to acquire" OR merger OR takeover OR "stake sale" OR "to buy")',
    match: /\b(acquir\w*|acquisition\w*|merger\w*|merges?|merged|takeover|take over|buys?|to buy|stake|divest\w*|carve[- ]out|deal)\b/i,
    feeds: [
      { name: 'Mint · Companies', url: 'https://www.livemint.com/rss/companies' },
    ],
  },
  pe: {
    label: 'PE Tracker',
    query: '("private equity" OR buyout OR "fund close" OR "final close" OR "growth equity" OR "PE firm" OR "PE fund")',
    match: /\b(private equity|buyout|PE (firm|fund|investor|major|backed)|fund (close|closing)|(first|final) close|growth equity|LBO|take[- ]private|portfolio company|exit\w*|secondar(y|ies))\b/i,
    feeds: [
      { name: 'PE Hub', url: 'https://www.pehub.com/feed/' },
    ],
  },
  vc: {
    label: 'VC Tracker',
    query: '("funding round" OR "Series A" OR "Series B" OR "Series C" OR "seed round" OR "raises" OR "venture capital")',
    match: /\b(funding|raises?|raised|series [a-h]|seed|pre-seed|venture|VC|round|backed)\b/i,
    feeds: [
      { name: 'TechCrunch · Venture', url: 'https://techcrunch.com/category/venture/feed/' },
      { name: 'Entrackr', url: 'https://entrackr.com/feed/' },
      { name: 'Inc42', url: 'https://inc42.com/feed/' },
    ],
  },
  ipo: {
    label: 'IPO Watch',
    query: '(IPO OR "initial public offering" OR DRHP OR "files for listing" OR "public listing")',
    match: /\b(IPO|initial public offering|DRHP|RHP|listing|lists? on|debut\w*|anchor investors|grey market|GMP|SPAC)\b/i,
    feeds: [],
  },
  // Sector tab: any deal activity inside the chosen sector.
  sector: {
    label: 'Sector Watch',
    query: '(acquisition OR merger OR "private equity" OR funding OR stake OR IPO OR investment)',
    match: /\b(acquir\w*|acquisition|merger|stake|private equity|buyout|funding|raises?|series [a-h]|IPO|invest\w*|deal)\b/i,
    feeds: [],
  },
  // Watch tab: free-form list of names (competitors, target companies...).
  watch: { label: 'Watchlist', query: '', match: null, feeds: [] },
};

// `q` is a short OR-list for search queries (engines cap query length);
// `kw` is the longer regex used to tag every story with sectors.
export const SECTORS = [
  { id: 'healthcare', label: 'Healthcare & Pharma', q: 'healthcare OR hospital OR pharma OR diagnostics',
    kw: /\b(health\w*|hospital\w*|pharma\w*|diagnostic\w*|medtech|medical|biotech\w*|clinic\w*|drug\w*|CDMO|API maker|life ?sciences?)\b/i },
  { id: 'fs', label: 'Financial Services', q: 'bank OR NBFC OR insurance OR fintech OR "asset management"',
    kw: /\b(bank\w*|NBFC|insur\w*|fintech|lend\w*|payments?|asset manag\w*|wealth|broking|brokerage|microfinance|credit)\b/i },
  { id: 'tech', label: 'Technology & SaaS', q: 'software OR SaaS OR "IT services" OR AI OR cybersecurity',
    kw: /\b(software|SaaS|IT services|tech(nology)?|AI|artificial intelligence|cyber\w*|cloud|data cent(er|re)s?|semiconductor\w*|digital)\b/i },
  { id: 'consumer', label: 'Consumer & Retail', q: 'consumer OR retail OR FMCG OR "D2C" OR brand',
    kw: /\b(consumer|retail\w*|FMCG|D2C|e-?commerce|apparel|fashion|beauty|personal care|restaurant\w*|QSR|food(s)?|beverage\w*|brand)\b/i },
  { id: 'industrials', label: 'Industrials & Manufacturing', q: 'manufacturing OR industrial OR engineering OR "auto components"',
    kw: /\b(manufactur\w*|industrial\w*|engineering|machinery|auto ?components?|precision|steel|cement|capital goods|aerospace|defen[cs]e)\b/i },
  { id: 'energy', label: 'Energy & Renewables', q: 'renewable OR solar OR wind OR energy OR "green hydrogen"',
    kw: /\b(renewable\w*|solar|wind|energy|power|green hydrogen|battery|batteries|oil|gas|utilities|EV charging|transmission)\b/i },
  { id: 'infra', label: 'Infrastructure & Real Estate', q: 'infrastructure OR "real estate" OR highway OR ports OR warehousing',
    kw: /\b(infrastructure|infra|real estate|realty|highway\w*|roads?|ports?|airports?|warehous\w*|REIT|InvIT|construction)\b/i },
  { id: 'auto', label: 'Automotive & EV', q: 'automotive OR "electric vehicle" OR EV OR mobility',
    kw: /\b(auto(motive|mobile)?s?|electric vehicles?|EVs?|two-wheeler\w*|mobility|car ?maker\w*|OEM)\b/i },
  { id: 'chemicals', label: 'Chemicals & Materials', q: 'chemicals OR "specialty chemicals" OR materials OR packaging',
    kw: /\b(chemical\w*|materials|packaging|plastics?|polymers?|agrochemical\w*|fertili[sz]er\w*|paints?|coatings?)\b/i },
  { id: 'agri', label: 'Agri & Food Processing', q: 'agritech OR agriculture OR "food processing" OR dairy',
    kw: /\b(agri\w*|farm\w*|food processing|dairy|seeds?|crop\w*|aqua\w*|poultry)\b/i },
  { id: 'logistics', label: 'Logistics & Transport', q: 'logistics OR "supply chain" OR shipping OR freight',
    kw: /\b(logistic\w*|supply chain|shipping|freight|courier|3PL|cold chain|trucking|aviation|airline\w*)\b/i },
  { id: 'media', label: 'Media, Telecom & Education', q: 'media OR telecom OR edtech OR education OR gaming',
    kw: /\b(media|telecom\w*|broadcast\w*|OTT|edtech|education|school\w*|gaming|entertainment|advertising|publishing)\b/i },
];

export const DEFAULTS = {
  region: 'IN',
  window: '3d',
  refreshMin: 10,
  sectors: ['healthcare', 'fs', 'tech', 'consumer', 'industrials', 'energy'],
  competitors: [
    'Avendus', 'Equirus', 'o3 Capital', 'Kotak Investment Banking', 'JM Financial',
    'Ambit', 'Motilal Oswal', 'Houlihan Lokey', 'Rothschild & Co', 'Lazard',
  ],
  watchlist: ['Reliance Industries', 'Tata Group', 'Adani', 'Mahindra', 'Aditya Birla'],
  customFeeds: [],
};

export function publicConfig() {
  return {
    regions: Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [k, v.label])),
    windows: Object.keys(WINDOWS),
    tabs: Object.fromEntries(Object.entries(TABS).map(([k, v]) => [k, {
      label: v.label, feeds: v.feeds.map(f => f.name),
    }])),
    sectors: SECTORS.map(({ id, label }) => ({ id, label })),
    defaults: DEFAULTS,
  };
}
