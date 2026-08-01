// AI-analyssteget (delat, källoberoende). Tvåstegs-kaskad (spec §6.1):
//   1. Triage – Haiku 4.5, körs på ALLT.
//   2. Djupanalys – Sonnet 4.6, bara på materiellt flaggade dokument.
// Tvingad tool_use ger garanterat parsbar JSON. Prompt caching på den fasta
// instruktionen (cache_control) → billigt över många dokument.

const { ANALYSIS_TOOL, DEEP_ANALYSIS_TOOL } = require('./schema');
const { recordAiUsage } = require('./store');

// USD per 1M tokens (in/ut) – Anthropics prislista. Samma tabell som i index.html;
// uppdatera BÅDA om Anthropic ändrar pris. Modeller utanför listan flaggas (okänt pris).
// (claude-sonnet-5 har intropris $2/$10 t.o.m. 2026-08-31; vi kör standard $3/$15.)
const PRICES = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-fable-5': { in: 10, out: 50 }
};

// Kostnad i USD för ett svar utifrån usage. Cache-skapande = 1,25×, cache-läsning = 0,1×.
function costUsd(model, u) {
  if (!u) return 0;
  const p = PRICES[model] || { in: 3, out: 15 };
  const inT = u.input_tokens || 0, outT = u.output_tokens || 0;
  const cr = u.cache_read_input_tokens || 0, cc = u.cache_creation_input_tokens || 0;
  const sr = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  return (inT * p.in + cc * p.in * 1.25 + cr * p.in * 0.1 + outT * p.out) / 1e6 + sr * 0.01;
}

// Varna en gång per okänd modell så att pristabellen kan uppdateras. Kostnaden
// räknas då med reservpriset ($3/$15) och är alltså en gissning.
const _warnedModels = new Set();
function warnUnknownModel(model) {
  if (!model || PRICES[model] || _warnedModels.has(model)) return;
  _warnedModels.add(model);
  console.error(`[ai_usage] okänd modell "${model}" – saknas i PRICES, kostnaden är en uppskattning. ` +
    'Uppdatera pristabellen i engine/lib/anthropic.js och index.html.');
}

// Loggar ett anrop till ai_usage (user_id null = motorn). Fire-and-forget: en
// kostnadslogg får aldrig fälla själva pipelinen, så fel sväljs.
async function logUsage(context, model, u) {
  warnUnknownModel(model);
  try {
    await recordAiUsage({
      context, model,
      input_tokens: (u && u.input_tokens) || 0,
      output_tokens: (u && u.output_tokens) || 0,
      cache_read_tokens: (u && u.cache_read_input_tokens) || 0,
      cache_create_tokens: (u && u.cache_creation_input_tokens) || 0,
      web_searches: (u && u.server_tool_use && u.server_tool_use.web_search_requests) || 0,
      cost_usd: costUsd(model, u)
    });
  } catch (err) {
    if (!logUsage._warned) { console.error(`[ai_usage] kunde inte logga kostnad: ${err.message}`); logUsage._warned = true; }
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
const TRIAGE_MODEL = process.env.ENGINE_TRIAGE_MODEL || 'claude-haiku-4-5';
// Sonnet 5 för djupanalys/risk/megatrender – Opus-nära kvalitet till Sonnet-pris.
// Sätt ENGINE_DEEP_MODEL=claude-opus-4-8 (dyrare) eller claude-sonnet-4-6 (äldre) för att byta.
const DEEP_MODEL = process.env.ENGINE_DEEP_MODEL || 'claude-sonnet-5';

// Fasta instruktioner – ligger först med cache_control så de cachas mellan anrop.
const TRIAGE_SYSTEM = [
  {
    type: 'text',
    text:
      'Du är en finansanalytiker som bedömer om en nyhet/händelse kan påverka ' +
      'aktiekurser. För varje dokument: avgör ton (sentiment), uppskattad ' +
      'kurspåverkan (impact_score 0–1), vilka börsbolag (tickers) och sektorer ' +
      'som berörs, en kort svensk sammanfattning, samt hur säker du är ' +
      '(confidence 0–1). Var konservativ: sätt låg impact_score för rutinnyheter ' +
      'och håll tickers tom om inget specifikt bolag berörs. Svara ALLTID genom ' +
      'att anropa verktyget record_analysis.',
    cache_control: { type: 'ephemeral' }
  }
];

const DEEP_SYSTEM = [
  {
    type: 'text',
    text:
      'Du är en senior finansanalytiker. Detta dokument har flaggats som ' +
      'potentiellt materiellt. Gör en fördjupad bedömning: väg in mekanismen ' +
      '(hur påverkas intäkter/marginaler/värdering), tidshorisont, andra- ' +
      'ordningens effekter (leverantörer, konkurrenter, sektor) och de största ' +
      'osäkerheterna. Sätt sentiment, en välkalibrerad impact_score (0–1), ' +
      'berörda tickers och sektorer, en kort sammanfattning, en fördjupad ' +
      'analys (fältet analysis), samt confidence. Var ärlig med osäkerhet. ' +
      'Svara ALLTID genom att anropa verktyget record_deep_analysis.',
    cache_control: { type: 'ephemeral' }
  }
];

// Gemensamt anrop mot Messages API med tvingat tool_use.
async function runAnalysis(doc, { model, system, tool, maxTokens, context }) {
  if (!API_KEY) throw new Error('Saknar ANTHROPIC_API_KEY i miljön');

  const hint = doc.hint_tickers.length
    ? `\nKällan tror att dessa tickers berörs: ${doc.hint_tickers.join(', ')}.`
    : '';
  const userText =
    `Källa: ${doc.source} (${doc.type})\n` +
    `Rubrik: ${doc.title}\n\n` +
    `${doc.text}${hint}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: userText }]
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic-anrop (${model}) misslyckades (${res.status}): ${detail}`);
  }

  const data = await res.json();
  await logUsage(context || 'engine', model, data.usage);
  varnaOmKapat(context || 'engine', model, data, maxTokens);
  const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error(`Inget tool_use-svar för ${doc.source}/${doc.external_id}`);
  }
  return toolUse.input;
}

