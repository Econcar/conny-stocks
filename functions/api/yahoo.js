// Proxy mot Yahoo Finance (Cloudflare Pages Function). Löser CORS + sätter User-Agent.
export async function onRequest(context) {
  const url = new URL(context.request.url).searchParams.get('url');
  if (!url) {
    return json({ error: 'Saknar url-parameter' }, 400);
  }

  // Tillåt bara anrop till Yahoo Finance (skyddar mot missbruk)
  if (!/^https:\/\/query[12]\.finance\.yahoo\.com\//.test(url)) {
    return json({ error: 'Otillaten url' }, 400);
  }

  try {
    const response = await fetch(url, {
      headers: {
        // Yahoo kräver en User-Agent, annars blockerar de anropet
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        // Mellanlagra svaret i 60 sekunder för snabbare upprepade anrop
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
