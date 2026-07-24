// Rapportkalender: bygger ett universum av bolag du kan handla via Avanza och
// slår upp nästa rapportdatum per ticker. Skrivs till earnings_calendar.
//
// Varför i motorn: Yahoos kalender-API (finance/visualization) är i praktiken tomt
// – ett år framåt gav 601 rader men bara 22 unika bolag, och inga nordiska alls.
// v7/quote känner däremot rapportdatum för varje enskild ticker. Att fråga per
// ticker är för många anrop för att göra i webbläsaren vid varje sidvisning, men
// helt rimligt en gång per dygn här. Se docs/beslutslogg.md.

const { upsertEarnings, pruneEarnings } = require('./store');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Hur många bolag per marknad universumet ska omfatta (störst börsvärde först).
// Summan styr både antal anrop och hur komplett kalendern blir.
const UNIVERSE = [
  { region: 'us', want: 500 },
  { region: 'se', want: 400 },
  { region: 'no', want: 150 }, { region: 'dk', want: 150 }, { region: 'fi', want: 150 },
  { region: 'de', want: 150 }, { region: 'fr', want: 120 }, { region: 'nl', want: 100 },
  { region: 'gb', want: 150 }, { region: 'ch', want: 100 }, { region: 'it', want: 100 },
  { region: 'es', want: 80 },  { region: 'be', want: 60 },  { region: 'pt', want: 40 },
  { region: 'at', want: 60 },  { region: 'ie', want: 40 },  { region: 'ca', want: 120 }
];

// Samma börslista och poängsättning som screener-proxyn: bara det Avanza faktiskt
// handlar på, och hemmamarknaden vinner när samma bolag finns på flera börser.
const TRADABLE = {
  STO: 9, OSL: 8, CPH: 8, HEL: 8,
  NMS: 7, NYQ: 7, NGM: 6, NCM: 6, ASE: 6, PCX: 6,
  GER: 5, PAR: 5, AMS: 5, BRU: 5, MIL: 5, MCE: 5, LIS: 5, LSE: 5, EBS: 5, VIE: 5, ISE: 5,
  TOR: 4
};

// Ett bolag ska bara ge en rad i kalendern. Utan detta hamnar t.ex. både NVDA och
// XETRA-noteringen NVD.DE i universumet – samma rapport två gånger, och ett bortkastat
// uppslag. Olika aktieslag på samma börs (GOOG/GOOGL) behålls däremot.
function dedupeCompanies(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = (r.name || r.ticker).toLowerCase()
      .replace(/[.,()]/g, ' ')
      .replace(/(\bser\.? ?|\bclass |\bcl )[ab]\b/, ' ')
      .replace(/\b(inc|corp|corporation|ab|abp|oyj|a\/s|asa|plc|nv|sa|se|ag|holding|holdings|group|publ|ltd|limited)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out = [];
  for (const rows2 of groups.values()) {
    const bestEx = rows2.reduce((a, b) => (TRADABLE[b.exchange] > TRADABLE[a.exchange] ? b : a)).exchange;
    for (const r of rows2) if (r.exchange === bestEx) out.push(r);
  }
  return out;
}

let auth = null;
async function getAuth(force) {
  if (auth && !force) return auth;
  const c = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  const list = typeof c.headers.getSetCookie === 'function'
    ? c.headers.getSetCookie()
    : (c.headers.get('set-cookie') ? [c.headers.get('set-cookie')] : []);
  const cookie = list.map((x) => x.split(';')[0]).join('; ');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie }
  });
  auth = { cookie, crumb: (await cr.text()).trim() };
  return auth;
}

// Ett anrop mot Yahoo som förnyar crumb en gång om den gått ut.
async function yfetch(makeUrl, init = {}) {
  let a = await getAuth(false);
  let res = await fetch(makeUrl(a), { ...init, headers: { 'User-Agent': UA, Cookie: a.cookie, ...(init.headers || {}) } });
  if (res.status === 401 || res.status === 403) {
    a = await getAuth(true);
    res = await fetch(makeUrl(a), { ...init, headers: { 'User-Agent': UA, Cookie: a.cookie, ...(init.headers || {}) } });
  }
  return res;
}

