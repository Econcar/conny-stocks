// Motorn: orkestrerar hela pipelinen.
//   källadaptrar → normalisering → AI-triage → signals-tabellen (Supabase)
//
// Körs som schemalagt jobb (GitHub Actions) men kan också köras lokalt.
// Se docs/signal-pipeline-spec.md och engine/README.md.
//
// Vilka jobb som körs och hur ofta ställs in i appen (AI-kostnader → Automatiska
// analyser) och läses ur engine_settings – se shared/engine-schedule.js.
//
// Flaggor:
//   --demo   inkludera demokällan (testa kedjan utan riktig datakälla)
//   --dry    kör allt utom skrivningen till Supabase (skriv ut i stället)
//   --source=<id>  kör bara en angiven källa
//   --risk-only, --trends-only, --discover, --cio-only, --funds-only, --earnings-only
//            kör bara ett jobb – oavsett paus och intervall i appen

require('./lib/env'); // ladda engine/.env FÖRST – innan moduler läser process.env

const { getSources } = require('./sources');
const { validateDocument, toSignalRows } = require('./lib/schema');
const { analyze, deepAnalyze, creditsExhausted, BILLING_URL, TRIAGE_MODEL, DEEP_MODEL } = require('./lib/anthropic');
const { upsertSignals, recentExternalIds, recordAiUsage, getEngineSettings, markEngineRun, lastAiUsageAt } = require('./lib/store');
const { ENGINE_JOBS, engineSettingsMerge, engineJobDue } = require('../shared/engine-schedule');

// Kaskad (Fas 2): materiella dokument (impact ≥ tröskel) skickas vidare till
// djupanalys med en starkare modell. Max-taket bundnar kostnaden per varv.
const DEEP_ENABLED = process.env.ENGINE_DEEP_ENABLED !== 'false';
const DEEP_THRESHOLD = Number(process.env.ENGINE_DEEP_THRESHOLD || 0.6);
const DEEP_MAX = Number(process.env.ENGINE_DEEP_MAX || 10);

function parseArgs(argv) {
  const args = { demo: false, dry: false, source: null, riskOnly: false, trendsOnly: false, discover: false, fundsOnly: false, earningsOnly: false, cioOnly: false };
  for (const a of argv.slice(2)) {
    if (a === '--demo') args.demo = true;
    else if (a === '--dry') args.dry = true;
    else if (a === '--cio-only') args.cioOnly = true;
    else if (a === '--earnings-only') args.earningsOnly = true;
    else if (a === '--risk-only') args.riskOnly = true;
    else if (a === '--trends-only') args.trendsOnly = true;
    else if (a === '--discover') args.discover = true;
    else if (a === '--funds-only') args.fundsOnly = true;
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
  }
  return args;
}

// Jobben nedan returnerar true när de gick igenom – då noteras körningen i schemat.

// Trendspaning: AI föreslår nya teman.
async function runDiscovery() {
  try {
    const { discoverThemes } = require('./lib/discovery');
    const info = await discoverThemes();
    console.log(`Trendspaning (${info.model}): ${info.proposed} förslag, ${info.added.length} nya${info.added.length ? ' – ' + info.added.join(', ') : ''}.`);
    return true;
  } catch (err) {
    console.error(`Trendspaning misslyckades: ${err.message}`);
    return false;
  }
}

// Rapportkalender: universum + nästa rapportdatum → earnings_calendar.
// Ingen AI inblandad, bara datahämtning – därför körs den även i --dry (utan skrivning).
async function runEarnings(dry) {
  try {
    const { runEarningsCalendar } = require('./lib/earnings');
    const info = await runEarningsCalendar({ dry });
    console.log(`Rapportkalender: ${info.universe} bolag i universumet, ${info.written} rader skrivna` +
      `, ${info.missing} utan rapportdatum${dry ? ' [DRY]' : ''}.`);
    return true;
  } catch (err) {
    console.error(`Rapportkalendern misslyckades: ${err.message}`);
    return false;
  }
}

// AI-sammanvägning av riskbarometern (körs efter källorna).
async function runDailyRisk() {
  try {
    const { runRiskAnalysis } = require('./lib/risk');
    const info = await runRiskAnalysis();
    console.log(`Riskbarometer-analys sparad för ${info.date} (${info.model}, ${info.indicators} indikatorer).`);
    return true;
  } catch (err) {
    console.error(`Riskbarometer-analys misslyckades: ${err.message}`);
    return false;
  }
}

