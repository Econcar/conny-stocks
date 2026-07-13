// Proxy mot Yahoos earnings-kalender (samma data som finance.yahoo.com/calendar/earnings).
// Visualization-API:t returnerar många bolag per datumintervall. Kräver cookie + crumb.
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD&region=us&size=250&offset=0
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

export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