// Största bolagen på en marknad, via samma screener som appen använder.
async function fetchRegion(region, want) {
  const out = [];
  const SIZE = 250;
  for (let offset = 0; offset < want; offset += SIZE) {
    const body = {
      size: Math.min(SIZE, want - offset), offset,
      sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY',
      query: { operator: 'EQ', operands: ['region', region] },
      userId: '', userIdType: 'guid'
    };
    const res = await yfetch(
      (a) => 'https://query1.finance.yahoo.com/v1/finance/screener?crumb=' + encodeURIComponent(a.crumb),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`screener ${region} HTTP ${res.status}`);
    const j = await res.json();
    const quotes = ((j.finance && j.finance.result && j.finance.result[0]) || {}).quotes || [];
    for (const q of quotes) {
      if (!TRADABLE[q.exchange]) continue;
      out.push({
        ticker: q.symbol,
        name: q.longName || q.shortName || q.symbol,
        market: (q.market || '').split('_')[0] || region,
        exchange: q.exchange,
        currency: q.currency || null,
        market_cap: q.marketCap != null ? q.marketCap : null
      });
    }
    if (quotes.length < body.size) break;
  }
  return out;
}

// Nästa rapportdatum för upp till 50 tickers per anrop.
async function fetchEarningsDates(tickers) {
  const res = await yfetch((a) =>
    'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(tickers.join(',')) +
    '&crumb=' + encodeURIComponent(a.crumb));
  if (!res.ok) throw new Error(`quote HTTP ${res.status}`);
  const j = await res.json();
  const out = new Map();
  for (const q of (j.quoteResponse && j.quoteResponse.result) || []) {
    const ts = q.earningsTimestamp || q.earningsTimestampStart;
    if (!ts) continue;
    out.set(q.symbol, {
      report_at: new Date(ts * 1000).toISOString(),
      report_date: new Date(ts * 1000).toISOString().slice(0, 10),
      estimate: q.isEarningsDateEstimate === true
    });
  }
  return out;
}

async function runEarningsCalendar({ dry = false } = {}) {
  // 1) Universum
  const universe = new Map();
  for (const { region, want } of UNIVERSE) {
    try {
      const rows = await fetchRegion(region, want);
      for (const r of rows) if (!universe.has(r.ticker)) universe.set(r.ticker, r);
      console.log(`  ${region}: ${rows.length} bolag`);
    } catch (err) {
      console.error(`  ${region}: hoppar över – ${err.message}`);
    }
  }
  const deduped = dedupeCompanies([...universe.values()]);
  const byTicker = new Map(deduped.map(r => [r.ticker, r]));
  const tickers = [...byTicker.keys()];
  console.log(`Universum: ${tickers.length} handlingsbara bolag (${universe.size - tickers.length} korsnoteringar bortsorterade).`);

  // 2) Rapportdatum, 50 åt gången
  const rows = [];
  let missing = 0;
  for (let i = 0; i < tickers.length; i += 50) {
    const chunk = tickers.slice(i, i + 50);
    try {
      const dates = await fetchEarningsDates(chunk);
      for (const t of chunk) {
        const d = dates.get(t);
        if (!d) { missing++; continue; }
        rows.push({ ...byTicker.get(t), ...d, updated_at: new Date().toISOString() });
      }
    } catch (err) {
      console.error(`  rapportdatum ${i}–${i + chunk.length}: ${err.message}`);
    }
  }
  console.log(`Rapportdatum: ${rows.length} hittade, ${missing} bolag saknar datum hos Yahoo.`);

  if (dry) {
    console.log('  (dry) skriver inte. Exempel:', JSON.stringify(rows.slice(0, 3), null, 1));
    return { universe: tickers.length, written: 0, missing };
  }

  // 3) Skriv, och rensa: passerade rapporter äldre än 35 dagar (håller "senaste
  //    veckan/månaden" men slänger gammalt + Yahoos trasiga historiska datum), samt
  //    framtida rader för bolag som inte längre är i universumet (>14 dygn utan uppdatering).
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) written += await upsertEarnings(rows.slice(i, i + 500));
  await pruneEarnings({
    pastCutoffDate: new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10),
    staleBeforeIso: new Date(Date.now() - 14 * 86400000).toISOString()
  });
  return { universe: tickers.length, written, missing };
}

module.exports = { runEarningsCalendar };
