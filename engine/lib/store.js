// Skriver signaler till Supabase via PostgREST (ingen npm-dependency behövs).
// Använder service-nyckeln → kringgår RLS. Upsert på unika constraint:en
// (source, external_id, ticker) ger idempotens. Se supabase-signals.sql.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Skriv rader till signals. Upsert (merge-duplicates) så en omkörning inte
// dubblerar. Returnerar antalet skickade rader.
async function upsertSignals(rows) {
  if (!rows.length) return 0;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }

  const url =
    `${SUPABASE_URL}/rest/v1/signals?on_conflict=source,external_id,ticker`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      // merge-duplicates = upsert; minimal = returnera inget (snabbare).
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase-skrivning misslyckades (${res.status}): ${detail}`);
  }
  return rows.length;
}

// Hämtar redan lagrade external_id:n för en källa (senaste raderna) så motorn
// kan hoppa över dokument som redan analyserats – sparar AI-kostnad vid omkörning.
async function recentExternalIds(source, limit = 1000) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const url =
    `${SUPABASE_URL}/rest/v1/signals?select=external_id&source=eq.` +
    `${encodeURIComponent(source)}&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase-läsning misslyckades (${res.status}): ${detail}`);
  }
  const rows = await res.json();
  return new Set(rows.map((r) => r.external_id));
}

module.exports = { upsertSignals, recentExternalIds };
