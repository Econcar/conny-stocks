// Källadapter: insidertransaktioner via SEC EDGAR Form 4.
// Hämtar SEC:s current-filings-feed för Form 4, läser ownership-XML:en
// (issuer + ticker + transaktioner), och skickar öppna marknadsköp/-sälj
// (koderna P/S) vidare till analysen. Gratis, ingen nyckel.

const UA = process.env.ENGINE_EDGAR_UA || 'conny-stocks research (connycar@gmail.com)';
const MAX = Number(process.env.ENGINE_INSIDER_MAX || 20);
const FRESH_HOURS = Number(process.env.ENGINE_INSIDER_FRESH_HOURS || 48);

const CURRENT_FEED =
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=100&output=atom';

module.exports = {
  id: 'sec_insider',
  async fetch() {
    let xml;
    try {
      const r = await fetch(CURRENT_FEED, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      xml = await r.text();
    } catch (err) {
      console.error(`[sec_insider] kunde inte hämta feed: ${err.message}`);
      return [];
    }

    const entries = parseEntries(xml);
    const cutoff = Date.now() - FRESH_HOURS * 3600 * 1000;
    const docs = [];
    const seen = new Set(); // samma filing kan listas flera gånger (flera reporting owners)

    for (const e of entries) {
      if (docs.length >= MAX) break;
      if (e.updated && e.updated.getTime() < cutoff) continue;
      if (seen.has(e.accession)) continue;
      seen.add(e.accession);

      let f;
      try {
        f = await fetchForm4(e.indexUrl);
      } catch (err) {
        console.error(`[sec_insider] kunde inte läsa ${e.accession}: ${err.message}`);
        continue;
      }
      // Bara filings med öppna marknadstransaktioner (köp/sälj) är intressanta.
      if (!f || (!f.buys.shares && !f.sells.shares)) continue;

      const parts = [];
      if (f.buys.shares) parts.push(`KÖP ${fmt(f.buys.shares)} aktier${f.buys.value ? ' (~$' + fmt(f.buys.value) + ')' : ''}`);
      if (f.sells.shares) parts.push(`SÄLJ ${fmt(f.sells.shares)} aktier${f.sells.value ? ' (~$' + fmt(f.sells.value) + ')' : ''}`);
      const role = f.role ? `, ${f.role}` : '';
      const body =
        `${f.issuerName}${f.symbol ? ' (' + f.symbol + ')' : ''} – insider ${f.owner}${role}.\n` +
        `Öppna marknadstransaktioner: ${parts.join('; ')}.`;

      docs.push({
        source: 'sec_insider',
        type: 'insider_form4',
        external_id: e.accession,
        url: e.indexUrl,
        published_at: e.updated ? e.updated.toISOString() : null,
        title: `Insider: ${f.owner} ${f.buys.shares ? 'köper' : 'säljer'} ${f.issuerName}`,
        text: body,
        hint_tickers: f.symbol ? [f.symbol] : []
      });

      await sleep(150); // artig anropstakt mot SEC
    }
    return docs;
  }
};

// ─── Feed-parsning ─────────────────────────────────────────────────────────

function parseEntries(xml) {
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const href = (b.match(/<link\b[^>]*\bhref="([^"]+)"/i) || [])[1] || '';
    const acc = (href.match(/(\d{10}-\d{2}-\d{6})-index/) || [])[1];
    if (!href || !acc) continue;
    out.push({
      accession: acc,
      indexUrl: decodeEntities(href),
      updated: dateOf(tag(b, 'updated'))
    });
  }
  return out;
}

// ─── Läs och tolka Form 4-dokumentet ───────────────────────────────────────

async function fetchForm4(indexUrl) {
  const dir = indexUrl.slice(0, indexUrl.lastIndexOf('/'));
  const idxRes = await fetch(dir + '/index.json', { headers: { 'User-Agent': UA } });
  if (!idxRes.ok) throw new Error('index.json HTTP ' + idxRes.status);
  const idx = await idxRes.json();
  const items = (idx.directory && idx.directory.item) || [];

  // Primär ownership-XML: type "4", annars första .xml som inte är renderad (R\d).
  const doc =
    items.find((it) => it.type === '4' && /\.xml$/i.test(it.name)) ||
    items.find((it) => /\.xml$/i.test(it.name) && !/^R\d|index/i.test(it.name));
  if (!doc) throw new Error('ingen ownership-XML hittades');

  const res = await fetch(dir + '/' + doc.name, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('dokument HTTP ' + res.status);
  const xml = await res.text();

  const issuerName = tag(xml, 'issuerName') || 'Okänt bolag';
  const symbol = (tag(xml, 'issuerTradingSymbol') || '').toUpperCase() || null;
  const owner = tag(xml, 'rptOwnerName') || 'Okänd insider';
  const title = tag(xml, 'officerTitle');
  const isDirector = /<isDirector>\s*(1|true)\s*<\/isDirector>/i.test(xml);
  const role = title || (isDirector ? 'styrelseledamot' : '');

  // Aggregera icke-derivata transaktioner (koder P = köp, S = sälj).
  const buys = { shares: 0, value: 0 };
  const sells = { shares: 0, value: 0 };
  const txs = xml.match(/<nonDerivativeTransaction\b[\s\S]*?<\/nonDerivativeTransaction>/gi) || [];
  for (const t of txs) {
    const code = (t.match(/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/i) || [])[1];
    if (code !== 'P' && code !== 'S') continue;
    const shares = num(valueOf(t, 'transactionShares'));
    const price = num(valueOf(t, 'transactionPricePerShare'));
    const bucket = code === 'P' ? buys : sells;
    bucket.shares += shares;
    bucket.value += shares * price;
  }

  return { issuerName, symbol, owner, role, buys, sells };
}

// ─── Hjälpare ──────────────────────────────────────────────────────────────

function tag(s, name) {
  const m = s.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeEntities(m[1].trim()) : '';
}

// <foo><value>X</value></foo> – vanligt mönster i Form 4-XML.
function valueOf(block, name) {
  const outer = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!outer) return '';
  const inner = outer[1].match(/<value>([\s\S]*?)<\/value>/i);
  return inner ? inner[1].trim() : outer[1].trim();
}

function num(s) {
  const x = parseFloat(String(s).replace(/,/g, ''));
  return isFinite(x) ? x : 0;
}

function fmt(n) {
  return Math.round(n).toLocaleString('sv-SE');
}

function dateOf(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
