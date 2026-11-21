// Enhetstester för CIO-analysens underlag (shared/cio.js – delas av appen och motorn).
// Körs med:  node --test test/
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildCioContext, cioHeadlines, cioGatherMarketData, CIO_SYMBOLS } = require('../shared/cio.js');

// 100 handelsdagar som stiger linjärt från `from` till `to`.
const series = (from, to) => {
  const closes = Array.from({ length: 100 }, (_, i) => from + (to - from) * i / 99);
  return { price: to, closes };
};

test('räntor räknas i procentenheter, övrigt i procent', () => {
  const ctx = buildCioContext({ spark: { '^TNX': series(4, 5), '^IRX': series(4, 4), '^VIX': series(20, 15) } });
  const y = ctx.us_treasury_yields.us_10y_pct;
  assert.equal(y.value, 5);
  assert.equal(y.chg_6m_pp, 1);                 // 4 → 5 = +1 procentenhet, inte +25 %
  assert.equal(ctx.yield_curve_10y_minus_3m_pp, 1);
  assert.equal(ctx.risk_and_credit.vix.chg_6m_pct, -25);
});

test('koppar/guld-kvoten och HYG/IEF räknas ur båda serierna', () => {
  const ctx = buildCioContext({ spark: {
    'HG=F': series(4, 6), 'GC=F': series(4000, 4000), 'HYG': series(80, 80), 'IEF': series(100, 80)
  } });
  assert.equal(ctx.commodities.copper_gold_ratio_x1000.value, 1.5);
  assert.equal(ctx.commodities.copper_gold_ratio_x1000.chg_6m_pct, 50);
  assert.equal(ctx.risk_and_credit.hyg_ief_ratio.chg_6m_pct, 25);
});

test('saknad data blir null, inte ett fel', () => {
  const ctx = buildCioContext({});
  assert.equal(ctx.us_treasury_yields.us_10y_pct, null);
  assert.equal(ctx.commodities.copper_gold_ratio_x1000, null);
  assert.equal(ctx.central_banks_and_inflation.fed_funds_target_pct, null);
  assert.deepEqual(ctx.headlines, []);
});

test('rubriker: dubbletter och gamla bort, makroflödet före bolagsfilingar', () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  const out = cioHeadlines([
    { summary: 'Bolag X likviderar', source: 'sec_edgar', impact_score: 0.9, published_at: now },
    { summary: 'Tullar höjs', source: 'rss', impact_score: 0.5, published_at: now },
    { summary: 'tullar höjs ', source: 'gdelt', impact_score: 0.4, published_at: now },
    { summary: 'Gammal nyhet', source: 'rss', impact_score: 1, published_at: old },
    { summary: 'Konflikt eskalerar', source: 'gdelt', impact_score: 0.8, published_at: now }
  ]);
  assert.deepEqual(out.map(h => h.headline), ['Konflikt eskalerar', 'Tullar höjs', 'Bolag X likviderar']);
});

test('hämtningen: en strulande källa ger null i sitt fält, resten fylls', async () => {
  const fetchImpl = async url => {
    if (url.includes('/api/rates')) return { ok: false, status: 500 };
    if (url.includes('CPIAUCSL')) return { ok: true, json: async () => ({ value: 3.2, date: '2026-08-01' }) };
    if (url.includes('/api/yahoo')) return { ok: true, json: async () => ({ spark: { result: [
      { symbol: '^TNX', response: [{ meta: { regularMarketPrice: 5 }, indicators: { quote: [{ close: [4, null, 5] }] } }] }
    ] } }) };
    return { ok: true, json: async () => ({}) };
  };
  const raw = await cioGatherMarketData({ base: 'https://x', fetchImpl });
  assert.deepEqual(raw.rates, {});
  assert.deepEqual(raw.macro.us_cpi, { value: 3.2, date: '2026-08-01' });
  assert.deepEqual(raw.spark['^TNX'].closes, [4, 5]);
});

test('spark-frågorna tar max 20 symboler var och täcker alla', async () => {
  const asked = [];
  const fetchImpl = async url => {
    if (url.includes('/api/yahoo')) {
      const inner = new URL(decodeURIComponent(url.split('url=')[1]));
      asked.push(inner.searchParams.get('symbols').split(','));
    }
    return { ok: true, json: async () => ({}) };
  };
  await cioGatherMarketData({ base: 'https://x', fetchImpl });
  const all = Object.values(CIO_SYMBOLS).flatMap(g => Object.keys(g));
  assert.ok(asked.every(c => c.length <= 20), asked.map(c => c.length).join('+'));
  assert.deepEqual(asked.flat().sort(), all.sort());
});

test('svenska räntor: riskfri SEK-ränta, realränta och räntegap mot USA', async () => {
  let ratesUrl = null;
  await cioGatherMarketData({ base: 'https://x', fetchImpl: async url => {
    if (url.includes('/api/rates')) ratesUrl = url;
    return { ok: true, json: async () => ({}) };
  } });
  assert.ok(/[?&]se=1/.test(ratesUrl), 'CIO-hämtningen ber om svenska räntor');

  const ctx = buildCioContext({
    spark: { '^IRX': series(4, 4), '^TNX': series(4, 4.5) },
    rates: { se: { tbill_3m: { rate: 2.171, date: '2026-11-20' }, gov_10y: { rate: 3.004, date: '2026-11-20' } } },
    macro: { se_kpif: { value: 1.1, date: '2026-10' } }
  });
  assert.deepEqual(ctx.swedish_rates.se_tbill_3m_pct, { value: 2.17, as_of: '2026-11-20' });
  assert.equal(ctx.swedish_rates.se_curve_10y_minus_3m_pp, 0.83);
  assert.equal(ctx.sek_perspective.riskfree_sek_3m_pct, 2.17);
  assert.equal(ctx.sek_perspective.real_riskfree_sek_3m_pp, 1.07);
  assert.equal(ctx.sek_perspective.us_minus_se_3m_pp, 1.83);
  assert.equal(ctx.sek_perspective.us_minus_se_10y_pp, 1.5);
  // utan svenska räntor: null, inte fel
  assert.equal(buildCioContext({}).sek_perspective.riskfree_sek_3m_pct, null);
});
