// Daglig CIO-analys: taktisk tillgångsallokering (regim, räntor, riskaptit,
// geopolitik, sektorer, svart svan). Samma systemprompt och underlag som knappen
// på Översikt – båda hämtar från ../../shared/cio.js. Marknadsdatan tas via
// appens egna /api-proxys (samma siffror som i appen, och FRED-nyckeln ligger
// redan i Cloudflare). Sparas i cio_analysis, en rad per dag.

const { CIO_MODEL, CIO_SYSTEM_PROMPT, cioGatherMarketData, buildCioContext, cioUserMessage } = require('../../shared/cio');
const { synthesize } = require('./anthropic');
const { upsertCioAnalysis, latestMegatrends, recentSignals } = require('./store');

const APP_URL = (process.env.ENGINE_APP_URL || 'https://conny-stocks.pages.dev').replace(/\/$/, '');

async function runCioAnalysis() {
  const [market, megatrends, signals] = await Promise.all([
    cioGatherMarketData({ base: APP_URL }),
    latestMegatrends().catch(err => { console.error(`  CIO: megatrender kunde inte läsas: ${err.message}`); return []; }),
    recentSignals({ days: 5, limit: 400 }).catch(err => { console.error(`  CIO: nyheter kunde inte läsas: ${err.message}`); return []; })
  ]);
  if (!Object.keys(market.spark).length) throw new Error(`ingen marknadsdata från ${APP_URL}/api/yahoo`);

  const ctx = buildCioContext({ ...market, megatrends, headlines: signals });
  // Icke-strömmande anrop: effort "medium" håller tänkandet (och svarstiden) nere,
  // och 16000 ger gott om rum för tänkande + promemoria (max_tokens gäller båda).
  const model = process.env.ENGINE_CIO_MODEL || CIO_MODEL;
  const { text } = await synthesize(cioUserMessage(ctx), {
    model, system: CIO_SYSTEM_PROMPT, maxTokens: 16000, effort: 'medium', context: 'engine-cio'
  });
  if (!text) throw new Error('tomt svar från modellen');
  await upsertCioAnalysis({ date: ctx.as_of, analysis: text, snapshot: ctx, model });
  return { date: ctx.as_of, model, symbols: Object.keys(market.spark).length, headlines: ctx.headlines.length };
}

module.exports = { runCioAnalysis };
