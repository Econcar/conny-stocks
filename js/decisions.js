// conny-stocks · AI:ns beslutslogg och vyn "AI:ns träffsäkerhet".
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ AI:NS BESLUTSLOGG ══════════
// AI-triagen, portföljgenomlysningen och djupanalysen loggar sina rekommendationer här
// (recordDecisions) med kurs och jämförelseindex vid beslutet. Uppföljningen räknas fram
// när vyn öppnas, ur Yahoos kurshistorik – inget serverjobb behövs. Sparas lokalt och,
// inloggad, i Supabase-tabellen ai_decisions (supabase-ai-decisions.sql).
const DECISION_SOURCES = { triage: 'AI-triage', portfolio_review: 'Portföljgenomlysning', deep_analysis: 'Djupanalys' };
// Åtgärd → riktning: +1 = AI:n tror på aktien, -1 = tror inte, 0 = neutral (räknas inte som träff/miss).
const DECISION_DIRECTION = { 'KÖP': 1, 'ÖKA': 1, 'KANDIDAT': 1, 'BEHÅLL': 0, 'AVVAKTA': 0, 'MINSKA': -1, 'SÄLJ': -1 };
const TRACK_HORIZONS = [['1m', 30, '1 mån'], ['3m', 91, '3 mån'], ['6m', 182, '6 mån']];

let aiDecisionsLocal = (() => { try { return JSON.parse(localStorage.getItem('ai_decisions') || '[]'); } catch(e) { return []; } })();
let aiDecisionsAll = null;       // senaste sammanslagna listan (moln + lokalt) från loadDecisions
let decisionsCloudMissing = false; // tabellen ai_decisions finns inte (än) – loggen är då bara lokal
let trackFilter = 'alla';
let trackRows = [];              // senast visade rader { d, o } – för exporten
function saveDecisionsLocal() { try { localStorage.setItem('ai_decisions', JSON.stringify(aiDecisionsLocal.slice(0, 2000))); } catch(e) {} }

// ── Perioder: "Starta ny period" avslutar nuvarande omgång – sparas i Supabase-tabellen
// ai_track_periods (supabase-ai-track-periods.sql) med sammanfattning och ögonblicksbild av
// alla beslut och utfall, plus som CSV-fil. Besluten ligger kvar i ai_decisions och följs
// fortfarande upp; vyn visar som standard bara beslut sedan senaste periodens slut.
let trackPeriod = 'current';     // 'current' eller id för en avslutad period
let trackPeriodsAll = [];        // avslutade perioder, äldst först (från loadTrackPeriods)
let trackPeriodRows = [];        // alla källor i vald period – det som sparas när perioden avslutas
let trackPeriodsCloudMissing = false;
let trackPeriodsLocal = (() => { try { return JSON.parse(localStorage.getItem('ai_track_periods') || '[]'); } catch(e) { return []; } })();
function saveTrackPeriodsLocal() {
  try { localStorage.setItem('ai_track_periods', JSON.stringify(trackPeriodsLocal)); }
  catch(e) { // för stort – spara utan ögonblicksbilderna (CSV-filen och ev. molnet har dem)
    try { localStorage.setItem('ai_track_periods', JSON.stringify(trackPeriodsLocal.map(({ rows, ...p }) => p))); } catch(_) {}
  }
}

// Molnet (inloggad) + lokala perioder som ännu inte laddats upp – de laddas upp nu.
async function loadTrackPeriods() {
  let list = trackPeriodsLocal.filter(p => !p.synced);
  if(sb && currentUser) {
    try {
      const { data, error } = await sb.from('ai_track_periods').select('id,created_at,started_at,ended_at,label,summary').order('ended_at', { ascending: true });
      if(error) trackPeriodsCloudMissing = /ai_track_periods/.test(error.message);
      else {
        trackPeriodsCloudMissing = false;
        const ids = new Set(data.map(p => p.id));
        for(const p of trackPeriodsLocal.filter(p => !p.synced && !ids.has(p.id))) {
          const { synced, ...row } = p;
          const { error: e2 } = await sb.from('ai_track_periods').insert({ ...row, user_id: currentUser.id });
          if(!e2) { delete p.rows; p.synced = true; ids.add(p.id); data.push(row); }
        }
        saveTrackPeriodsLocal();
        list = [...data, ...trackPeriodsLocal.filter(p => !p.synced && !ids.has(p.id))];
      }
    } catch(e) {}
  }
  return (trackPeriodsAll = list.sort((a, b) => String(a.ended_at).localeCompare(String(b.ended_at))));
}

