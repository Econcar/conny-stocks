// Motorn: orkestrerar hela pipelinen.
//   källadaptrar → normalisering → AI-triage → signals-tabellen (Supabase)
//
// Körs som schemalagt jobb (GitHub Actions) men kan också köras lokalt.
// Se docs/signal-pipeline-spec.md och engine/README.md.
//
// Flaggor:
//   --demo   inkludera demokällan (testa kedjan utan riktig datakälla)
//   --dry    kör allt utom skrivningen till Supabase (skriv ut i stället)
//   --source=<id>  kör bara en angiven källa

require('./lib/env'); // ladda engine/.env FÖRST – innan moduler läser process.env

const { getSources } = require('./sources');
const { validateDocument, toSignalRows } = require('./lib/schema');
const { analyze, deepAnalyze, TRIAGE_MODEL, DEEP_MODEL } = require('./lib/anthropic');
const { upsertSignals, recentExternalIds } = require('./lib/store');

// Kaskad (Fas 2): materiella dokument (impact ≥ tröskel) skickas vidare till
// djupanalys med en starkare modell. Max-taket bundnar kostnaden per varv.
const DEEP_ENABLED = process.env.ENGINE_DEEP_ENABLED !== 'false';
const DEEP_THRESHOLD = Number(process.env.ENGINE_DEEP_THRESHOLD || 0.6);
const DEEP_MAX = Number(process.env.ENGINE_DEEP_MAX || 10);

function parseArgs(argv) {
  const args = { demo: false, dry: false, source: null, riskOnly: false, trendsOnly: false, discover: false, fundsOnly: false };
  for (const a of argv.slice(2)) {
    if (a === '--demo') args.demo = true;
    else if (a === '--dry') args.dry = true;
    else if (a === '--risk-only') args.riskOnly = true;
    else if (a === '--trends-only') args.trendsOnly = true;
    else if (a === '--discover') args.discover = true;
    else if (a === '--funds-only') args.fundsOnly = true;
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
  }
  return args;
}

// Trendspaning: AI föreslår nya teman (körs veckovis i det schemalagda jobbet).
async function runDiscovery() {
  try {
    const { discoverThemes } = require('./lib/discovery');
    const info = await discoverThemes();
    console.log(`Trendspaning (${info.model}): ${info.proposed} förslag, ${info.added.length} nya${info.added.length ? ' – ' + info.added.join(', ') : ''}.`);
  } catch (err) {
    console.error(`Trendspaning misslyckades: ${err.message}`);
  }
}

// Daglig AI-sammanvägning av riskbarometern (körs efter källorna).
async function runDailyRisk() {
  try {
    const { runRiskAnalysis } = require('./lib/risk');
    const info = await runRiskAnalysis();
    console.log(`Riskbarometer-analys sparad för ${info.date} (${info.model}, ${info.indicators} indikatorer).`);
  } catch (err) {
    console.error(`Riskbarometer-analys misslyckades: ${err.message}`);
  }
}

// Schemalagd omvärdering av AI-fonder (körs på servern enligt varje fonds intervall).
async function runDailyAIFunds() {
  try {
    const { runAIFunds } = require('./lib/aifunds');
    const info = await runAIFunds();
    console.log(`AI-fonder: ${info.total} totalt, ${info.due} dags att omvärdera, ${info.done} omvärderade${info.errs ? `, ${info.errs} fel` : ''}.`);
  } catch (err) {
    console.error(`AI-fond-omvärdering misslyckades: ${err.message}`);
  }
}

