// Proxy mot Yahoos (inofficiella) screener-API (Cloudflare Pages Function).
// Filtrerar hela Yahoos aktieuniversum på sektor/industri + region, med
// sidbläddring. Kräver cookie + crumb som vi cachar (best-effort per isolat).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let cache = { cookie: null, crumb: null, at: 0 };
const TTL = 30 * 60 * 1000; // 30 min

async function getAuth(force) {
  if (!force && cache.crumb && Date.now() - cache.at < TTL) return cache;
  // 1) Hämta en cookie (fc.yahoo.com svarar 404 men sätter ändå A1/A3-cookie)
  const c = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  const list = typeof c.headers.getSetCookie === 'function'
    ? c.headers.getSetCookie()
    : (c.headers.get('set-cookie') ? [c.headers.get('set-cookie')] : []);
  const cookie = list.map(x => x.split(';')[0]).join('; ');
  // 2) Hämta crumb med cookien
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie }
  });
  const crumb = (await cr.text()).trim();
  cache = { cookie, crumb, at: Date.now() };
  return cache;
}

// Börser Avanza faktiskt handlar på, med poäng för vilken notering som vinner när samma
// bolag finns på flera. Nordiska först (hemmamarknad), sedan USA, sedan övriga Europa.
// Allt som INTE står här filtreras bort: OTC-listor, IOB, Cboe-speglingar, tyska
// regionbörser, CDR:er och latinamerikanska/asiatiska korsnoteringar av USA-bolag.
const TRADABLE = {
  STO: 9,                                     // Stockholm
  OSL: 8, CPH: 8, HEL: 8,                     // Oslo, Köpenhamn, Helsingfors
  NMS: 7, NYQ: 7, NGM: 6, NCM: 6, ASE: 6, PCX: 6, // NasdaqGS/GM/CM, NYSE, NYSE American, Arca
  GER: 5,                                     // XETRA (inte FRA = Frankfurtgolvet)
  PAR: 5, AMS: 5, BRU: 5, MIL: 5, MCE: 5, LIS: 5, // Paris, Amsterdam, Bryssel, Milano, Madrid, Lissabon
  LSE: 5, EBS: 5, VIE: 5, ISE: 5,             // London (inte CXE/IOB), Schweiz, Wien, Dublin
  TOR: 4                                      // Toronto (inte NEO = Cboe CA)
};

// Samma bolag på flera börser → behåll den notering du kan köpa och som ligger närmast
// hemmamarknaden. A- och B-aktier behålls båda: de är olika papper med olika kurs.
function dedupeTradable(quotes) {
  const best = new Map();
  for (const q of quotes) {
    const score = TRADABLE[q.exchange];
    if (!score) continue;                                  // ej handlingsbar hos Avanza
    const name = (q.longName || q.shortName || q.symbol || '').toLowerCase()
      .replace(/[.,()]/g, ' ').replace(/\s+/g, ' ').trim();
    const cls = /(\bser\.? ?|\bclass |\bcl )([ab])\b/.exec(name);
    const key = name.replace(/(\bser\.? ?|\bclass |\bcl )[ab]\b/, '').trim() + '|' + (cls ? cls[2] : '');
    const ex = best.get(key);
    if (!ex || score > TRADABLE[ex.exchange]) best.set(key, q);
  }
  return [...best.values()];
}

async function runScreen(auth, body) {
  const url = 'https://query1.finance.yahoo.com/v1/finance/screener?crumb=' + encodeURIComponent(auth.crumb);
  return fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Cookie': auth.cookie },
    body: JSON.stringify(body)
  });
}

