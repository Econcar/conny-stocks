// AI-analyssteget (delat, källoberoende). Triage med Haiku 4.5 – körs på allt.
// Tvingad tool_use ger garanterat parsbar JSON. Prompt caching på den fasta
// instruktionen (cache_control) → billigt över många dokument.
// Se docs/signal-pipeline-spec.md §6.

const { ANALYSIS_TOOL } = require('./schema');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ENGINE_TRIAGE_MODEL || 'claude-haiku-4-5';

// Fast instruktion – ligger först med cache_control så den cachas mellan anrop.
const SYSTEM_PROMPT = [
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

// Analysera ett normaliserat dokument. Returnerar analysobjektet
// (sentiment, impact_score, tickers, sectors, summary, confidence).
async function analyze(doc) {
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
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
      messages: [{ role: 'user', content: userText }]
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic-anrop misslyckades (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error(`Inget tool_use-svar för ${doc.source}/${doc.external_id}`);
  }
  return toolUse.input;
}

module.exports = { analyze, MODEL };
