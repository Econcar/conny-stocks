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

const { getSources } = require('./sources');
const { validateDocument, toSignalRows } = require('./lib/schema');
const { analyze, MODEL } = require('./lib/anthropic');
const { upsertSignals, recentExternalIds } = require('./lib/store');

function parseArgs(argv) {
  const args = { demo: false, dry: false, source: null };
  for (const a of argv.slice(2)) {
    if (a === '--demo') args.demo = true;
    else if (a === '--dry') args.dry = true;
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  let sources = getSources({ includeDemo: args.demo });
  if (args.source) sources = sources.filter((s) => s.id === args.source);

  if (!sources.length) {
    console.log(
      'Inga källor registrerade. Lägg till en adapter i engine/sources/index.js ' +
      '(eller kör med --demo för att testa kedjan).'
    );
    return;
  }

  console.log(`Motorn startar. Modell: ${MODEL}. Källor: ${sources.map((s) => s.id).join(', ')}${args.dry ? ' [DRY]' : ''}`);

  const allRows = [];
  let docCount = 0;
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
        const analysis = await analyze(doc);
        const rows = toSignalRows(doc, analysis);
        allRows.push(...rows);
        docCount++;
        console.log(
          `  ✓ ${doc.external_id} → ${analysis.sentiment} ` +
          `impact=${analysis.impact_score} tickers=[${(analysis.tickers || []).join(',')}]`
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

  console.log(`Klart. ${docCount} dokument analyserade, ${errCount} fel.`);
  if (errCount && !docCount) process.exit(1); // allt föll → låt jobbet fallera
}

main().catch((err) => {
  console.error('Motorn kraschade:', err);
  process.exit(1);
});
