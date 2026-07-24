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

// Skriver dagens riskbarometer-analys (en rad per dag, upsert på date).
async function upsertRiskAnalysis(row) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/risk_analysis?on_conflict=date`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase-skrivning (risk_analysis) misslyckades (${res.status}): ${detail}`);
  }
}

// Läser de senaste signalerna (för att grunda megatrend-analysen i färska nyheter).
async function recentSignals({ days = 5, limit = 400 } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/signals?select=summary,ticker,sector,impact_score,source` +
    `&published_at=gte.${encodeURIComponent(since)}&order=impact_score.desc&limit=${limit}`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase-läsning (signals) misslyckades (${res.status}): ${await res.text()}`);
  return res.json();
}

// Skriver en megatrend-analys (en rad per dag och tema, upsert).
async function upsertMegatrend(row) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/megatrends?on_conflict=date,theme`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) throw new Error(`Supabase-skrivning (megatrends) misslyckades (${res.status}): ${await res.text()}`);
}

// Läser teman (valfritt filtrerat på status).
async function getThemes(status) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/themes?select=id,name,keywords,status,origin${filter}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase-läsning (themes) misslyckades (${res.status}): ${await res.text()}`);
  return res.json();
}

// Lägger till nya teman (t.ex. AI-förslag). Hoppar över id:n som redan finns.
async function insertThemes(rows) {
  if (!rows.length) return 0;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/themes?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`Supabase-skrivning (themes) misslyckades (${res.status}): ${await res.text()}`);
  return rows.length;
}

// Läser alla AI-fonder (service-nyckel kringgår RLS) för schemalagd omvärdering.
async function getAIFunds() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_funds?select=id,data`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase-läsning (ai_funds) misslyckades (${res.status}): ${await res.text()}`);
  return res.json();
}

// Uppdaterar en AI-fonds data-blob efter omvärdering.
async function updateAIFundData(id, data) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_funds?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ data })
  });
  if (!res.ok) throw new Error(`Supabase-skrivning (ai_funds) misslyckades (${res.status}): ${await res.text()}`);
}

// Rapportkalendern: en rad per (ticker, rapportdatum). Upsert på den sammansatta
// nyckeln – nästa datum läggs till som ny rad, passerade rader lämnas orörda.
async function upsertEarnings(rows) {
  if (!rows.length) return 0;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/earnings_calendar?on_conflict=ticker,report_date`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`Supabase-skrivning (earnings_calendar) misslyckades (${res.status}): ${await res.text()}`);
  return rows.length;
}

// Två sorters bortrensning:
//  1) Passerade rapporter äldre än `pastCutoffDate` (håller "senaste veckan/månaden"
//     men slänger gammalt – och Yahoos trasiga datum långt bak i tiden, t.ex. 2019).
//  2) FRAMTIDA rader som inte skrivits om sedan `staleBeforeIso` = bolag som fallit ur
//     universumet (passerade rader rör vi inte här – deras updated_at fryser med flit).
async function pruneEarnings({ pastCutoffDate, staleBeforeIso }) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i miljön');
  }
  const del = async (query) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/earnings_calendar?${query}`, {
      method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'return=minimal' }
    });
    if (!res.ok) throw new Error(`Supabase-rensning (earnings_calendar) misslyckades (${res.status}): ${await res.text()}`);
  };
  if (pastCutoffDate) await del(`report_date=lt.${encodeURIComponent(pastCutoffDate)}`);
  if (staleBeforeIso) await del(`report_date=gte.${encodeURIComponent(new Date().toISOString().slice(0, 10))}&updated_at=lt.${encodeURIComponent(staleBeforeIso)}`);
  return true;
}

module.exports = {
  upsertSignals, recentExternalIds, upsertRiskAnalysis, recentSignals, upsertMegatrend,
  getThemes, insertThemes, getAIFunds, updateAIFundData, upsertEarnings, pruneEarnings
};
