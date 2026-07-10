// Proxy mot Yahoos quoteSummary (Cloudflare Pages Function) – fundamenta för
// VALFRI ticker (P/E, börsvärde, direktavkastning, sektor, bolagsbeskrivning).
// Kräver cookie + crumb, precis som screenern; cachas per isolat.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let cache = { cookie: null, crumb: null, at: 0 };
const TTL = 30 * 60 * 1000; // 30 min

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

export async function onRequest(context) {
  const symbol = new URL(context.request.url).searchParams.get('symbol');
  if (!symbol || !/^[A-Za-z0-9.^=\-]{1,25}$/.test(symbol)) {
    return json({ error: 'Ogiltig symbol' }, 400);
  }
  const modules = 'price,summaryDetail,assetProfile,defaultKeyStatistics';

  async function run(auth) {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
    return fetch(url, { headers: { 'User-Agent': UA, 'Cookie': auth.cookie } });
  }

  try {
    let auth = await getAuth(false);
    let res = await run(auth);
    if (res.status === 401 || res.status === 403) { // crumb utgången – förnya en gång
      auth = await getAuth(true);
      res = await run(auth);
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
