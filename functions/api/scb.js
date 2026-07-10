// Proxy mot SCB:s öppna statistik-API (PxWebApi 2.0). Gratis, ingen nyckel.
// Löser CORS och tillåter bara SCB:s v2-bas. Vidarebefordrar path + frågeparametrar.
//   ?path=tables/TAB6445/data&lang=sv&outputFormat=json-stat2&valueCodes[...]=...
const BASE = 'https://api.scb.se/OV0104/v2beta/api/v2/';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.searchParams.get('path') || '';
  // Tillåt bara SCB v2-vägar (bokstäver/siffror/snedstreck/understreck/bindestreck).
  if (!/^[A-Za-z0-9_/\-]{1,80}$/.test(path)) {
    return json({ error: 'Ogiltig path' }, 400);
  }
  // Övriga query-parametrar (lang, outputFormat, valueCodes[...] osv.) forwardas.
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();
  const target = BASE + path + (qs ? '?' + qs : '');

  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'conny-stocks research', 'Accept': 'application/json' }
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
