// Källadapter: SEC EDGAR 8-K – amerikanska bolags materiella händelser.
// Hämtar SEC:s "current filings"-feed, plockar dokumenttexten + rapporterade
// 8-K-punkter (items), och mappar CIK → ticker. Gratis, ingen nyckel.
// SEC kräver en beskrivande User-Agent och rimlig anropstakt.

const UA = process.env.ENGINE_EDGAR_UA || 'conny-stocks research (connycar@gmail.com)';
const MAX = Number(process.env.ENGINE_EDGAR_MAX || 20);
const FRESH_HOURS = Number(process.env.ENGINE_EDGAR_FRESH_HOURS || 48);

const CURRENT_FEED =
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=100&output=atom';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

let tickerMap = null; // CIK (number) → ticker

module.exports = {
  id: 'sec_edgar',
  async fetch() {
    let xml;
    try {
      const r = await fetch(CURRENT_FEED, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      xml = await r.text();
    } catch (err) {
      console.error(`[sec_edgar] kunde inte hämta feed: ${err.message}`);
      return [];
    }

    const entries = parseEntries(xml);
    const cutoff = Date.now() - FRESH_HOURS * 3600 * 1000;
    const map = await loadTickerMap();
    const docs = [];

    for (const e of entries) {
      if (docs.length >= MAX) break;
      if (e.updated && e.updated.getTime() < cutoff) continue;

      const ticker = e.cik != null ? map.get(e.cik) || null : null;

      // Hämta själva 8-K-dokumentet (best-effort – faller tillbaka på titeln).
      let text = '';
      let items = '';
      try {
        const primary = await fetchPrimaryDoc(e.indexUrl);
        text = primary.text;
        items = primary.items;
      } catch (err) {
        console.error(`[sec_edgar] kunde inte läsa ${e.accession}: ${err.message}`);
      }

      const body = [
        `Bolag: ${e.company}${ticker ? ' (' + ticker + ')' : ''}`,
        items ? `Rapporterade 8-K-punkter: ${items}` : '',
        text
      ].filter(Boolean).join('\n\n');

      docs.push({
        source: 'sec_edgar',
        type: 'filing_8k',
        external_id: e.accession,
        url: e.indexUrl,
        published_at: e.updated ? e.updated.toISOString() : null,
        title: `8-K: ${e.company}`,
        text: body || `8-K-registrering från ${e.company}`,
        hint_tickers: ticker ? [ticker] : []
      });

      await sleep(150); // artig anropstakt mot SEC
    }
    return docs;
  }
};

// ─── CIK → ticker ──────────────────────────────────────────────────────────

async function loadTickerMap() {
  if (tickerMap) return tickerMap;
  tickerMap = new Map();
  try {
    const r = await fetch(TICKERS_URL, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    for (const k of Object.keys(j)) {
      const e = j[k];
      if (e && e.cik_str != null && e.ticker) tickerMap.set(Number(e.cik_str), e.ticker);
    }
  } catch (err) {
    console.error(`[sec_edgar] kunde inte hämta ticker-map: ${err.message}`);
  }
  return tickerMap;
}

// ─── Feed-parsning ─────────────────────────────────────────────────────────

function parseEntries(xml) {
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = tagText(b, 'title');
    const href = (b.match(/<link\b[^>]*\bhref="([^"]+)"/i) || [])[1] || '';
    if (!href) continue;
    // Titel: "8-K - COMPANY NAME (0001234567) (Filer)" (eller "8-K/A - ...").
    // Ta bort ledande formtyp först så bindestrecket i "8-K" inte lurar parsern.
    const m = title.replace(/^\s*8-K(?:\/A)?\s*-\s*/i, '').match(/^(.+?)\s*\((\d{10})\)/);
    const company = m ? m[1] : title;
    const cik = m ? Number(m[2]) : null;
    // Accession: ".../0000320193-24-000123-index.htm"
    const acc = (href.match(/(\d{10}-\d{2}-\d{6})-index/) || [])[1];
    if (!acc) continue;
    out.push({
      company,
      cik,
      accession: acc,
      indexUrl: decodeEntities(href),
      updated: dateOf(tagText(b, 'updated'))
    });
  }
  return out;
}

// ─── Hämta primärdokumentet för en registrering ────────────────────────────

async function fetchPrimaryDoc(indexUrl) {
  const dir = indexUrl.slice(0, indexUrl.lastIndexOf('/'));
  const idxRes = await fetch(dir + '/index.json', { headers: { 'User-Agent': UA } });
  if (!idxRes.ok) throw new Error('index.json HTTP ' + idxRes.status);
  const idx = await idxRes.json();
  const items = (idx.directory && idx.directory.item) || [];

  // Primärt 8-K-dokument: helst type "8-K", annars första .htm som inte är index/exhibit-lista.
  let doc =
    items.find((it) => it.type === '8-K' && /\.html?$/i.test(it.name)) ||
    items.find((it) => /\.html?$/i.test(it.name) && !/index|^R\d/i.test(it.name));
  if (!doc) throw new Error('inget primärdokument hittades');

  const docRes = await fetch(dir + '/' + doc.name, { headers: { 'User-Agent': UA } });
  if (!docRes.ok) throw new Error('dokument HTTP ' + docRes.status);
  const html = await docRes.text();
  const text = stripHtml(html).slice(0, 5000);

  // Extrahera rapporterade "Item X.XX"-punkter ur texten.
  const found = [...text.matchAll(/Item\s+(\d\.\d{2})/gi)].map((x) => x[1]);
  const uniqueItems = [...new Set(found)].join(', ');

  return { text, items: uniqueItems };
}

// ─── Hjälpare ──────────────────────────────────────────────────────────────

function tagText(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? clean(m[1]) : '';
}

function dateOf(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function stripHtml(s) {
  return decodeEntities(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function clean(s) {
  return decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/\s+/g, ' ').trim());
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
