// Proxy mot Googles Gemini-API – körs som Cloudflare Pages Function (samma upplägg som
// claude.js): användarens egen nyckel skickas i x-goog-api-key-headern och vidare till
// Google, svaret (SSE) strömmas igenom. Används av chatten på Översikt.
// Body: { model, ...GenerateContentRequest } – model plockas ut och läggs i URL:en.
// Gemini skickar inga headers förrän modellen tänkt klart, och Cloudflare bryter efter
// ~100 s utan svar (524) – därför svarar vi direkt med en SSE-ström och skickar
// livstecken (": ping") tills Google svarar. Fel från Google blir ett data: {error}-event.
const MODEL_RE = /^gemini-[a-z0-9.\-]+$/;
const PING_MS = 15000;

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

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = s => writer.write(enc.encode(s)).catch(() => {});
  const sendError = err => send('data: ' + JSON.stringify({ error: err }) + '\n\n');

  const pump = (async () => {
    send(': ok\n\n');
    const ping = setInterval(() => send(': ping\n\n'), PING_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(rest)
        });
      clearInterval(ping);
      if (!response.ok) {
        const raw = await response.text();
        let err = null;
        try { const d = JSON.parse(raw); err = (Array.isArray(d) ? d[0] : d).error; } catch (_) {}
        err = err && typeof err === 'object' ? err : { message: (typeof err === 'string' && err) || raw.slice(0, 300) || ('HTTP ' + response.status) };
        if (!err.code) err.code = response.status;
        await sendError(err);
      } else {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      }
    } catch (e) {
      clearInterval(ping);
      await sendError({ code: 502, message: e.message });
    } finally {
      try { await writer.close(); } catch (_) {}
    }
  })();
  if (context.waitUntil) context.waitUntil(pump);

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
