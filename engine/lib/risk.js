// Daglig AI-sammanvägning av riskbarometern.
// Hämtar risk-/sentimentindikatorer från Yahoo, låter en stark modell väga
// samman dem, och sparar resultatet i risk_analysis (en rad per dag).

const { synthesize } = require('./anthropic');
const { upsertRiskAnalysis } = require('./store');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Samma indikatorer som riskbarometern i appen.
const INDICATORS = [
  { sym: '^VIX',     label: 'VIX (S&P 500-volatilitet, "skräckindex")' },
  { sym: '^VXN',     label: 'VXN (Nasdaq-volatilitet)' },
  { sym: '^SKEW',    label: 'SKEW (prissatt svans-/kraschrisk)' },
  { sym: 'DX-Y.NYB', label: 'Dollarindex (DXY)' },
  { sym: 'GC=F',     label: 'Guld' },
  { sym: 'HG=F',     label: 'Koppar ("Dr Copper")' },
  { sym: '^TNX',     label: '10-årsränta USA' },
  { sym: 'HYG',      label: 'High yield-kredit (HYG-ETF)' },
  { sym: 'BTC-USD',  label: 'Bitcoin (riskaptit)' },
];

async function fetchIndicators() {
  const syms = INDICATORS.map(i => i.sym).join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(syms)}&range=ytd&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Yahoo spark HTTP ' + res.status);
  const data = await res.json();
  const bySym = {};
  for (const r of (data.spark && data.spark.result) || []) {
    const resp = r.response && r.response[0];
    if (!resp) continue;
    const meta = resp.meta || {};
    const closes = ((resp.indicators && resp.indicators.quote[0] && resp.indicators.quote[0].close) || []).filter(v => v != null);
    const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : (closes.length ? closes[closes.length - 1] : null);
    if (price == null || !closes.length) continue;
    const ytd = ((price - closes[0]) / closes[0]) * 100;
    const monthAgo = closes[Math.max(0, closes.length - 22)];
    const mo = monthAgo ? ((price - monthAgo) / monthAgo) * 100 : null;
    bySym[r.symbol] = { price: +price.toFixed(4), ytd: +ytd.toFixed(1), mo: mo != null ? +mo.toFixed(1) : null };
  }
  return bySym;
}

async function runRiskAnalysis() {
  const bySym = await fetchIndicators();
  const fmt = n => Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('sv-SE') : n.toFixed(2);
  const lines = INDICATORS.map(i => {
    const d = bySym[i.sym];
    if (!d) return `- ${i.label}: data saknas`;
    const mo = d.mo != null ? `${d.mo >= 0 ? '+' : ''}${d.mo}% 1 mån` : '';
    const ytd = `${d.ytd >= 0 ? '+' : ''}${d.ytd}% i år`;
    return `- ${i.label}: ${fmt(d.price)} (${mo}${mo ? ', ' : ''}${ytd})`;
  }).join('\n');

  const prompt =
    'Du är en makro-/marknadsanalytiker. Här är dagens värden för en uppsättning ' +
    'risk- och sentimentindikatorer (med förändring senaste månaden och hittills i år):\n\n' +
    lines +
    '\n\nGör en SAMMANVÄGD bedömning på svenska av vad indikatorerna tillsammans säger: ' +
    'lutar marknaden mot risk-på eller risk-av just nu, och hur starkt? Vilka indikatorer ' +
    'drar åt vilket håll, och finns det motstridiga signaler? Vad betyder helheten för en ' +
    'långsiktig svensk investerare? Håll det till 4–6 meningar och avsluta med en tydlig ' +
    'endagsslutsats på egen rad i formatet "Läget: <kort omdöme>".';

  const { text, model } = await synthesize(prompt, { maxTokens: 1024 });
  const date = new Date().toISOString().slice(0, 10);
  await upsertRiskAnalysis({ date, analysis: text, snapshot: bySym, model });
  return { date, model, indicators: Object.keys(bySym).length };
}

module.exports = { runRiskAnalysis, fetchIndicators };
