// Källadapter: finansnyheter via RSS/Atom. Gratis, ingen nyckel.
// Hämtar utvalda flöden, normaliserar varje artikel till ett dokument.
// Feedlistan kan styras med ENGINE_RSS_FEEDS (kommaseparerade URL:er).

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Standardflöden – stabila, keyless. Justera fritt via ENGINE_RSS_FEEDS.
const DEFAULT_FEEDS = [
  'https://www.cnbc.com/id/100003114/device/rss/rss.html', // CNBC Top News
  'https://www.cnbc.com/id/20910258/device/rss/rss.html',  // CNBC Markets
  'http://feeds.marketwatch.com/marketwatch/topstories/'   // MarketWatch Top Stories
];

const FEEDS = (process.env.ENGINE_RSS_FEEDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_PER_FEED = Number(process.env.ENGINE_RSS_MAX_PER_FEED || 15);
const FRESH_HOURS = Number(process.env.ENGINE_RSS_FRESH_HOURS || 48);

module.exports = {
  id: 'rss',
  async fetch() {
    const feeds = FEEDS.length ? FEEDS : DEFAULT_FEEDS;
    const cutoff = Date.now() - FRESH_HOURS * 3600 * 1000;
    const docs = [];
    const seen = new Set(); // dedup inom körningen (samma artikel i flera flöden)

    for (const feedUrl of feeds) {
      let xml;
      try {
        const res = await fetch(feedUrl, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        xml = await res.text();
      } catch (err) {
        console.error(`[rss] kunde inte hämta ${feedUrl}: ${err.message}`);
        continue;
      }

      const items = parseFeed(xml).slice(0, MAX_PER_FEED);
      for (const it of items) {
        const externalId = it.guid || it.link;
        if (!externalId || seen.has(externalId)) continue;
        // Filtrera på färskhet om vi lyckats läsa ett datum.
        if (it.publishedAt && it.publishedAt.getTime() < cutoff) continue;
        seen.add(externalId);
        docs.push({
          source: 'rss',
          type: 'news',
          external_id: externalId,
          url: it.link || null,
          published_at: it.publishedAt ? it.publishedAt.toISOString() : null,
          title: it.title,
          text: [it.title, it.description].filter(Boolean).join('\n\n'),
          hint_tickers: []
        });
      }
    }
    return docs;
  }
};

// ─── Minimal RSS/Atom-parser (dependency-fri) ──────────────────────────────

function parseFeed(xml) {
  const blocks =
    matchAll(xml, /<item\b[\s\S]*?<\/item>/gi).concat(
      matchAll(xml, /<entry\b[\s\S]*?<\/entry>/gi)
    );
  return blocks.map((block) => ({
    title: tagText(block, 'title'),
    link: linkOf(block),
    guid: tagText(block, 'guid') || tagText(block, 'id'),
    description: tagText(block, 'description') || tagText(block, 'summary'),
    publishedAt: dateOf(
      tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated')
    )
  }));
}

function matchAll(str, re) {
  return str.match(re) || [];
}

function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? clean(m[1]) : '';
}

// Atom: <link href="..."/>; RSS: <link>...</link>
function linkOf(block) {
  const href = block.match(/<link\b[^>]*\bhref="([^"]+)"/i);
  if (href) return decodeEntities(href[1]);
  return tagText(block, 'link');
}

function dateOf(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function clean(s) {
  return decodeEntities(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // ta bort CDATA-wrapper
      .replace(/<[^>]+>/g, ' ') // strippa ev. HTML i beskrivningen
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
