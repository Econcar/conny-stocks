// Proxy mot Anthropic/Claude – körs som Cloudflare Pages Function (löser CORS,
// användarens egen nyckel skickas i x-api-key-headern, aldrig i klienten).
export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return json({ error: 'Ingen API-nyckel angiven' }, 401);
  }

  try {
    const body = await request.text(); // vidarebefordra JSON:en oförändrad
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body
    });
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
