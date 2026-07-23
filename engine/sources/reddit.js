// Källadapter: aktieforum på Reddit, via subreddit-RSS.
//
// Varför RSS och inte API:t: Reddits JSON-API svarar 403 utan inloggning, och det
// officiella API:t (gratis 100 anrop/min för icke-kommersiellt bruk) har stängt
// självregistreringen – nya OAuth-nycklar kräver manuellt godkännande. `.rss` går
// däremot att läsa utan nyckel. Priset är hård hastighetsbegränsning: 429 kommer
// snabbt, särskilt från moln-IP:n. Därför: få flöden, en i taget, med paus emellan.
// Samma fälla som fällde GDELT-adaptern – se ../README.md och ../../docs/beslutslogg.md.
//
// Signalen i forum är främst *att* ett bolag plötsligt diskuteras, inte vad som sägs.
// Adaptern skickar därför vidare rubrik + text och låter triagen värdera; håll
// ENGINE_REDDIT_MAX lågt så att brus inte äter AI-budgeten.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// r/aktier = svenskt, resten globalt. Nya flöden: ENGINE_REDDIT_SUBS=aktier,stocks
const DEFAULT_SUBS = ['aktier', 'stocks', 'wallstreetbets'];

const SUBS = (process.env.ENGINE_REDDIT_SUBS || '')
  .split(',').map((s) => s.trim().replace(/^r\//, '')).filter(Boolean);

const MAX_PER_SUB = Number(process.env.ENGINE_REDDIT_MAX || 10);
// 72h som default: r/aktier är lågtrafikerad och hade inte ett enda inlägg
// inom ett dygn vid första testet.
const FRESH_HOURS = Number(process.env.ENGINE_REDDIT_FRESH_HOURS || 72);
// 20s mellan flödena är vad som faktiskt funkade i test: med 4s och 8s 429:ade
// två av tre subreddits. Nattjobbet har råd med väntetiden.
const PAUSE_MS = Number(process.env.ENGINE_REDDIT_PAUSE_MS || 20000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  id: 'reddit',
  async fetch() {
    const subs = SUBS.length ? SUBS : DEFAULT_SUBS;
    const cutoff = Date.now() - FRESH_HOURS * 3600 * 1000;
    const docs = [];
    const seen = new Set();
    let throttled = 0;

    for (const [i, sub] of subs.entries()) {
      if (i) await sleep(PAUSE_MS); // 429-skydd: aldrig två anrop i rad
      const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.rss`;
      let xml;
      try {
        // Ett försök till efter en längre paus – 429 är ofta övergående.
        let res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml' } });
        if (res.status === 429) {
          await sleep(PAUSE_MS * 2);
          res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml' } });
        }
        if (res.status === 429) { throttled++; console.error(`[reddit] r/${sub}: 429 även efter omförsök`); continue; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        xml = await res.text();
      } catch (err) {
        console.error(`[reddit] kunde inte hämta r/${sub}: ${err.message}`);
        continue;
      }

      const entries = parseAtom(xml).slice(0, MAX_PER_SUB);
      let kept = 0;
      for (const e of entries) {
        const externalId = e.id || e.link;
        if (!externalId || seen.has(externalId)) continue;
        if (e.publishedAt && e.publishedAt.getTime() < cutoff) continue;
        seen.add(externalId);
        kept++;
        docs.push({
          source: 'reddit',
          type: 'forum',
          external_id: externalId,
          url: e.link || null,
          published_at: e.publishedAt ? e.publishedAt.toISOString() : null,
          title: `r/${sub}: ${e.title}`,
          text: [e.title, e.content].filter(Boolean).join('\n\n').slice(0, 4000),
          hint_tickers: []
        });
      }
      console.log(`[reddit] r/${sub}: ${kept} inlägg (av ${entries.length} i flödet)`);
    }

    if (throttled === subs.length && subs.length) {
      console.error('[reddit] alla flöden 429:ade – överväg att sänka frekvensen eller köra från annan IP.');
    }
    return docs;
  }
};

// ─── Minimal Atom-parser (Reddit levererar Atom, inte RSS) ────────────────────

function parseAtom(xml) {
  return (xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []).map((block) => ({
    title: tagText(block, 'title'),
    link: hrefOf(block),
    id: tagText(block, 'id'),
    content: tagText(block, 'content'),
    publishedAt: dateOf(tagText(block, 'updated') || tagText(block, 'published'))
  }));
}

function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? clean(m[1]) : '';
}

function hrefOf(block) {
  const m = block.match(/<link\b[^>]*\bhref="([^"]+)"/i);
  return m ? decodeEntities(m[1]) : '';
}

function dateOf(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function clean(s) {
  return decodeEntities(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
