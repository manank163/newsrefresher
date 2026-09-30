// Heuristic deal extraction from headlines: deal type, disclosed value,
// parties (acquirer / target) and funding round. Regex-based on purpose:
// fast, free and transparent. Anything it can't parse is simply left blank.

// Rough FX to USD, only used to rank/sort deal sizes. Not for valuation work.
const FX_TO_USD = { USD: 1, INR: 1 / 88, EUR: 1.1, GBP: 1.3, SGD: 0.78, AED: 0.27, AUD: 0.66, BRL: 0.18, JPY: 0.0067, CAD: 0.73 };

const CURRENCY = [
  [/^(US\$|USD)$/i, 'USD'], [/^S\$|SGD$/i, 'SGD'], [/^A\$|AUD$/i, 'AUD'], [/^R\$|BRL$/i, 'BRL'],
  [/^C\$|CAD$/i, 'CAD'], [/^\$$/, 'USD'], [/^(₹|Rs\.?|INR)$/i, 'INR'], [/^(€|EUR)$/i, 'EUR'],
  [/^(£|GBP)$/i, 'GBP'], [/^AED$/i, 'AED'], [/^(¥|JPY)$/i, 'JPY'],
];

const UNITS = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mn: 1e6, mln: 1e6, m: 1e6,
  crore: 1e7, crores: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, k: 1e3, thousand: 1e3 };

const AMOUNT_RE = /(US\$|USD|S\$|A\$|R\$|C\$|\$|₹|Rs\.?|INR|€|EUR|£|GBP|AED|SGD|AUD|BRL|JPY|¥)\s?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(billion|bn|million|mn|mln|crores?|cr|lakhs?|thousand|[bmk])\b)?/gi;

export function extractAmount(text) {
  let best = null;
  for (const m of String(text ?? '').matchAll(AMOUNT_RE)) {
    const cur = CURRENCY.find(([re]) => re.test(m[1]))?.[1];
    if (!cur) continue;
    const num = parseFloat(m[2].replace(/,/g, ''));
    const unit = m[3]?.toLowerCase();
    const mult = unit ? UNITS[unit] : 1;
    const value = num * mult;
    // A bare "$5" is noise (share prices etc.); require a unit or a big number.
    if (!unit && value < 100000) continue;
    const usdM = (value * FX_TO_USD[cur]) / 1e6;
    if (!best || usdM > best.usdM) best = { text: m[0].trim(), currency: cur, usdM: Math.round(usdM * 10) / 10 };
  }
  return best;
}

const TYPES = [
  ['IPO', /\b(IPO|initial public offering|DRHP|files? for (a )?listing|SPAC)\b/i],
  ['Fund close', /\b((first|final|interim) close|closes? (its |a |an )?[\w$€£₹.\s-]{0,30}fund\b|raises? [\w$€£₹.,\s-]{0,30}\bfund\b(?! round)|fund (I{1,3}|IV|VI{0,3}|IX|X|\d+)\b)/i],
  ['Funding round', /\b(series [a-h]\b|pre-seed|seed (round|funding)|funding round|bridge round|raises? [\w$€£₹.,\s-]{0,40}\b(funding|round|capital)|secures? [\w$€£₹.,\s-]{0,30}\bfunding)/i],
  ['Buyout', /\b(buyout|take[- ]private|LBO|management buy-?in)\b/i],
  ['Merger', /\b(merger|merges?|merged|amalgamat\w*)\b/i],
  ['Exit', /\b(exits?|exited|sells? (its |entire |partial |part of its )?(entire |residual )?stake|offloads?|divests?|divestment)\b/i],
  ['Stake', /\bstake\b/i],
  ['Investment', /\b(invests?|invested|investment in|backs|to invest)\b/i],
  ['Acquisition', /\b(acquir\w*|acquisition|buys?|to buy|takeover|takes over|snaps up|picks up)\b/i],
];

export function classify(text) {
  const s = String(text ?? '');
  return TYPES.find(([, re]) => re.test(s))?.[0] ?? null;
}

const ROUND_RE = /\b(pre-seed|seed|pre-series [a-h]|series [a-h]\d?)\b/i;

const FWD = /^(.+?)\s+(?:to acquire|acquires|has acquired|acquired|agrees to (?:buy|acquire)|agreed to (?:buy|acquire)|to buy|buys|completes (?:the )?(?:acquisition|purchase) of|announces (?:the )?acquisition of|snaps up|picks up|to take over|takes over|in talks to (?:buy|acquire)|bids for|to merge with|merges with|invests in|to invest in|leads)\s+(.+)$/i;
const REV = /^(.+?)\s+(?:to be acquired by|acquired by|bought by|sold to|to be bought by|agrees to be acquired by|gets investment from|raises .{0,40}? from|secures .{0,40}? from)\s+(.+)$/i;
const TAIL = /\s+(?:for|at|valued|worth|in (?:a|an|all-\S+|cash|stock)\b|in \S+ deal|from|to (?:create|expand|strengthen|bolster|enter|boost|build|form|grow)|amid|as|after|via|led by|with|—|–|-)\s.*$|[,:;|].*$|\s[-–—]\s.*$/i;
const LEAD = /^(?:(?:a|an|the)\s+)?(?:(?:\d+(?:\.\d+)?%|majority|minority|controlling|significant|strategic|remaining|additional|further|residual|partial)\s+)*(?:stake|interest|shareholding|equity)\s+in\s+/i;

function clean(s, isTarget) {
  let out = String(s ?? '').trim();
  if (isTarget) out = out.replace(LEAD, '').replace(TAIL, '');
  // "Exclusive: X to buy Y" / "Report - X ..."
  out = out.replace(/^.*?(?:exclusive|breaking|report|update|deals?|m&a)\s*[:|\-–—]\s*/i, '');
  out = out.replace(/^['"‘“]|['"’”.,]$/g, '').trim();
  if (!out || out.length > 60 || out.split(/\s+/).length > 8) return null;
  return out;
}

const RAISER = /^(.+?)\s+(?:raises|raised|secures|bags|gets|lands|closes|nets)\s/i;
const LED_BY = /\b(?:led|co-led) by\s+(.+?)(?:,|;|\s+(?:and|with|alongside)\s+(?:participation|existing|others)|$)/i;

export function extractParties(title) {
  const t = String(title ?? '').trim();
  let m = REV.exec(t);
  if (m) return { acquirer: clean(m[2], true), target: clean(m[1], false) };
  m = FWD.exec(t);
  if (m) return { acquirer: clean(m[1], false), target: clean(m[2], true) };
  return { acquirer: null, target: null };
}

export function extractDeal(title, summary = '') {
  const both = `${title} ${summary}`;
  const type = classify(title) ?? classify(summary);
  const amount = extractAmount(title) ?? extractAmount(summary);
  const round = ROUND_RE.exec(both)?.[1] ?? null;
  let { acquirer, target } = type ? extractParties(title) : { acquirer: null, target: null };
  if (type === 'Funding round' && !target) {
    target = clean(RAISER.exec(title)?.[1], false);
    acquirer = clean(LED_BY.exec(title)?.[1] ?? LED_BY.exec(summary)?.[1], true);
  }
  return {
    type,
    amountText: amount?.text ?? null,
    amountUsdM: amount?.usdM ?? null,
    round: round ? round.replace(/\b\w/g, c => c.toUpperCase()) : null,
    acquirer,
    target,
  };
}
