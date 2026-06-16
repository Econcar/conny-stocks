// Proxy mot Avanzas inofficiella API – för svenska fonder som Yahoo saknar.
// Tillåter bara sök, fonddetaljer och fondgraf.
exports.handler = async function(event) {
  const path = event.queryStringParameters && event.queryStringParameters.path;
  if (!path) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Saknar path-parameter' }) };
  }

  // Allowlist – bara dessa endpoints får anropas
  const allowed =
    /^\/_api\/search\/filtered-search$/.test(path) ||
    /^\/_api\/fund-guide\/guide\/\d+$/.test(path) ||
    /^\/_api\/fund-guide\/chart\/\d+\/[a-z_]+$/.test(path);
  if (!allowed) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Otillaten path' }) };
  }

  const target = 'https://www.avanza.se' + path;
  const method = event.httpMethod === 'POST' ? 'POST' : 'GET';

  try {
    const opts = {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };
    if (method === 'POST') opts.body = event.body;

    const response = await fetch(target, opts);
    const data = await response.text();
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      },
      body: data
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
