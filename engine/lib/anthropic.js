// AI-analyssteget (delat, källoberoende). Tvåstegs-kaskad (spec §6.1):
//   1. Triage – Haiku 4.5, körs på ALLT.
//   2. Djupanalys – Sonnet 4.6, bara på materiellt flaggade dokument.
// Tvingad tool_use ger garanterat parsbar JSON. Prompt caching på den fasta
// instruktionen (cache_control) → billigt över många dokument.

const { ANALYSIS_TOOL, DEEP_ANALYSIS_TOOL } = require('./schema');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const TRIAGE_MODEL = process.env.ENGINE_TRIAGE_MODEL || 'claude-haiku-4-5';
// Sonnet 4.6 för djupanalys/risk/megatrender – stark nog för nyhetsanalys men
// klart billigare än Opus. Sätt ENGINE_DEEP_MODEL=claude-opus-4-8 för att gå tillbaka.
const DEEP_MODEL = process.env.ENGINE_DEEP_MODEL || 'claude-sonnet-4-6';

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
async function runAnalysis(doc, { model, system, tool, maxTokens }) {
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
  const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error(`Inget tool_use-svar för ${doc.source}/${doc.external_id}`);
  }
  return toolUse.input;
}

// Steg 1 – triage (Haiku), körs på allt.
function analyze(doc) {
  return runAnalysis(doc, { model: TRIAGE_MODEL, system: TRIAGE_SYSTEM, tool: ANALYSIS_TOOL, maxTokens: 1024 });
}

// Steg 2 – djupanalys (Opus), bara på materiellt flaggade dokument.
function deepAnalyze(doc) {
  return runAnalysis(doc, { model: DEEP_MODEL, system: DEEP_SYSTEM, tool: DEEP_ANALYSIS_TOOL, maxTokens: 1536 });
}

// Fri textsyntes (utan verktyg) – för t.ex. daglig riskbarometer-sammanvägning.
async function synthesize(prompt, opts = {}) {
  if (!API_KEY) throw new Error('Saknar ANTHROPIC_API_KEY i miljön');
  const model = opts.model || process.env.ENGINE_RISK_MODEL || DEEP_MODEL;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens || 1024, messages: [{ role: 'user', content: prompt }] })
  });
  if (!res.ok) throw new Error(`Anthropic-anrop (${model}) misslyckades (${res.status}): ${await res.text()}`);
  const data = await res.json();
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
  const toolUse = (data.content || []).find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('Inget tool_use-svar');
  return { input: toolUse.input, model };
}

module.exports = { analyze, deepAnalyze, synthesize, extract, TRIAGE_MODEL, DEEP_MODEL };
