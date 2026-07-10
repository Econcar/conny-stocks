// Daglig AI-analys av megatrender / investeringsteman.
// Grundas i de färska signaler motorn samlat (matchas per tema på nyckelord),
// så analysen speglar dagens nyhetsläge – inte modellens träningsdata.

const { synthesize } = require('./anthropic');
const { recentSignals, upsertMegatrend, getThemes } = require('./store');

const TREND_MODEL = process.env.ENGINE_TREND_MODEL; // default = synthesize's default (djupmodell)

// Fallback-teman om databasen är tom/otillgänglig (matchar seedet i supabase-themes.sql).
const SEED_THEMES = [
  { id: 'ai',             name: 'AI & halvledare',       kw: ['ai', 'artificial intelligence', 'halvledar', 'chip', 'gpu', 'nvidia', 'semiconductor', 'datacenter', 'språkmodell', 'llm', 'openai', 'tsmc', 'amd', 'broadcom', 'avgo', 'nvda'] },
  { id: 'electrification', name: 'Elektrifiering & EV',   kw: ['elbil', 'battery', 'batteri', 'laddning', 'tesla', 'elektrifiering', 'rivian', 'lucid', 'byd', 'charging', 'tsla', 'polestar'] },
  { id: 'defense',        name: 'Försvar & säkerhet',    kw: ['försvar', 'vapen', 'militär', 'nato', 'saab', 'lockheed', 'defense', 'missile', 'rheinmetall', 'upprustning', 'ukraina', 'lmt'] },
  { id: 'energy',         name: 'Energiomställning',     kw: ['energi', 'olja', 'oil', 'gas', 'vätgas', 'hydrogen', 'kärnkraft', 'nuclear', 'förnybar', 'renewable', 'sol', 'vind', 'wind', 'solar', 'xom', 'cvx'] },
  { id: 'health',         name: 'Hälsa & demografi',     kw: ['läkemedel', 'pharma', 'hälsa', 'bioteknik', 'biotech', 'novo', 'glp-1', 'vård', 'healthcare', 'vaccin', 'eli lilly', 'obesity', 'lly'] },
];

function matches(sig, kw) {
  const hay = ((sig.summary || '') + ' ' + (sig.ticker || '') + ' ' + (sig.sector || '')).toLowerCase();
  return kw.some(k => hay.includes(k));
}

// Aktiva teman från DB, med fallback till seedet.
async function activeThemes() {
  try {
    const rows = await getThemes('active');
    if (rows && rows.length) return rows.map(r => ({ id: r.id, name: r.name, kw: r.keywords || [] }));
  } catch (e) {
    console.error(`[megatrends] kunde inte läsa teman, använder seed: ${e.message}`);
  }
  return SEED_THEMES;
}

async function runMegatrends() {
  let signals = [];
  try {
    signals = await recentSignals({ days: 5, limit: 400 });
  } catch (e) {
    console.error(`[megatrends] kunde inte läsa signaler: ${e.message}`);
  }

  const themes = await activeThemes();
  const date = new Date().toISOString().slice(0, 10);
  const done = [];

  for (const t of themes) {
    const rel = signals.filter(s => matches(s, t.kw)).slice(0, 25);
    const ctx = rel.length
      ? rel.map(s => `- ${s.summary}${s.ticker ? ` [${s.ticker}]` : ''} (impact ${s.impact_score != null ? s.impact_score : '?'})`).join('\n')
      : '(Inga specifika nyheter matchade temat de senaste dagarna.)';

    const prompt =
      `Du är en investeringsanalytiker med fokus på långsiktiga teman. Tema: ${t.name}.\n\n` +
      `Relevanta nyheter/signaler från de senaste dagarna:\n${ctx}\n\n` +
      `Analysera hur temat utvecklas just nu: viktigaste drivkrafterna, vilka sektorer och ` +
      `bolag som gynnas eller missgynnas, samt de största riskerna. Väg in nyheterna ovan där ` +
      `de är relevanta (men fyll på med din egen kunskap om temat). Håll det till 4–6 meningar ` +
      `på svenska och avsluta med en kort utsikt på egen rad i formatet "Utsikt: <kort omdöme>".`;

    try {
      const { text, model } = await synthesize(prompt, { model: TREND_MODEL, maxTokens: 900 });
      await upsertMegatrend({ date, theme: t.id, name: t.name, analysis: text, signal_count: rel.length, model });
      done.push(`${t.name} (${rel.length} signaler)`);
      console.log(`  ✓ ${t.name}: ${rel.length} signaler grundade analysen`);
    } catch (e) {
      console.error(`[megatrends] ${t.name} misslyckades: ${e.message}`);
    }
  }
  return { date, themes: done };
}

module.exports = { runMegatrends, SEED_THEMES };