function trackStats(rs) {
  const directed = rs.filter(r => r.d.direction && r.o.sinceExcess != null);
  const h = {};
  for(const [k] of TRACK_HORIZONS) {
    const done = rs.filter(r => r.o.h[k] && r.o.h[k].hit != null);
    h[k] = { done: done.length, hits: done.filter(r => r.o.h[k].hit).length };
  }
  return { n: rs.length, alpha: directed.length ? directed.reduce((s, r) => s + r.d.direction * r.o.sinceExcess, 0) / directed.length : null, h };
}
const trackSnapshotRow = ({ d, o }) => ({ id: d.id, date: d.created_at, source: d.source, ticker: d.ticker, name: d.name, action: d.action,
  price: d.price, benchmark: d.benchmark, since_stock: o.sinceStock, since_bench: o.sinceBench, since_excess: o.sinceExcess,
  h: Object.fromEntries(TRACK_HORIZONS.map(([k]) => { const h = o.h[k] || {};
    return [k, h.pending != null ? { due: new Date(h.due).toISOString() } : { excess: h.excess == null ? null : h.excess, hit: h.hit == null ? null : h.hit }]; })),
  note: d.note || null });

const periodSummary = rows => {
  const by_source = {};
  for(const k of Object.keys(DECISION_SOURCES)) { const rs = rows.filter(r => r.d.source === k); if(rs.length) by_source[k] = trackStats(rs); }
  return { all: trackStats(rows), by_source };
};

// Periodens tidsfönster [från, till): avslutad period = started_at–ended_at, nuvarande = sedan senaste periodens slut.
function periodWindow(periods, p) {
  if(p) return [p.started_at ? Date.parse(p.started_at) : -Infinity, Date.parse(p.ended_at)];
  return [periods.length ? Date.parse(periods[periods.length - 1].ended_at) : -Infinity, Infinity];
}
const inWindow = ([from, to], d) => { const t = Date.parse(d.created_at); return t >= from && t < to; };

// Utfall för en lista beslut (hämtar kurshistorik för aktier och index).
async function trackOutcomes(list) {
  if(!list.length) return [];
  const since = Math.min(...list.map(d => Date.parse(d.created_at)));
  const hist = await trackHistories([...new Set([...list.map(d => d.ticker), ...list.map(d => d.benchmark)])], since);
  return list.map(d => ({ d, o: decisionOutcome(d, hist) }));
}

function setTrackPeriod(p) { trackPeriod = p; renderTrack(); }

// Avslutar nuvarande period: sparas i databasen (inloggad, annars lokalt tills molnet nås) och som CSV.
async function closeCurrentPeriod(periods, rows) {
  const n = periods.length + 1, prev = periods[periods.length - 1];
  const p = { id: crypto.randomUUID(), created_at: new Date().toISOString(),
    started_at: prev ? prev.ended_at : new Date(Math.min(...rows.map(r => Date.parse(r.d.created_at)))).toISOString(),
    ended_at: new Date().toISOString(), label: 'Period ' + n,
    summary: periodSummary(rows), rows: rows.map(trackSnapshotRow) };
  downloadCsv(trackCsv(rows), `ai-traffsakerhet-period-${n}-${new Date().toLocaleDateString('sv-SE')}.csv`);
  let cloudOk = false;
  if(sb && currentUser) {
    try {
      const { error } = await sb.from('ai_track_periods').insert({ ...p, user_id: currentUser.id });
      cloudOk = !error;
      if(error && /ai_track_periods/.test(error.message)) trackPeriodsCloudMissing = true;
    } catch(e) {}
  }
  if(cloudOk) { const { rows: _, ...meta } = p; trackPeriodsLocal.push({ ...meta, synced: true }); }
  else trackPeriodsLocal.push(p); // laddas upp av loadTrackPeriods när molnet går att nå
  saveTrackPeriodsLocal();
  trackPeriodsAll = [...periods, p];
  trackPeriod = 'current';
  return p;
}

async function startNewPeriod() {
  const rows = trackPeriodRows;
  if(trackPeriod !== 'current' || !rows.length) return;
  const n = trackPeriodsAll.length + 1;
  if(!confirm(`Avsluta period ${n} (${rows.length} beslut) och starta en ny?\n\nPerioden sparas i databasen och laddas ner som Excel/CSV-fil. Besluten finns kvar och följs fortfarande upp under period ${n} i periodväljaren – nya rekommendationer räknas i den nya perioden.`)) return;
  await closeCurrentPeriod(trackPeriodsAll, rows);
  trackFilter = 'alla';
  await renderTrack();
}

// Inför en ny genomlysning (t.ex. månadens ombalansering): har nuvarande period pågått
// ett tag, fråga om den ska avslutas först – annars hamnar de nya råden i den gamla perioden.
const TRACK_PERIOD_PROMPT_DAYS = 25;
async function maybeStartNewPeriod() {
  try {
    const [all, periods] = await Promise.all([loadDecisions(), loadTrackPeriods()]);
    const cur = all.filter(d => inWindow(periodWindow(periods, null), d));
    if(!cur.length) return false;
    const start = periods.length ? Date.parse(periods[periods.length - 1].ended_at) : Math.min(...cur.map(d => Date.parse(d.created_at)));
    const days = Math.floor((Date.now() - start) / 86400000);
    if(days < TRACK_PERIOD_PROMPT_DAYS) return false;
    const n = periods.length + 1;
    if(!confirm(`Period ${n} i AI:ns träffsäkerhet startade för ${days} dagar sedan (${cur.length} beslut).\n\nAvsluta den och starta en ny period innan genomlysningen? Då räknas de nya rekommendationerna i den nya perioden. Perioden sparas i databasen och laddas ner som Excel/CSV.\n\nOK = ny period först  ·  Avbryt = kör utan att byta period`)) return false;
    await closeCurrentPeriod(periods, await trackOutcomes(cur));
    return true;
  } catch(e) { return false; }
}