// Steg 1 – triage (Haiku), körs på allt.
function analyze(doc) {
  return runAnalysis(doc, { model: TRIAGE_MODEL, system: TRIAGE_SYSTEM, tool: ANALYSIS_TOOL, maxTokens: 1024, context: 'engine-triage' });
}

// Steg 2 – djupanalys (Opus), bara på materiellt flaggade dokument.
function deepAnalyze(doc) {
  return runAnalysis(doc, { model: DEEP_MODEL, system: DEEP_SYSTEM, tool: DEEP_ANALYSIS_TOOL, maxTokens: 1536, context: 'engine-deep' });
}

// Fri textsyntes (utan verktyg) – för t.ex. daglig riskbarometer-sammanvägning.
// Varnar när ett svar kapats av max_tokens. Värt en egen kontroll: på Sonnet 5 är
// adaptivt tänkande PÅ som standard när thinking utelämnas (till skillnad från
// Sonnet 4.6), och max_tokens är ett tak på tänkande + svarstext TILLSAMMANS.
// Tankeblocken returneras dessutom tomma (display defaultar till "omitted"), så
// ett kapat svar syns bara som en text som slutar mitt i en mening.
function varnaOmKapat(context, model, data, maxTokens) {
  if (data && data.stop_reason === 'max_tokens') {
    console.error(`[${context}] ⚠ svaret kapades av max_tokens (${maxTokens}, ${model} förbrukade ` +
      `${(data.usage && data.usage.output_tokens) || '?'} utdata-tokens varav tänkandet inte syns). Höj taket.`);
  }
}

async function synthesize(prompt, opts = {}) {
  if (!API_KEY) throw new Error('Saknar ANTHROPIC_API_KEY i miljön');
  const model = opts.model || process.env.ENGINE_RISK_MODEL || DEEP_MODEL;
  const maxTokens = opts.maxTokens || 1024;
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  // effort styr hur djupt modellen tänker (låg/medel/hög). Utan den ligger Sonnet 5
  // på "high", vilket är onödigt djupt för en kort sammanfattning.
  if (opts.effort) body.output_config = { effort: opts.effort };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Anthropic-anrop (${model}) misslyckades (${res.status}): ${await res.text()}`);
  const data = await res.json();
  await logUsage(opts.context || 'engine-synthesize', model, data.usage);
  varnaOmKapat(opts.context || 'engine-synthesize', model, data, maxTokens);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { text, model };
}

// Generiskt structured-output-anrop: tvingar ett verktyg och returnerar dess input.
async function extract(prompt, tool, opts = {}) {
  if (!API_KEY) throw new Error('Saknar ANTHROPIC_API_KEY i miljön');
  const model = opts.model || process.env.ENGINE_DISCOVERY_MODEL || DEEP_MODEL;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: opts.maxTokens || 1024,
      tools: [tool], tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic-anrop (${model}) misslyckades (${res.status}): ${await res.text()}`);
  const data = await res.json();
  await logUsage(opts.context || 'engine-extract', model, data.usage);
  varnaOmKapat(opts.context || 'engine-extract', model, data, opts.maxTokens || 1024);
  const toolUse = (data.content || []).find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Inget tool_use-svar');
  return { input: toolUse.input, model };
}

module.exports = { analyze, deepAnalyze, synthesize, extract, costUsd, logUsage, TRIAGE_MODEL, DEEP_MODEL };
