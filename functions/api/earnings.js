// Proxy mot Yahoos earnings-kalender (samma data som finance.yahoo.com/calendar/earnings).
// Visualization-API:t returnerar många bolag per datumintervall. Kräver cookie + crumb.
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD&region=us&size=250&offset=0
//
// Kalendern har dålig täckning utanför USA — nordiska bolag saknas i princip helt
// (region=se ger 0 träffar). Därför finns ett andra läge för specifika bolag:
//   ?symbols=ERIC-B.ST,VOLV-B.ST,AAPL   → { rows: [{ ticker, name, date, estimate }] }
// som hämtar nästa rapportdatum per ticker via v7/quote (fungerar för nordiska bolag).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let cache = { cookie: null, crumb: null, at: 0 };
const TTL = 30 * 60 * 1000;

async function getAuth(force) {
  if (!force && cache.crumb && Date.now() - cache.at < TTL) return cache;
  const c = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  const list = typeof c.headers.getSetCookie === 'function'
    ? c.headers.getSetCookie()
    : (c.headers.get('set-cookie') ? [c.headers.get('set-cookie')] : []);
  const cookie = list.map(x => x.split(';')[0]).join('; ');
  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie }
  });
  const crumb = (await cr.text()).trim();
  cache = { cookie, crumb, at: Date.now() };
  return cache;
}

async function runQuery(auth, body) {
  const url = 'https://query1.finance.yahoo.com/v1/finance/visualization?crumb=' + encodeURIComponent(auth.crumb) + '&lang=en-US&region=US';
  return fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Cookie': auth.cookie },
    body: JSON.stringify(body)
  });
}

// Nästa rapportdatum för en lista tickers (max 50 per anrop – Yahoos gräns för v7/quote).
async function symbolsMode(raw) {
  const syms = raw.split(',').map(s => s.trim())
    .filter(s => /^[A-Za-z0-9.^=-]{1,25}$/.test(s)).slice(0, 50);
  if (!syms.length) return json({ rows: [] });

  const call = async auth => fetch(
    'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(syms.join(',')) +
    '&crumb=' + encodeURIComponent(auth.crumb),
    { headers: { 'User-Agent': UA, 'Cookie': auth.cookie } }
  );

  let auth = await getAuth(false);
  let res = await call(auth);
  if (res.status === 401 || res.status === 403) { auth = await getAuth(true); res = await call(auth); }
  const j = await res.json();

  const rows = [];
  for (const q of (j && j.quoteResponse && j.quoteResponse.result) || []) {
    // earningsTimestamp saknas ibland; start/end finns oftare (och är lika när datumet är känt).
    const ts = q.earningsTimestamp || q.earningsTimestampStart;
    if (!ts) continue;
    rows.push({
      ticker: q.symbol,
      name: q.longName || q.shortName || q.symbol,
      date: new Date(ts * 1000).toISOString(),
      estimate: q.isEarningsDateEstimate === true
    });
  }
  return json({ rows }, 200, 'public, max-age=900');
}

// Dagsstängningar (~1 mån bakåt) för en lista tickers – används för att räkna ut
// kursreaktionen efter en rapport. spark ger många symboler i ett anrop.
async function pricesMode(raw) {
  const syms = raw.split(',').map(s => s.trim())
    .filter(s => /^[A-Za-z0-9.^=-]{1,25}$/.test(s)).slice(0, 50);
  if (!syms.length) return json({ series: {} });

  const call = async auth => fetch(
    'https://query1.finance.yahoo.com/v7/finance/spark?symbols=' + encodeURIComponent(syms.join(',')) +
    '&range=1mo&interval=1d&crumb=' + encodeURIComponent(auth.crumb),
    { headers: { 'User-Agent': UA, 'Cookie': auth.cookie } }
  );

  let auth = await getAuth(false);
  let res = await call(auth);
  if (res.status === 401 || res.status === 403) { auth = await getAuth(true); res = await call(auth); }
  const j = await res.json();

  const series = {};
  for (const r of (j && j.spark && j.spark.result) || []) {
    const resp = r.response && r.response[0];
    const ts = (resp && resp.timestamp) || [];
    const close = (resp && resp.indicators && resp.indicators.quote && resp.indicators.quote[0] &&
                   resp.indicators.quote[0].close) || [];
    series[r.symbol] = ts
      .map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), close[i]])
      .filter(x => x[1] != null);
  }
  return json({ series }, 200, 'public, max-age=900');
}

export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
  if (p.get('prices')) {
    try { return await pricesMode(p.get('prices')); }
    catch (err) { return json({ error: err.message, series: {} }, 500); }
  }
  if (p.get('symbols')) {
    try { return await symbolsMode(p.get('symbols')); }
    catch (err) { return json({ error: err.message, rows: [] }, 500); }
  }
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const today = new Date().toISOString().slice(0, 10);
  const from = isDate(p.get('from')) ? p.get('from') : today;
  const to = isDate(p.get('to')) ? p.get('to') : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const region = /^[a-z]{2}$/i.test(p.get('region') || '') ? p.get('region').toLowerCase() : '';
  const size = Math.min(250, Math.max(1, parseInt(p.get('size'), 10) || 100));
  const offset = Math.max(0, parseInt(p.get('offset'), 10) || 0);

  const operands = [
    { operator: 'gte', operands: ['startdatetime', from] },
    { operator: 'lt', operands: ['startdatetime', to] }
  ];
  if (region) operands.push({ operator: 'eq', operands: ['region', region] });

  const body = {
    sortType: 'ASC',
    entityIdType: 'earnings',
    sortField: 'startdatetime',
    includeFields: ['ticker', 'companyshortname', 'startdatetime', 'startdatetimetype', 'epsestimate', 'epsactual', 'epssurprisepct'],
    query: { operator: 'and', operands },
    offset,
    size
  };

  try {
    let auth = await getAuth(false);
    let res = await runQuery(auth, body);
    if (res.status === 401) { auth = await getAuth(true); res = await runQuery(auth, body); }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' }
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }
  });
}
