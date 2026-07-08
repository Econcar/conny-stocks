// Gemensamt dokumentformat (input till analys) och output-schema (från AI).
// Se docs/signal-pipeline-spec.md §5–6. Källoberoende: alla adaptrar
// normaliserar till samma dokument, analyssteget ställer samma fråga.

// Ett normaliserat dokument som en adapter producerar.
// {
//   source:       "sec_edgar",              // adapterns id
//   type:         "filing_8k",              // signaltyp
//   external_id:  "0001...",                // för dedup (unikt inom källan)
//   url:          "https://...",
//   published_at: "2026-07-08T12:00:00Z",   // ISO 8601
//   title:        "…",
//   text:         "…",                       // råtext att analysera
//   hint_tickers: ["AAPL"]                   // valfritt, om källan redan vet
// }

// Fälten AI:n ska fylla i. Används som verktygs-schema (tvingad tool_use)
// så vi garanterat får parsbar JSON tillbaka.
const ANALYSIS_TOOL = {
  name: 'record_analysis',
  description:
    'Registrera analysen av dokumentet. Bedöm kurspåverkan för berörda börsbolag.',
  input_schema: {
    type: 'object',
    properties: {
      sentiment: {
        type: 'string',
        enum: ['positiv', 'neutral', 'negativ'],
        description: 'Övergripande ton för kurspåverkan.'
      },
      impact_score: {
        type: 'number',
        description: 'Uppskattad kurspåverkan, 0 (ingen) till 1 (mycket stor).'
      },
      tickers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Berörda börstickers (t.ex. "AAPL", "VOLV-B.ST"). Tom lista om enbart makro/marknadsbred.'
      },
      sectors: {
        type: 'array',
        items: { type: 'string' },
        description: 'Berörda sektorer (t.ex. "Teknik", "Fordon").'
      },
      summary: {
        type: 'string',
        description: 'Kort svensk sammanfattning (1–2 meningar) av vad som hänt och varför det spelar roll.'
      },
      confidence: {
        type: 'number',
        description: 'Hur säker bedömningen är, 0 till 1.'
      }
    },
    required: ['sentiment', 'impact_score', 'tickers', 'sectors', 'summary', 'confidence']
  }
};

// Validera/normalisera ett adapter-dokument innan analys. Kastar vid trasig input.
function validateDocument(doc) {
  for (const field of ['source', 'type', 'external_id']) {
    if (!doc[field] || typeof doc[field] !== 'string') {
      throw new Error(`Dokument saknar obligatoriskt fält: ${field}`);
    }
  }
  if (!doc.text && !doc.title) {
    throw new Error(`Dokument ${doc.source}/${doc.external_id} saknar både text och title`);
  }
  return {
    source: doc.source,
    type: doc.type,
    external_id: String(doc.external_id),
    url: doc.url || null,
    published_at: doc.published_at || null,
    title: doc.title || '',
    text: doc.text || doc.title || '',
    hint_tickers: Array.isArray(doc.hint_tickers) ? doc.hint_tickers : []
  };
}

// Expandera ett analyserat dokument till rader för signals-tabellen –
// en rad per berörd ticker (eller en marknadsbred rad om inga tickers).
function toSignalRows(doc, analysis) {
  const base = {
    source: doc.source,
    type: doc.type,
    external_id: doc.external_id,
    url: doc.url,
    published_at: doc.published_at,
    sentiment: analysis.sentiment,
    impact_score: clamp01(analysis.impact_score),
    summary: analysis.summary,
    confidence: clamp01(analysis.confidence)
  };
  const sector = (analysis.sectors && analysis.sectors[0]) || null;
  const tickers = analysis.tickers && analysis.tickers.length ? analysis.tickers : [''];
  return tickers.map((ticker) => ({ ...base, ticker: ticker || '', sector }));
}

function clamp01(n) {
  const x = Number(n);
  if (!isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

module.exports = { ANALYSIS_TOOL, validateDocument, toSignalRows };
