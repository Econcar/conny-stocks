// FRED-proxy (v1). Makrostatistik (BNP, inflation,
// arbetslöshet m.m.) för USA och, via OECD-serier, Sverige. Gratis, men kräver en
// API-nyckel: sätt FRED_API_KEY som miljövariabel i Cloudflare Pages (Settings →
// Environment variables). Returnerar senaste observationen som { value, date }.
export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
  const series = p.get('series');
  const units = p.get('units') || 'lin'; // lin = som är, pc1 = förändring å/å
  if (!series || !/^[A-Za-z0-9._-]{1,40}$/.test(series)) {
    return json({ error: 'Ogiltig series' }, 400);
  }
  const key = context.env && context.env.FRED_API_KEY;
  if (!key) return json({ error: 'FRED_API_KEY saknas (sätt den i Cloudflare Pages env)' }, 500);

  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(series)}` +
    `&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=1&units=${encodeURIComponent(units)}`;

  try {
    const r = await fetch(url);
    if (!r.ok) return json({ error: 'FRED HTTP ' + r.status }, r.status);
    const j = await r.json();
    const o = j.observations && j.observations[0];
    if (!o || o.value === '.' || o.value == null) return json({ error: 'ingen data' }, 404);
    return new Response(JSON.stringify({ value: parseFloat(o.value), date: o.date }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
