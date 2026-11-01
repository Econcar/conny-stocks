// Motorns schema – vilka automatiska jobb som körs och hur ofta. Delas av appen och motorn:
//   appen:  <script src="shared/engine-schedule.js">   (AI-kostnader → Automatiska analyser)
//   motorn: require('../shared/engine-schedule')       (engine/run.js)
// Inställningarna sparas i engine_settings (se supabase-engine-settings.sql); utan tabellen
// gäller standardvärdena nedan. GitHub Actions startar motorn en gång per dygn (06:00 UTC),
// så tätaste intervallet är varje dag. Ren JS utan beroenden.

const ENGINE_CRON_UTC_HOUR = 6;

// every: standardintervall i dagar (null = har inget eget intervall). ctx: kontexten i
// ai_usage – senaste raden där räknas som senaste körning tills motorn sparat en egen.
const ENGINE_JOBS = [
  { id: 'news',       label: 'Nyhetstriage',      every: 1, ctx: 'engine-triage',     desc: 'Hämtar nyheter och rapporter och låter AI:n sålla dem till signaler.' },
  { id: 'deep',       label: 'Djupanalys',        every: null,                         desc: 'Starkare modell på de viktigaste nyheterna. Följer nyhetstriagen.' },
  { id: 'earnings',   label: 'Rapportkalender',   every: 1,                            desc: 'Nästa rapportdatum för bolagen. Ingen AI-kostnad.' },
  { id: 'risk',       label: 'Riskbarometer',     every: 1, ctx: 'engine-risk',       desc: 'AI:ns sammanvägning av riskindikatorerna.' },
  { id: 'megatrends', label: 'Megatrender',       every: 7, ctx: 'engine-megatrends', desc: 'AI-analys av megatrenderna, grundad i signalerna.' },
  { id: 'cio',        label: 'CIO-analys',        every: 1, ctx: 'engine-cio',        desc: 'Taktisk tillgångsallokering.' },
  { id: 'aifunds',    label: 'AI-fonder',         every: null,                         desc: 'Omvärderar fonderna enligt varje fonds eget intervall.' },
  { id: 'discovery',  label: 'Trendspaning',      every: 7, ctx: 'engine-discovery',  desc: 'AI:n föreslår nya teman att bevaka.' },
];
const ENGINE_EVERY_OPTIONS = [1, 2, 3, 7, 14, 30];

// Rader ur engine_settings → { all, news, … } med standardvärden där rad eller fält saknas.
function engineSettingsMerge(rows) {
  const byId = {};
  for (const r of rows || []) if (r && r.id) byId[r.id] = r;
  const pick = (id, every) => {
    const r = byId[id] || {};
    const n = Number(r.every_days);
    return {
      id,
      enabled: r.enabled !== false,
      every_days: every == null ? null : (Number.isInteger(n) && n >= 1 ? n : every),
      last_run_at: r.last_run_at || null,
    };
  };
  const out = { all: pick('all', null) };
  for (const j of ENGINE_JOBS) out[j.id] = pick(j.id, j.every);
  return out;
}

// Hela dygn (UTC-datum) mellan två tidpunkter – en körning 06:05 och nästa 06:00 dagen
// efter räknas som 1 dag, så ett dagligt jobb inte hoppas över av att Actions startar sent.
function engineDayDiff(fromIso, now) {
  const day = d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(now) - day(new Date(fromIso))) / 86400000);
}

// Är jobbet dags att köra vid motorns körning `now`? fallbackLast = senaste körning enligt
// ai_usage när motorn inte sparat någon egen ännu. → { due, paused, daysLeft, last }
function engineJobDue(settings, id, now, fallbackLast) {
  const s = settings[id];
  const last = s.last_run_at || fallbackLast || null;
  if (!settings.all.enabled || !s.enabled) return { due: false, paused: true, daysLeft: null, last };
  if (id === 'deep' && !settings.news.enabled) return { due: false, paused: true, daysLeft: null, last };
  if (s.every_days == null || !last) return { due: true, paused: false, daysLeft: 0, last };
  const age = engineDayDiff(last, now);
  return { due: age >= s.every_days, paused: false, daysLeft: Math.max(0, s.every_days - age), last };
}

// När startar motorn nästa gång som jobbet körs? (för visning i appen) → Date eller null om pausat.
function engineNextRun(settings, id, now, fallbackLast) {
  const st = engineJobDue(settings, id, now, fallbackLast);
  if (st.paused) return null;
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ENGINE_CRON_UTC_HOUR));
  if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
  while (!engineJobDue(settings, id, at, fallbackLast).due) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ENGINE_JOBS, ENGINE_EVERY_OPTIONS, ENGINE_CRON_UTC_HOUR, engineSettingsMerge, engineDayDiff, engineJobDue, engineNextRun };
}