// CIO-analys (taktisk allokering) – körs efter megatrenderna och får den senaste analysens teman.
async function runDailyCio() {
  try {
    const { runCioAnalysis } = require('./lib/cio');
    const info = await runCioAnalysis();
    console.log(`CIO-analys sparad för ${info.date} (${info.model}, ${info.symbols} marknadsserier, ${info.headlines} rubriker).`);
    return true;
  } catch (err) {
    console.error(`CIO-analys misslyckades: ${err.message}`);
    return false;
  }
}

// Schemalagd omvärdering av AI-fonder (körs på servern enligt varje fonds intervall).
async function runDailyAIFunds() {
  try {
    const { runAIFunds } = require('./lib/aifunds');
    const info = await runAIFunds();
    console.log(`AI-fonder: ${info.total} totalt, ${info.due} dags att omvärdera, ${info.done} omvärderade, ${info.navLogged} NAV-punkter loggade${info.errs ? `, ${info.errs} fel` : ''}.`);
    return true;
  } catch (err) {
    console.error(`AI-fond-omvärdering misslyckades: ${err.message}`);
    return false;
  }
}

// AI-analys av megatrender (grundad i signalerna).
async function runWeeklyTrends() {
  try {
    console.log('Megatrend-analys:');
    const { runMegatrends } = require('./lib/megatrends');
    const info = await runMegatrends();
    console.log(`Megatrend-analys sparad för ${info.date}: ${info.themes.join(', ') || 'inga teman'}.`);
    return true;
  } catch (err) {
    console.error(`Megatrend-analys misslyckades: ${err.message}`);
    return false;
  }
}

// ── Schemat ──────────────────────────────────────────────────────────────────
let scheduleSaved = false; // finns engine_settings? Annars sparas inga körtider.

// Läser appens inställningar. Går det inte gäller standardintervallen – motorn ska hellre
// köra som vanligt än stå still för att schemat inte gick att läsa.
async function loadSchedule() {
  let rows = null;
  try {
    rows = await getEngineSettings();
    if (!rows) console.log('Schema: tabellen engine_settings saknas (kör supabase-engine-settings.sql) – standardintervallen gäller.');
  } catch (err) {
    console.error(`Schema: kunde inte läsas (${err.message}) – standardintervallen gäller.`);
  }
  scheduleSaved = !!rows;
  return engineSettingsMerge(rows);
}

// Är jobbet dags enligt schemat? Utan sparad körtid räknas senaste AI-anropet i
// ai_usage – så en missad körning (t.ex. slut på krediter) tas igen nästa dag.
async function isDue(settings, id, now) {
  const job = ENGINE_JOBS.find((j) => j.id === id);
  const s = settings[id];
  let fallback = null;
  if (!s.last_run_at && s.every_days > 1 && job.ctx) {
    try {
      fallback = await lastAiUsageAt(job.ctx);
    } catch (err) {
      console.error(`${job.label}: kunde inte läsa senaste körningen (${err.message}) – kör ändå.`);
    }
  }
  const st = engineJobDue(settings, id, now, fallback);
  if (st.paused) console.log(`${job.label}: pausad i appen – hoppas över.`);
  else if (!st.due) console.log(`${job.label}: körs var ${s.every_days}:e dag, senast ${st.last.slice(0, 10)} – nästa om ${st.daysLeft} d.`);
  return st.due;
}

async function markRun(id) {
  if (!scheduleSaved) return;
  try {
    await markEngineRun(id);
  } catch (err) {
    console.error(`Schema: kunde inte spara körningen av ${id}: ${err.message}`);
  }
}

// Ett enskilt jobb via flagga: körs oavsett paus/intervall, men noteras i schemat.
async function runOnly(id, label, run) {
  console.log(`Kör endast ${label}.`);
  await loadSchedule();
  if (await run()) await markRun(id);
}

// Tog krediterna slut under körningen: lämna en markering i ai_usage (appen visar då en
// varning överst och på AI-kostnader) och fäll jobbet, så att GitHub mejlar om körningen.
async function failIfCreditsOut() {
  if (!creditsExhausted()) return;
  console.error(`
✗ Anthropic-krediterna tog slut – resten av AI-stegen hoppades över. Fyll på: ${BILLING_URL}`);
  try {
    await recordAiUsage({ context: 'engine-credits-out', model: 'none', cost_usd: 0 });
  } catch (err) {
    console.error(`Kunde inte markera kreditstoppet i ai_usage: ${err.message}`);
  }
  process.exit(1);
}

