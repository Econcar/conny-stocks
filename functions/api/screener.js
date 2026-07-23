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

// Samma bolag på flera börser → behåll bara noteringen på den börs som ligger närmast
// hemmamarknaden. Alla rader från den vinnande börsen behålls: olika aktieslag på samma
// marknad (INVE-A/INVE-B, GOOG/GOOGL) är olika papper med olika kurs, inte dubbletter.
function dedupeTradable(quotes) {
  const groups = new Map();
  for (const q of quotes) {
    if (!TRADABLE[q.exchange]) continue;                   // ej handlingsbar hos Avanza
    const key = (q.longName || q.shortName || q.symbol || '').toLowerCase()
      .replace(/[.,()]/g, ' ')
      .replace(/(\bser\.? ?|\bclass |\bcl )[ab]\b/, ' ')   // aktieslag ingår inte i bolagsnamnet
      .replace(/\s+/g, ' ').trim();
    const g = groups.get(key);
    if (g) g.push(q); else groups.set(key, [q]);
  }
  const out = [];
  for (const rows of groups.values()) {
    const bestEx = rows.reduce((a, b) => (TRADABLE[b.exchange] > TRADABLE[a.exchange] ? b : a)).exchange;
    for (const r of rows) if (r.exchange === bestEx) out.push(r);
  }
  return out;
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
  // sector/industry/region tar kommaseparerade listor → OR inom varje grupp,
  // AND mellan grupperna ("Teknik ELLER Finans" på "Sverige ELLER Norge").
  const list = (name, re) => (p.get(name) || '').split(',')
    .map(s => s.trim()).filter(s => s && re.test(s));
  const sectors = list('sector', /^[A-Za-z &-]{1,40}$/);
  const industries = list('industry', /^[A-Za-z &-]{1,40}$/);
  const regionsRaw = list('region', /^[a-z]{2,8}$/);
  const offset = Math.max(0, parseInt(p.get('offset'), 10) || 0);
  const size = Math.min(50, Math.max(1, parseInt(p.get('size'), 10) || 25));
  // Whitelist över fält Yahoo faktiskt kan sortera på (serversidan = över hela universumet)
  const SORT_FIELDS = ['intradaymarketcap', 'intradayprice', 'dayvolume', 'percentchange', 'fiftytwowkpercentchange', 'peratio.lasttwelvemonths', 'forward_dividend_yield'];
  const sortField = SORT_FIELDS.includes(p.get('sortField')) ? p.get('sortField') : 'intradaymarketcap';
  const sortType = p.get('sortType') === 'ASC' ? 'ASC' : 'DESC';

  // tradable=1 → bara börser Avanza handlar på, en rad per bolag.
  const tradable = p.get('tradable') === '1';
  const AVANZA_REGIONS = ['us', 'se', 'no', 'dk', 'fi', 'de', 'fr', 'nl', 'be', 'it', 'es', 'pt', 'gb', 'ch', 'at', 'ie', 'ca'];

  const GROUPS = { norden: ['se', 'no', 'dk', 'fi'], alla: AVANZA_REGIONS };

  // "norden"/"alla" expanderas till sina länder; dubbletter tas bort.
  const regions = [...new Set(regionsRaw.flatMap(r => GROUPS[r] || [r]))].filter(r => r.length === 2);

  const anyOf = (field, values) => values.length === 1
    ? { operator: 'EQ', operands: [field, values[0]] }
    : { operator: 'OR', operands: values.map(v => ({ operator: 'EQ', operands: [field, v] })) };

  const operands = [];
  // Sektorer och branscher är samma val i UI:t (Halvledare är en bransch, Teknik en
  // sektor) – de ska därför OR:as ihop, inte AND:as.
  const catOps = [...sectors.map(s => ({ operator: 'EQ', operands: ['sector', s] })),
                  ...industries.map(i => ({ operator: 'EQ', operands: ['industry', i] }))];
  if (catOps.length === 1) operands.push(catOps[0]);
  else if (catOps.length) operands.push({ operator: 'OR', operands: catOps });

  if (regions.length) operands.push(anyOf('region', regions));
  // Utan vald region: begränsa till Avanzas marknader i stället för hela världen, annars
  // fylls toppen av CEDEAR:er och andra korsnoteringar av amerikanska jättar.
  else if (tradable) operands.push(anyOf('region', AVANZA_REGIONS));
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
