// Proxy mot Yahoos (inofficiella) screener-API. Filtrerar hela Yahoos aktieuniversum
// på sektor/industri + region, med sidbläddring. Kräver cookie + crumb som vi cachar.
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

async function runScreen(auth, body) {
  const url = 'https://query1.finance.yahoo.com/v1/finance/screener?crumb=' + encodeURIComponent(auth.crumb);
  return fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Cookie': auth.cookie },
    body: JSON.stringify(body)
  });
}

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const sector = p.sector || '';
  const industry = p.industry || '';
  const region = p.region || '';
  const offset = Math.max(0, parseInt(p.offset, 10) || 0);
  const size = Math.min(50, Math.max(1, parseInt(p.size, 10) || 25));
  // Whitelist över fält Yahoo faktiskt kan sortera på (serversidan = över hela universumet)
  const SORT_FIELDS = ['intradaymarketcap', 'percentchange', 'fiftytwowkpercentchange', 'peratio.lasttwelvemonths', 'forward_dividend_yield'];
  const sortField = SORT_FIELDS.includes(p.sortField) ? p.sortField : 'intradaymarketcap';
  const sortType = p.sortType === 'ASC' ? 'ASC' : 'DESC';

  const operands = [];
  if (sector) operands.push({ operator: 'EQ', operands: ['sector', sector] });
  if (industry) operands.push({ operator: 'EQ', operands: ['industry', industry] });
  if (region) operands.push({ operator: 'EQ', operands: ['region', region] });
  // Måste finnas minst ett villkor – fall tillbaka på "alla med börsvärde" (= hela universumet)
  const query = operands.length
    ? { operator: 'AND', operands }
    : { operator: 'GT', operands: ['intradaymarketcap', 0] };

  const body = {
    size, offset,
    sortField, sortType,
    quoteType: 'EQUITY', query,
    userId: '', userIdType: 'guid'
  };

  try {
    let auth = await getAuth(false);
    let res = await runScreen(auth, body);
    if (res.status === 401) { // crumb utgången – förnya en gång och försök igen
      auth = await getAuth(true);
      res = await runScreen(auth, body);
    }
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: text
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