// Nyhetstriagen: källorna → AI-triage (+ djupanalys) → signals.
async function runNews(args, sources, deepOn) {
  const deepInfo = deepOn ? `${DEEP_MODEL} vid impact≥${DEEP_THRESHOLD} (max ${DEEP_MAX})` : 'av';
  console.log(`Motorn startar. Triage: ${TRIAGE_MODEL}. Djupanalys: ${deepInfo}. Källor: ${sources.map((s) => s.id).join(', ')}${args.dry ? ' [DRY]' : ''}`);

  const allRows = [];
  let docCount = 0;
  let deepCount = 0;
  let errCount = 0;
  let writeFailed = false;

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
        if (deepOn && (analysis.impact_score || 0) >= DEEP_THRESHOLD && deepCount < DEEP_MAX) {
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
        // Logga tickers från raderna, inte från AI-svaret: modellen svarar ibland
        // med något annat än en array och då kastade .join() – efter att raden
        // redan lagts till, så dokumentet bokfördes både som ✓ och som fel.
        const tickers = rows.map((r) => r.ticker).filter(Boolean).join(',');
        console.log(
          `  ✓ ${doc.external_id} → ${analysis.sentiment} ` +
          `impact=${analysis.impact_score} tickers=[${tickers}]${deep}`
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
    // Skrivningen får inte sänka resten av körningen: de övriga jobben nedan
    // körs ändå, och jobbet fallerar först på sista raden i main().
    const { written, failed, firstError } = await upsertSignals(allRows);
    console.log(`\nSkrev ${written} rader till signals.`);
    if (failed) {
      writeFailed = true;
      console.error(`⚠ ${failed} rader kunde INTE skrivas: ${firstError}`);
    }
  } else {
    console.log('\nInga rader att skriva.');
  }

  console.log(`Klart. ${docCount} dokument analyserade (${deepCount} djupanalyserade), ${errCount} fel.`);
  return { docCount, errCount, writeFailed };
}

async function main() {
  const args = parseArgs(process.argv);

  // Bara en delanalys (billig test/omkörning).
  if (args.riskOnly) return runOnly('risk', 'riskbarometer-analysen', runDailyRisk);
  if (args.trendsOnly) return runOnly('megatrends', 'megatrend-analysen', runWeeklyTrends);
  if (args.discover) return runOnly('discovery', 'trendspaningen', runDiscovery);
  if (args.cioOnly) return runOnly('cio', 'CIO-analysen', runDailyCio);
  if (args.fundsOnly) return runOnly('aifunds', 'AI-fond-omvärderingen', runDailyAIFunds);
  if (args.earningsOnly) {
    // --dry: rör inte Supabase (inget schema att läsa eller skriva).
    if (args.dry) { console.log('Kör endast rapportkalendern.'); await runEarnings(true); return; }
    return runOnly('earnings', 'rapportkalendern', () => runEarnings(false));
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

  // --dry/--demo/--source är uttryckliga provkörningar av nyhetsflödet – de körs oavsett schema.
  const forcedNews = args.dry || args.demo || !!args.source;
  const settings = args.dry ? engineSettingsMerge([]) : await loadSchedule();
  if (!settings.all.enabled && !forcedNews) {
    console.log('Motorn är pausad i appen (AI-kostnader → Automatiska analyser) – inget körs i dag.');
    return;
  }
  const now = new Date();

  let news = { docCount: 0, errCount: 0, writeFailed: false };
  if (forcedNews || await isDue(settings, 'news', now)) {
    const deepOn = DEEP_ENABLED && settings.deep.enabled;
    if (DEEP_ENABLED && !deepOn) console.log('Djupanalys: pausad i appen.');
    news = await runNews(args, sources, deepOn);
    const ok = !args.dry && !creditsExhausted() && !(news.errCount && !news.docCount) && !news.writeFailed;
    if (ok) {
      await markRun('news');
      if (deepOn) await markRun('deep');
    }
  }

  // Övriga jobb (skippas i --dry). Megatrenderna före CIO-analysen, som läser dem.
  if (!args.dry) {
    const jobs = [
      ['earnings', () => runEarnings(false)],
      ['risk', runDailyRisk],
      ['megatrends', runWeeklyTrends],
      ['cio', runDailyCio],
      ['aifunds', runDailyAIFunds],
      ['discovery', runDiscovery],
    ];
    for (const [id, run] of jobs) {
      if (await isDue(settings, id, now) && await run()) await markRun(id);
    }
  }

  await failIfCreditsOut();
  if (news.errCount && !news.docCount) process.exit(1); // allt föll → låt jobbet fallera
  if (news.writeFailed) process.exit(1); // analyserna hann köras, men skrivningen sprack
}

main().then(failIfCreditsOut).catch((err) => { // .then: delanalyserna (--cio-only m.fl.) returnerar tidigt
  console.error('Motorn kraschade:', err);
  process.exit(1);
});
