// Minimal, dependency-free RSS 2.0 / Atom parser. Good enough for news feeds
// (Google News, Bing News, WordPress); not a general-purpose XML parser.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', rupee: '₹', euro: '€', pound: '£' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function unwrap(s) {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return cdata ? cdata[1] : decodeEntities(s);
}

export function stripHtml(s) {
  // Descriptions are often entity-encoded HTML, so decode, strip, decode again.
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tag(block, name) {
  const m = new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'i').exec(block);
  return m ? unwrap(m[1]).trim() : '';
}

function tagAttr(block, name, attr) {
  const m = new RegExp(`<${esc(name)}\\b([^>]*)>`, 'i').exec(block);
  if (!m) return '';
  const a = new RegExp(`\\b${esc(attr)}\\s*=\\s*"([^"]*)"`, 'i').exec(m[1]);
  return a ? decodeEntities(a[1]) : '';
}

export function parseFeed(xml) {
  const text = String(xml ?? '');
  const items = [];
  const rss = text.match(/<item\b[\s\S]*?<\/item>/gi);
  if (rss) {
    for (const block of rss) {
      items.push({
        title: stripHtml(tag(block, 'title')),
        link: tag(block, 'link') || tag(block, 'guid'),
        pubDate: tag(block, 'pubDate') || tag(block, 'dc:date'),
        description: stripHtml(tag(block, 'description')),
        source: stripHtml(tag(block, 'source') || tag(block, 'News:Source')),
        sourceUrl: tagAttr(block, 'source', 'url'),
      });
    }
    return items;
  }
  for (const block of text.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []) {
    items.push({
      title: stripHtml(tag(block, 'title')),
      link: tagAttr(block, 'link', 'href'),
      pubDate: tag(block, 'published') || tag(block, 'updated'),
      description: stripHtml(tag(block, 'summary') || tag(block, 'content')),
      source: stripHtml(tag(block, 'name')),
      sourceUrl: '',
    });
  }
  return items;
}