// Daglig AI-analys av megatrender (grundad i signalerna).
async function runDailyTrends() {
  try {
    console.log('Megatrend-analys:');
    const { runMegatrends } = require('./lib/megatrends');
    const info = await runMegatrends();
    console.log(`Megatrend-analys sparad för ${info.date}: ${info.themes.join(', ') || 'inga teman'}.`);
  } catch (err) {
    console.error(`Megatrend-analys misslyckades: ${err.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  // Bara en delanalys (billig test/omkörning).
  if (args.riskOnly) {
    console.log('Kör endast riskbarometer-analysen.');
    await runDailyRisk();
    return;
  }
  if (args.trendsOnly) {
    console.log('Kör endast megatrend-analysen.');
    await runDailyTrends();
    return;
  }
  if (args.discover) {
    console.log('Kör endast trendspaningen.');
    await runDiscovery();
    return;
  }
  if (args.fundsOnly) {
    console.log('Kör endast AI-fond-omvärderingen.');
    await runDailyAIFunds();
    return;
  }

  let sources = getSources({ includeDemo: args.demo });
  if (args.source) sources = sources.filter((s) => s.id === args.source);

  if (!sources.length) {
    console.log(
      'Inga källor registrerade. Lägg till en adapter i engine/sources/index.js ' +
      '(eller kör med --demo för att testa kedjan).'
    );
    return;
  }

  const deepInfo = DEEP_ENABLED ? `${DEEP_MODEL} vid impact≥${DEEP_THRESHOLD} (max ${DEEP_MAX})` : 'av';
  console.log(`Motorn startar. Triage: ${TRIAGE_MODEL}. Djupanalys: ${deepInfo}. Källor: ${sources.map((s) => s.id).join(', ')}${args.dry ? ' [DRY]' : ''}`);

  const allRows = [];
  let docCount = 0;
  let deepCount = 0;
  let errCount = 0;

  for (const source of sources) {
    let docs;
    try {
      docs = await source.fetch();
    } catch (err) {
      console.error(`[${source.id}] fetch misslyckades: ${err.message}`);
      errCount++;
      continue;
    }
    // Validera alla dokument först.
    const valid = [];
    for (const raw of docs) {
      try {
        valid.push(validateDocument(raw));
      } catch (err) {
        console.error(`[${source.id}] ogiltigt dokument: ${err.message}`);
        errCount++;
      }
    }

    // Hoppa över dokument som redan finns lagrade (sparar AI-kostnad).
    // Skippas i --dry (då rör vi inte Supabase alls).
    let fresh = valid;
    if (!args.dry) {
      try {
        const seen = await recentExternalIds(source.id);
        fresh = valid.filter((d) => !seen.has(d.external_id));
      } catch (err) {
        console.error(`[${source.id}] dedup-koll misslyckades, analyserar alla: ${err.message}`);
      }
    }
    console.log(`[${source.id}] ${docs.length} dokument, ${fresh.length} nya att analysera`);

    for (const doc of fresh) {
      try {
        // Steg 1: triage på allt.
        let analysis = await analyze(doc);
        let model = TRIAGE_MODEL;

        // Steg 2: djupanalys om triagen flaggar materiellt (och taket inte nåtts).
        if (DEEP_ENABLED && (analysis.impact_score || 0) >= DEEP_THRESHOLD && deepCount < DEEP_MAX) {
          try {
            analysis = await deepAnalyze(doc);
            model = DEEP_MODEL;
            deepCount++;
          } catch (err) {
            console.error(`  ⚠ djupanalys föll för ${doc.external_id}, behåller triage: ${err.message}`);
          }
        }

        const rows = toSignalRows(doc, analysis, model);
        allRows.push(...rows);
        docCount++;
        const deep = model === DEEP_MODEL ? ' ⬆djup' : '';
        console.log(
          `  ✓ ${doc.external_id} → ${analysis.sentiment} ` +
          `impact=${analysis.impact_score} tickers=[${(analysis.tickers || []).join(',')}]${deep}`
        );
      } catch (err) {
        console.error(`  ✗ ${doc.external_id}: ${err.message}`);
        errCount++;
      }
    }
  }

  if (args.dry) {
    console.log(`\n[DRY] ${allRows.length} rader skulle skrivas:`);
    console.log(JSON.stringify(allRows, null, 2));
  } else if (allRows.length) {
    const written = await upsertSignals(allRows);
    console.log(`\nSkrev ${written} rader till signals.`);
  } else {
    console.log('\nInga rader att skriva.');
  }

  console.log(`Klart. ${docCount} dokument analyserade (${deepCount} djupanalyserade), ${errCount} fel.`);

  // Dagliga AI-analyser (skippas i --dry).
  if (!args.dry) {
    await runDailyRisk();
    await runDailyTrends();
    await runDailyAIFunds();
    // Trendspaning körs veckovis (måndagar UTC) för att hålla nere brus/kostnad.
    if (new Date().getUTCDay() === 1) await runDiscovery();
  }

  if (errCount && !docCount) process.exit(1); // allt föll → låt jobbet fallera
}

main().catch((err) => {
  console.error('Motorn kraschade:', err);
  process.exit(1);
});