// Ögonblicksbilden tas när perioden avslutas – ofta innan 1 mån-utfallet är klart. När fler
// horisonter har nåtts uppdateras den sparade sammanfattningen (och ögonblicksbilden) i efterhand.
async function refreshPeriodSnapshots(periods, allRows) {
  for(const p of periods) {
    const old = p.summary && p.summary.all;
    if(!old) continue;
    const rows = allRows.filter(r => inWindow(periodWindow(periods, p), r.d));
    if(rows.length < old.n) continue; // beslut har tagits bort sedan avslutet – rör inte ögonblicksbilden
    const summary = periodSummary(rows);
    if(!TRACK_HORIZONS.some(([k]) => summary.all.h[k].done > ((old.h && old.h[k] && old.h[k].done) || 0))) continue;
    summary.refreshed_at = new Date().toISOString();
    p.summary = summary;
    const snap = rows.map(trackSnapshotRow);
    const loc = trackPeriodsLocal.find(x => x.id === p.id);
    if(loc) { loc.summary = summary; if(loc.rows) loc.rows = snap; saveTrackPeriodsLocal(); }
    if(sb && currentUser && !trackPeriodsCloudMissing && !(loc && !loc.synced)) {
      try { await sb.from('ai_track_periods').update({ summary, rows: snap }).eq('id', p.id); } catch(e) {}
    }
  }
}

// Lokalt jämförelseindex utifrån tickerns börssuffix.
function decisionBenchmark(ticker) {
  const suf = ((String(ticker).match(/\.[A-Z]+$/i) || [''])[0]).toUpperCase();
  return { '.ST': '^OMX', '.CO': '^OMXC25', '.HE': '^OMXH25', '.OL': 'OBX.OL', '.TO': '^GSPTSE', '.V': '^GSPTSE' }[suf]
    || (suf ? '^STOXX50E' : '^GSPC');
}
const BENCH_LABELS = { '^OMX': 'OMXS30', '^OMXC25': 'OMXC25', '^OMXH25': 'OMXH25', 'OBX.OL': 'OBX', '^GSPTSE': 'TSX', '^STOXX50E': 'Euro Stoxx 50', '^GSPC': 'S&P 500' };

function normAction(a) {
  const s = String(a || '').toUpperCase();
  if(/SÄLJ|SELL/.test(s)) return 'SÄLJ';
  if(/MINSKA|REDUCE|TRIM/.test(s)) return 'MINSKA';
  if(/ÖKA|INCREASE/.test(s)) return 'ÖKA';
  if(/KÖP|BUY/.test(s)) return 'KÖP';
  if(/AVVAKTA|WAIT/.test(s)) return 'AVVAKTA';
  if(/BEHÅLL|HOLD|KEEP/.test(s)) return 'BEHÅLL';
  if(/KANDIDAT/.test(s)) return 'KANDIDAT';
  return null;
}