export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
  const sector = p.get('sector') || '';
  const industry = p.get('industry') || '';
  const region = p.get('region') || '';
  const offset = Math.max(0, parseInt(p.get('offset'), 10) || 0);
  const size = Math.min(50, Math.max(1, parseInt(p.get('size'), 10) || 25));
  // Whitelist över fält Yahoo faktiskt kan sortera på (serversidan = över hela universumet)
  const SORT_FIELDS = ['intradaymarketcap', 'intradayprice', 'dayvolume', 'percentchange', 'fiftytwowkpercentchange', 'peratio.lasttwelvemonths', 'forward_dividend_yield'];
  const sortField = SORT_FIELDS.includes(p.get('sortField')) ? p.get('sortField') : 'intradaymarketcap';
  const sortType = p.get('sortType') === 'ASC' ? 'ASC' : 'DESC';

  // tradable=1 → bara börser Avanza handlar på, en rad per bolag.
  const tradable = p.get('tradable') === '1';
  const AVANZA_REGIONS = ['us', 'se', 'no', 'dk', 'fi', 'de', 'fr', 'nl', 'be', 'it', 'es', 'pt', 'gb', 'ch', 'at', 'ie', 'ca'];

  const GROUPS = { norden: ['se', 'no', 'dk', 'fi'] };

  const operands = [];
  if (sector) operands.push({ operator: 'EQ', operands: ['sector', sector] });
  if (industry) operands.push({ operator: 'EQ', operands: ['industry', industry] });
  if (GROUPS[region]) operands.push({ operator: 'OR', operands: GROUPS[region].map(r => ({ operator: 'EQ', operands: ['region', r] })) });
  else if (region) operands.push({ operator: 'EQ', operands: ['region', region] });
  // Utan vald region: begränsa till Avanzas marknader i stället för hela världen, annars
  // fylls toppen av CEDEAR:er och andra korsnoteringar av amerikanska jättar.
  else if (tradable) operands.push({ operator: 'OR', operands: AVANZA_REGIONS.map(r => ({ operator: 'EQ', operands: ['region', r] })) });
  // Måste finnas minst ett villkor – fall tillbaka på "alla med börsvärde" (= hela universumet)
  const query = operands.length
    ? { operator: 'AND', operands }
    : { operator: 'GT', operands: ['intradaymarketcap', 0] };

  const mkBody = (size, offset) => ({
    size, offset, sortField, sortType, quoteType: 'EQUITY', query, userId: '', userIdType: 'guid'
  });

  async function fetchPage(body) {
    let auth = await getAuth(false);
    let res = await runScreen(auth, body);
    if (res.status === 401) { // crumb utgången – förnya en gång och försök igen
      auth = await getAuth(true);
      res = await runScreen(auth, body);
    }
    return res;
  }

  try {
    if (!tradable) {
      const res = await fetchPage(mkBody(size, offset));
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
      });
    }

    // Filtreringen sker efter Yahoos sidbläddring, så vi läser råa sidor tills vi har
    // tillräckligt många kvar för den efterfrågade sidan (eller når taket).
    const RAW_SIZE = 250, MAX_RAW_PAGES = 4;
    const kept = [];
    let rawTotal = 0, scanned = 0, exhausted = false;
    for (let i = 0; i < MAX_RAW_PAGES; i++) {
      const res = await fetchPage(mkBody(RAW_SIZE, i * RAW_SIZE));
      if (!res.ok) {
        if (i === 0) return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
        break;
      }
      const j = await res.json();
      const r = j && j.finance && j.finance.result && j.finance.result[0];
      const quotes = (r && r.quotes) || [];
      rawTotal = (r && r.total) || rawTotal;
      scanned += quotes.length;
      kept.push(...quotes);
      if (quotes.length < RAW_SIZE) { exhausted = true; break; }
      if (dedupeTradable(kept).length >= offset + size) break;
    }

    const filtered = dedupeTradable(kept);
    const page = filtered.slice(offset, offset + size);
    // Andelen som överlever filtret används för att uppskatta hur många bolag som finns
    // totalt – exakt antal går inte att veta utan att läsa hela universumet.
    const ratio = scanned ? filtered.length / scanned : 1;
    const total = exhausted ? filtered.length : Math.round(rawTotal * ratio);

    return new Response(JSON.stringify({
      finance: { result: [{ quotes: page, count: page.length, total, start: offset,
        tradableFilter: { scanned, kept: filtered.length, dropped: scanned - filtered.length, estimated: !exhausted } }], error: null }
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
