// Proxy mot Googles Gemini-API – körs som Cloudflare Pages Function (samma upplägg som
// claude.js): användarens egen nyckel skickas i x-goog-api-key-headern och vidare till
// Google, svaret (SSE) strömmas igenom oförändrat. Används av chatten på Översikt.
// Body: { model, ...GenerateContentRequest } – model plockas ut och läggs i URL:en.
const MODEL_RE = /^gemini-[a-z0-9.\-]+$/;

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = request.headers.get('x-goog-api-key');
  if (!apiKey) {
    return json({ error: 'Ingen Gemini-nyckel angiven' }, 401);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Ogiltig JSON' }, 400); }
  const { model, ...rest } = body || {};
  if (!MODEL_RE.test(model || '')) {
    return json({ error: 'Ogiltig modell: ' + model }, 400);
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(rest)
      });
    const ct = response.headers.get('content-type') || 'application/json';
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': ct }
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