// JSON i ett maskinläsbart block, t.ex. <decisions>[…]</decisions>. null om saknas/trasigt.
function parseTagJson(text, tag) {
  const m = (text || '').match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`));
  if(!m) return null;
  try { return JSON.parse(m[1].replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); } catch(e) { return null; }
}

// items: [{ ticker, name?, action, price?, currency?, note? }]. Kurser som saknas – och
// jämförelseindexens nivå – hämtas nu. Beslut utan kurs (t.ex. påhittad ticker) sparas inte.
// Samma källa + ticker + åtgärd inom ett dygn räknas som samma beslut (t.ex. en triage
// som körs om) – annars väger det dubbelt i träffprocenten.
const DECISION_DUP_MS = 24 * 3600 * 1000;
const decisionKey = d => `${d.source}|${String(d.ticker).toUpperCase()}|${d.action}`;

async function recordDecisions(source, title, items) {
  const recent = new Set(aiDecisionsLocal.filter(d => Date.now() - new Date(d.created_at).getTime() < DECISION_DUP_MS).map(decisionKey));
  items = (items || []).map(it => ({ ...it, ticker: String(it.ticker || '').trim(), action: normAction(it.action) }))
    .filter(it => it.ticker && it.action && !recent.has(decisionKey({ source, ...it })));
  if(!items.length) return 0;
  const need = [...new Set([...items.filter(i => i.price == null).map(i => i.ticker), ...items.map(i => decisionBenchmark(i.ticker))])];
  let q = {};
  try { q = await fetchQuotesChunked(need); } catch(e) {}
  const now = new Date().toISOString();
  const rows = items.map(it => {
    const bench = decisionBenchmark(it.ticker), live = q[it.ticker] || {};
    const price = it.price != null ? +it.price : live.price;
    return { id: crypto.randomUUID(), created_at: now, source, title: title || null, ticker: it.ticker, name: it.name || null,
      action: it.action, direction: DECISION_DIRECTION[it.action], price: price != null && isFinite(price) ? price : null,
      currency: it.currency || live.currency || null, benchmark: bench, bench_price: q[bench] ? q[bench].price : null,
      note: it.note ? String(it.note).slice(0, 500) : null };
  }).filter(r => r.price != null);
  if(!rows.length) return 0;
  aiDecisionsLocal = [...rows, ...aiDecisionsLocal];
  saveDecisionsLocal();
  if(aiDecisionsAll) aiDecisionsAll = [...rows, ...aiDecisionsAll];
  // Försöker alltid (en tidigare miss får inte stänga av molnet för resten av sessionen).
  // Misslyckas det ligger beslutet kvar lokalt och laddas upp av loadDecisions() senare.
  if(sb && currentUser) {
    try {
      const { error } = await sb.from('ai_decisions').insert(rows.map(r => ({ ...r, user_id: currentUser.id })));
      decisionsCloudMissing = !!(error && /ai_decisions/.test(error.message));
    } catch(e) {}
  }
  return rows.length;
}

// Dubbletter (samma källa/ticker/åtgärd inom ett dygn): behåll den första, ta bort resten.
function splitDuplicateDecisions(list) {
  const keep = [], drop = [], lastByKey = {};
  for(const d of [...list].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const k = decisionKey(d), t = new Date(d.created_at).getTime();
    if(lastByKey[k] != null && t - lastByKey[k] < DECISION_DUP_MS) { drop.push(d); continue; }
    lastByKey[k] = t; keep.push(d);
  }
  return { keep: keep.reverse(), drop };
}

// Molnet (inloggad) + lokala beslut som ännu inte laddats upp – de laddas upp nu.
async function loadDecisions() {
  const local = splitDuplicateDecisions(aiDecisionsLocal);
  if(local.drop.length) { aiDecisionsLocal = local.keep; saveDecisionsLocal(); }
  if(!(sb && currentUser)) return (aiDecisionsAll = aiDecisionsLocal);
  try {
    const { data, error } = await sb.from('ai_decisions').select('*').order('created_at', { ascending: false }).limit(2000);
    if(error) { if(/ai_decisions/.test(error.message)) decisionsCloudMissing = true; return aiDecisionsLocal; }
    decisionsCloudMissing = false;
    const ids = new Set(data.map(d => d.id));
    const localOnly = aiDecisionsLocal.filter(d => !ids.has(d.id));
    if(localOnly.length) await sb.from('ai_decisions').insert(localOnly.map(r => ({ ...r, user_id: currentUser.id })));
    const { keep, drop } = splitDuplicateDecisions([...data, ...localOnly]);
    if(drop.length) {
      const dropIds = new Set(drop.map(d => d.id));
      aiDecisionsLocal = aiDecisionsLocal.filter(d => !dropIds.has(d.id)); saveDecisionsLocal();
      await sb.from('ai_decisions').delete().in('id', [...dropIds]);
    }
    return (aiDecisionsAll = keep);
  } catch(e) { return aiDecisionsLocal; }
}

// ── Djupanalysens senaste utlåtande per aktie (visas på triagekort och i screenern) ──
function latestDeepVerdict(ticker) {
  const t = String(ticker || '').toUpperCase();
  return (aiDecisionsAll || aiDecisionsLocal).find(d => d.source === 'deep_analysis' && String(d.ticker).toUpperCase() === t) || null;
}
function verdictBadge(ticker) {
  const v = latestDeepVerdict(ticker);
  if(!v) return '';
  const col = v.direction > 0 ? 'var(--green)' : v.direction < 0 ? 'var(--red)' : 'var(--amber)';
  const date = new Date(v.created_at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  return `<span class="verdict" style="color:${col};border-color:${col}" title="Institutionell djupanalys ${escHtml(date)} – klicka för att läsa" onclick="event.stopPropagation();openSavedAnalysis('${escQuote(v.title || '')}')">${escHtml(v.action)} · ${escHtml(date)}</span>`;
}

// Öppnar en sparad analys (efter titel) i Sparade analyser, utfälld.
async function openSavedAnalysis(title) {
  showSection('analyses');
  await renderAnalyses();
  const card = [...document.querySelectorAll('#analyses-list .pf-card')]
    .find(c => { const t = c.querySelector('[style*="font-weight:600"]'); return t && t.textContent.trim() === title; });
  if(!card) return;
  const body = card.querySelector('[id^="an-"]');
  if(body) body.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteDecision(id) {
  if(!confirm('Ta bort beslutet ur loggen?')) return;
  aiDecisionsLocal = aiDecisionsLocal.filter(d => d.id !== id);
  saveDecisionsLocal();
  if(sb && currentUser) { try { await sb.from('ai_decisions').delete().eq('id', id); } catch(e) {} }
  renderTrack();
}

// Första stängningen på/efter ett datum, och senaste stängningen.
function closeOnOrAfter(s, ms) {
  if(!s) return null;
  for(let i = 0; i < s.ts.length; i++) if(s.ts[i] * 1000 >= ms && s.closes[i] != null) return s.closes[i];
  return null;
}
function lastClose(s) {
  if(!s) return null;
  for(let i = s.closes.length - 1; i >= 0; i--) if(s.closes[i] != null) return s.closes[i];
  return null;
}

// Utfall per beslut: utveckling sedan beslutet, mot index, och vid 1/3/6 mån (när de nåtts).
// "Mot index" = aktiens utveckling minus indexets. Träff = rätt riktning mot index.
function decisionOutcome(d, hist) {
  const s = hist[d.ticker], b = hist[d.benchmark];
  const t0 = new Date(d.created_at).getTime();
  const p0 = d.price, b0 = d.bench_price != null ? d.bench_price : closeOnOrAfter(b, t0);
  const ret = (p, p0x) => (p != null && p0x) ? p / p0x - 1 : null;
  const sinceStock = ret(lastClose(s), p0), sinceBench = ret(lastClose(b), b0);
  const out = { sinceStock, sinceBench, sinceExcess: (sinceStock != null && sinceBench != null) ? sinceStock - sinceBench : null, h: {} };
  for(const [k, days] of TRACK_HORIZONS) {
    const due = t0 + days * 86400000;
    if(Date.now() < due) { out.h[k] = { pending: Math.ceil((due - Date.now()) / 86400000), due }; continue; }
    const rs = ret(closeOnOrAfter(s, due), p0), rb = ret(closeOnOrAfter(b, due), b0);
    const excess = (rs != null && rb != null) ? rs - rb : null;
    out.h[k] = { excess, hit: (excess != null && d.direction) ? d.direction * excess > 0 : null };
  }
  return out;
}

async function trackHistories(symbols, sinceMs) {
  const days = (Date.now() - sinceMs) / 86400000;
  const range = days <= 25 ? '1mo' : days <= 80 ? '3mo' : days <= 175 ? '6mo' : days <= 360 ? '1y' : days <= 720 ? '2y' : '5y';
  const out = {};
  for(let i = 0; i < symbols.length; i += 6) {
    await Promise.all(symbols.slice(i, i + 6).map(async sym => { out[sym] = await fetchChartSeries(sym, range, '1d'); }));
  }
  return out;
}

function setTrackFilter(f) { trackFilter = f; renderTrack(); }

// Exportera vyn som CSV för Excel (semikolon, decimalkomma, BOM så att å/ä/ö blir rätt).
function trackCsv(rows) {
  const num = (v, dec) => v == null || !isFinite(v) ? '' : v.toFixed(dec).replace('.', ',');
  const pctNum = v => num(v == null ? null : v * 100, 2);
  const q = v => { const t = String(v == null ? '' : v); return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ['Datum', 'Källa', 'Bolag', 'Ticker', 'Åtgärd', 'Kurs då', 'Sedan dess %', 'Index', 'Index %', 'Mot index %',
    ...TRACK_HORIZONS.flatMap(([, , l]) => [l + ' mot index %', l + ' träff']), 'AI:ns motivering'];
  const lines = rows.map(({ d, o }) => [
    new Date(d.created_at).toLocaleDateString('sv-SE'), DECISION_SOURCES[d.source] || d.source, d.name || d.ticker, d.ticker, d.action,
    num(d.price, 2), pctNum(o.sinceStock), BENCH_LABELS[d.benchmark] || d.benchmark, pctNum(o.sinceBench), pctNum(o.sinceExcess),
    ...TRACK_HORIZONS.flatMap(([k]) => { const h = o.h[k] || {};
      return h.pending != null ? ['väntar ' + new Date(h.due).toLocaleDateString('sv-SE'), ''] : [pctNum(h.excess), h.hit == null ? '' : h.hit ? 'ja' : 'nej']; }),
    String(d.note || '').replace(/\s+/g, ' ').trim()
  ].map(q).join(';'));
  return '\uFEFF' + [head.map(q).join(';'), ...lines].join('\r\n');
}
function downloadCsv(text, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportTrack() {
  if(!trackRows.length) return;
  const sel = trackPeriodsAll.find(p => p.id === trackPeriod);
  const label = sel ? '-' + String(sel.label || 'period').toLowerCase().replace(/\s+/g, '-') : '';
  downloadCsv(trackCsv(trackRows), `ai-traffsakerhet${label}${trackFilter === 'alla' ? '' : '-' + trackFilter}-${new Date().toLocaleDateString('sv-SE')}.csv`);
}

async function renderTrack() {
  const body = document.getElementById('track-body'), filters = document.getElementById('track-filters');
  if(!body) return;
  const chips = [['alla', 'Alla'], ...Object.entries(DECISION_SOURCES)]
    .map(([k, l]) => `<div class="filter-chip${trackFilter === k ? ' on' : ''}" onclick="setTrackFilter('${k}')">${l}</div>`).join('');
  filters.innerHTML = chips;
  trackRows = []; trackPeriodRows = [];
  body.innerHTML = '<div class="info-msg">Hämtar beslut och kurshistorik…</div>';
  const [all, periods] = await Promise.all([loadDecisions(), loadTrackPeriods()]);
  const sel = periods.find(p => p.id === trackPeriod) || null;
  if(!sel) trackPeriod = 'current';
  const dShort = t => new Date(t).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
  const curStart = periodWindow(periods, null)[0];
  const win = periodWindow(periods, sel);
  const bySrc = rs => trackFilter === 'alla' ? rs : rs.filter(r => (r.d || r).source === trackFilter);
  const list = bySrc(all.filter(d => inWindow(win, d)));

  const periodSel = periods.length
    ? `<select class="filter-input" id="track-period" onchange="setTrackPeriod(this.value)" title="Välj period – avslutade perioder följs fortfarande upp">
        <option value="current"${sel ? '' : ' selected'}>Nuvarande period · sedan ${dShort(curStart)}</option>
        ${[...periods].reverse().map(p => `<option value="${escHtml(p.id)}"${sel && sel.id === p.id ? ' selected' : ''}>${escHtml(p.label || 'Period')} · ${p.started_at ? dShort(p.started_at) : 'start'} – ${dShort(p.ended_at)}</option>`).join('')}
      </select>` : '';
  filters.innerHTML = chips + `<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">${periodSel}
      <button class="ghost-btn" id="track-export" onclick="exportTrack()" disabled title="Ladda ner tabellen (med valt filter) som CSV – öppnas i Excel">⬇ Spara som Excel/CSV</button>
      ${sel ? '' : `<button class="ghost-btn" id="track-new-period" onclick="startNewPeriod()" disabled title="Avsluta perioden – sparas i databasen och som CSV – och börja om med nya rekommendationer">↻ Starta ny period</button>`}
    </div>`;

  const warn = html => `<div class="info-msg" style="background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.25);margin-bottom:14px">${html}</div>`;
  const cloudNote = (decisionsCloudMissing
      ? warn('Tabellen <b>ai_decisions</b> saknas i Supabase – loggen sparas bara i den här webbläsaren. Kör <b>supabase-ai-decisions.sql</b> i Supabase → SQL Editor.') : '')
    + (trackPeriodsCloudMissing
      ? warn('Tabellen <b>ai_track_periods</b> saknas i Supabase – avslutade perioder sparas bara i den här webbläsaren (och som CSV). Kör <b>supabase-ai-track-periods.sql</b> i Supabase → SQL Editor, så laddas de upp automatiskt.')
      : periods.length && !(sb && currentUser) ? warn('Du är inte inloggad – avslutade perioder sparas bara i den här webbläsaren (och som CSV). Logga in så sparas de i databasen.') : '');

  // Utfall för alla beslut (alla perioder behövs till jämförelsetabellen och ögonblicksbilderna).
  const allRows = await trackOutcomes(periods.length ? all : all.filter(d => inWindow(win, d)));
  await refreshPeriodSnapshots(periods, allRows);
  trackPeriodRows = allRows.filter(r => inWindow(win, r.d));
  const rows = bySrc(trackPeriodRows);
  trackRows = rows;
  if(rows.length) document.getElementById('track-export').disabled = false;
  const np = document.getElementById('track-new-period'); if(np && trackPeriodRows.length) np.disabled = false;

  // Vald avslutad period: när den sparades och hur det såg ut då (siffrorna nedan räknas om med dagens kurser).
  const r3 = v => v == null ? null : (Math.round(v * 1000) / 1000 || 0); // −0,04 % → 0 (neutral)
  const pct = v => { v = r3(v); return v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(1).replace('.', ',') + ' %'; };
  const snap = sel && sel.summary && sel.summary.all;
  const snapWhen = sel && sel.summary && sel.summary.refreshed_at
    ? `Sparad sammanfattning (uppdaterad ${new Date(sel.summary.refreshed_at).toLocaleDateString('sv-SE')} när fler horisonter nåtts)` : 'Vid avslutet';
  const periodNote = sel
    ? `<div class="info-msg" id="track-period-note" style="margin-bottom:14px">📁 <b>${escHtml(sel.label || 'Period')}</b> · ${sel.started_at ? dShort(sel.started_at) : 'start'} – ${dShort(sel.ended_at)}, avslutad och sparad ${new Date(sel.ended_at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}.
        ${snap ? `${snapWhen}: ${snap.n} beslut · AI-alfa ${pct(snap.alpha)} · ${TRACK_HORIZONS.map(([k, , l]) => { const h = snap.h[k]; return h && h.done ? `${l} ${Math.round(h.hits / h.done * 100)} % (${h.hits}/${h.done})` : `${l} väntade`; }).join(' · ')}.` : ''}
        Besluten följs fortfarande upp – tabellen nedan visar läget i dag.</div>`
    : periods.length ? `<div class="info-msg" style="margin-bottom:14px;color:var(--text2)">Nuvarande period sedan ${dShort(curStart)}. Tidigare perioder hittar du i periodväljaren och i jämförelsen nedan.</div>` : '';

  // Perioderna jämförda (med valt källfilter) – klicka på en rad för att öppna perioden.
  const hitTxt = h => h.done ? `<b style="color:${h.hits / h.done >= 0.5 ? 'var(--green)' : 'var(--red)'}">${Math.round(h.hits / h.done * 100)} %</b> <span class="muted">(${h.hits}/${h.done})</span>` : '<span class="muted">väntar</span>';
  const periodCmp = periods.length ? `<div class="card" id="track-periods" style="padding:0;margin-bottom:14px">
      <div class="card-title" style="padding:12px 14px 0">Perioder jämförda${trackFilter === 'alla' ? '' : ' · ' + escHtml(DECISION_SOURCES[trackFilter])}</div>
      <div class="table-wrap"><table class="pf-table">
        <thead><tr><th style="text-align:left">Period</th><th style="text-align:left">Tid</th><th style="text-align:right">Beslut</th><th style="text-align:right" title="Snittlig överavkastning mot index sedan beslutet, i AI:ns riktning">AI-alfa</th>
          ${TRACK_HORIZONS.map(([, , l]) => `<th style="text-align:right">${l}</th>`).join('')}</tr></thead>
        <tbody>${[...periods, null].map(p => {
          const [from, to] = periodWindow(periods, p), st = trackStats(bySrc(allRows.filter(r => inWindow([from, to], r.d))));
          const id = p ? p.id : 'current', on = (sel ? sel.id : 'current') === id;
          return `<tr onclick="setTrackPeriod('${escQuote(id)}')" style="cursor:pointer${on ? ';background:var(--surface2)' : ''}">
            <td style="font-weight:${on ? 600 : 400}">${p ? escHtml(p.label || 'Period') : 'Nuvarande'}</td>
            <td style="font-size:12px;color:var(--text2);white-space:nowrap">${p ? `${dShort(from)} – ${dShort(to)}` : `sedan ${dShort(from)}`}</td>
            <td style="text-align:right">${st.n}</td>
            <td style="text-align:right;color:${st.alpha == null ? 'var(--text3)' : st.alpha >= 0 ? 'var(--green)' : 'var(--red)'}">${pct(st.alpha)}</td>
            ${TRACK_HORIZONS.map(([k]) => `<td style="text-align:right">${hitTxt(st.h[k])}</td>`).join('')}</tr>`;
        }).join('')}</tbody></table></div></div>` : '';

  if(!list.length) {
    body.innerHTML = cloudNote + periodNote + periodCmp + `<div class="info-msg">Inga beslut${trackFilter === 'alla' ? '' : ' för ' + DECISION_SOURCES[trackFilter]} ${sel ? 'i perioden' : periods.length ? 'i den nya perioden än' : 'loggade än'}. Kör <b>AI-triage</b> i Aktiescreenern, <b>Portföljgenomlysning</b> eller <b>Institutionell djupanalys</b> – rekommendationerna hamnar här automatiskt.</div>`;
    return;
  }

  // Sammanfattning per källa: träffprocent per horisont + snittets "AI-alfa" (överavkastning i AI:ns riktning).
  const col = v => { v = r3(v); return v == null ? 'var(--text3)' : v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text2)'; };
  // Nästa utvärdering per horisont: tidigaste förfallodag bland väntande beslut (+ hur många som förfaller den dagen).
  const dayStart = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const nextDue = (rs, k) => {
    const due = rs.map(r => r.o.h[k] && r.o.h[k].due).filter(Boolean);
    if(!due.length) return null;
    const first = dayStart(Math.min(...due));
    return { at: first, days: Math.round((first - dayStart(Date.now())) / 86400000), n: due.filter(t => dayStart(t) === first).length };
  };
  const whenTxt = nd => nd.days <= 0 ? 'i dag' : nd.days === 1 ? 'i morgon' : `om ${nd.days} dagar`;
  const dateTxt = nd => new Date(nd.at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  const summary = (label, rs) => {
    const st = trackStats(rs), alpha = st.alpha;
    const hits = TRACK_HORIZONS.map(([k, , lbl]) => {
      const { done, hits: n } = st.h[k];
      const nd = done ? null : nextDue(rs, k);
      return `<div class="kpi-sub">${lbl}: ${done ? `<b style="color:${n / done >= 0.5 ? 'var(--green)' : 'var(--red)'}">${Math.round(n / done * 100)} %</b> <span class="muted">(${n}/${done})</span>` : `<span class="muted">väntar${nd ? ' · ' + whenTxt(nd) : ''}</span>`}</div>`;
    }).join('');
    return `<div class="kpi-card"><div class="kpi-label">${label} · ${rs.length} beslut</div>
      <div class="kpi-value" style="color:${alpha == null ? 'var(--text)' : alpha >= 0 ? 'var(--green)' : 'var(--red)'}" title="Snittlig överavkastning mot index sedan beslutet, i AI:ns riktning (för Sälj räknas en sämre aktie som plus)">${pct(alpha)}</div>
      <div class="kpi-sub muted">AI-alfa sedan beslut</div>${hits}</div>`;
  };
  const groups = trackFilter === 'alla'
    ? [summary('Alla', rows), ...Object.entries(DECISION_SOURCES).map(([k, l]) => { const rs = rows.filter(r => r.d.source === k); return rs.length ? summary(l, rs) : ''; })]
    : [summary(DECISION_SOURCES[trackFilter], rows)];

  const cell = v => `<td style="text-align:right;color:${col(v)}">${pct(v)}</td>`;
  const hcell = h => !h ? '<td></td>' : h.pending != null
    ? `<td style="text-align:right;color:var(--text3);font-size:11px">om ${h.pending} d</td>`
    // Färgen följer om AI:n hade rätt (✓/✗) – för Sälj är en aktie som gått sämre än index rätt.
    : `<td style="text-align:right;color:${h.excess == null ? 'var(--text3)' : h.hit != null ? (h.hit ? 'var(--green)' : 'var(--red)') : (h.excess >= 0 ? 'var(--green)' : 'var(--red)')}">${pct(h.excess)}${h.hit == null ? '' : h.hit ? ' ✓' : ' ✗'}</td>`;
  const actCol = a => DECISION_DIRECTION[a] > 0 ? 'var(--green)' : DECISION_DIRECTION[a] < 0 ? 'var(--red)' : 'var(--text2)';
  const table = rows.map(({ d, o }) => `<tr>
      <td style="white-space:nowrap">${new Date(d.created_at).toLocaleDateString('sv-SE')}</td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(DECISION_SOURCES[d.source] || d.source)}</td>
      <td style="cursor:pointer" onclick="loadStock('${escQuote(d.ticker)}','${escQuote(d.name || d.ticker)}')" title="${escHtml(d.note || '')}">${escHtml(d.name || d.ticker)}<div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${escHtml(d.ticker)}</div></td>
      <td style="font-weight:600;color:${actCol(d.action)}">${escHtml(d.action)}</td>
      <td style="text-align:right" class="td-mono">${fmtSekNum(d.price, 2)}</td>
      ${cell(o.sinceStock)}
      <td style="text-align:right;color:var(--text2)" title="${escHtml(BENCH_LABELS[d.benchmark] || d.benchmark)}">${pct(o.sinceBench)}</td>
      ${cell(o.sinceExcess)}
      ${TRACK_HORIZONS.map(([k]) => hcell(o.h[k])).join('')}
      <td><span class="wl-remove" title="Ta bort" onclick="deleteDecision('${escQuote(d.id)}')" style="cursor:pointer;opacity:.6">×</span></td>
    </tr>`).join('');

  const dueParts = TRACK_HORIZONS.map(([k, , lbl], i) => {
    const nd = nextDue(rows, k); if(!nd) return '';
    const txt = `${lbl}: ${i === 0 ? `<b>${whenTxt(nd)}</b>` : whenTxt(nd)} <span class="muted">(${dateTxt(nd)}, ${nd.n} beslut)</span>`;
    return i === 0 ? txt : `<span style="color:var(--text2)">${txt}</span>`;
  }).filter(Boolean);
  const dueNote = dueParts.length
    ? `<div class="info-msg" id="track-next" style="margin-bottom:14px">⏳ Nästa utvärdering · ${dueParts.join(' · ')}</div>` : '';

  body.innerHTML = cloudNote + periodNote + dueNote + periodCmp + `<div class="kpi-grid" style="margin-bottom:14px">${groups.join('')}</div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="pf-table">
      <thead><tr><th style="text-align:left">Datum</th><th style="text-align:left">Källa</th><th style="text-align:left">Bolag</th><th style="text-align:left">Åtgärd</th>
        <th style="text-align:right">Kurs då</th><th style="text-align:right">Sedan dess</th><th style="text-align:right">Index</th><th style="text-align:right">Mot index</th>
        ${TRACK_HORIZONS.map(([, , l]) => `<th style="text-align:right">${l}</th>`).join('')}<th></th></tr></thead>
      <tbody>${table}</tbody></table></div></div>
    <div style="font-size:11px;color:var(--text3);margin-top:10px;line-height:1.6">
      Utveckling i aktiens egen valuta mot dess lokala index (OMXS30, S&amp;P 500, Euro Stoxx 50 …), utan utdelningar.
      <b>Mot index</b> = aktiens utveckling minus indexets. <b>✓</b> = AI:n hade rätt riktning: Köp/Öka/Kandidat slog index, Sälj/Minska gick sämre än index.
      Behåll och Avvakta räknas inte i träffprocenten. Håll muspekaren över ett bolag för AI:ns motivering.
    </div>`;
  setUpdatedStamp('stamp-track');
}
