// Proxy mot Avanzas inofficiella API (Cloudflare Pages Function) – för svenska
// fonder som Yahoo saknar. Tillåter bara sök, fonddetaljer och fondgraf.
export async function onRequest(context) {
  const { request } = context;
  const path = new URL(request.url).searchParams.get('path');
  if (!path) {
    return json({ error: 'Saknar path-parameter' }, 400);
  }

  // Allowlist – bara dessa endpoints får anropas
  const allowed =
    /^\/_api\/search\/filtered-search$/.test(path) ||
    /^\/_api\/fund-guide\/guide\/\d+$/.test(path) ||
    /^\/_api\/fund-guide\/chart\/\d+\/[a-z_]+$/.test(path);
  if (!allowed) {
    return json({ error: 'Otillaten path' }, 400);
  }

  const target = 'https://www.avanza.se' + path;
  const method = request.method === 'POST' ? 'POST' : 'GET';

  try {
    const opts = {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };
    if (method === 'POST') opts.body = await request.text();

    const response = await fetch(target, opts);
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      }
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
