// conny-stocks · Makro, riskbarometer och megatrender.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ MACRO CHART ══════════
// MSCI EM/EAFE saknar rena index-tickers hos Yahoo – ETF:erna EEM/EFA följer dem.
const MACRO_INDICES = [
  { label:'S&P 500',   sym:'^GSPC',  fallback:8.4 },
  { label:'Nasdaq',    sym:'^IXIC',  fallback:10.9 },
  { label:'Dow Jones', sym:'^DJI',   fallback:6.6 },
  { label:'MSCI EM',   sym:'EEM',    fallback:22.0 },
  { label:'MSCI EAFE', sym:'EFA',    fallback:7.9 },
  { label:'OMXS30',    sym:'^OMX',   fallback:-1.0 },
  { label:'DAX',       sym:'^GDAXI', fallback:11.2 },
  { label:'FTSE 100',  sym:'^FTSE',  fallback:4.7 },
];
let macroChartInstance = null;

function drawMacroChart(labels, values) {
  const ctx = document.getElementById('macroChart');
  if(!ctx) return;
  if(macroChartInstance) macroChartInstance.destroy(); // undvik "Canvas already in use" vid omritning
  macroChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values,
        backgroundColor: values.map(v=>v>=0?'rgba(34,197,94,0.25)':'rgba(239,68,68,0.25)'),
        borderColor: values.map(v=>v>=0?'#22c55e':'#ef4444'),
        borderWidth: 1.5, borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 11 }, callback: v=>v+'%' } } } }
  });
}

// ══════════ RISKBAROMETER ══════════
// Marknadens rädsla/riskaptit via Yahoo (återanvänder fetchSparkData).
const nfmt0 = v => v.toLocaleString('sv-SE', { maximumFractionDigits: 0 });
const RISK_FEAR = [
  { sym:'^VIX',  label:'VIX · S&P-rädsla',  fmt:v=>v.toFixed(1), band:vixBand },
  { sym:'^VXN',  label:'VXN · Nasdaq-vol',  fmt:v=>v.toFixed(1) },
  { sym:'^SKEW', label:'SKEW · Svansrisk',  fmt:v=>v.toFixed(0), band:skewBand },
];
const RISK_ONOFF = [
  { sym:'DX-Y.NYB', label:'Dollarindex',       fmt:v=>v.toFixed(2) },
  { sym:'GC=F',     label:'Guld (oz)',          fmt:v=>'$'+nfmt0(v) },
  { sym:'SI=F',     label:'Silver (oz)',        fmt:v=>'$'+v.toFixed(2) },
  { sym:'HG=F',     label:'Koppar (lb)',        fmt:v=>'$'+v.toFixed(2) },
  { sym:'^TNX',     label:'10-årsränta USA',    fmt:v=>v.toFixed(2)+'%' },
  { sym:'HYG',      label:'High yield-kredit',  fmt:v=>'$'+v.toFixed(2) },
  { sym:'BTC-USD',  label:'Bitcoin',            fmt:v=>'$'+nfmt0(v) },
];

function vixBand(v) {
  if(v < 15) return { text:'Lugnt', color:'var(--green)' };
  if(v < 20) return { text:'Normalt', color:'var(--text)' };
  if(v < 30) return { text:'Oro', color:'var(--amber)' };
  if(v < 40) return { text:'Rädsla', color:'var(--red)' };
  return { text:'Panik', color:'var(--red)' };
}
function skewBand(v) {
  if(v < 125) return { text:'Normalt', color:'var(--text)' };
  if(v < 140) return { text:'Förhöjd svansrisk', color:'var(--amber)' };
  return { text:'Hög svansrisk', color:'var(--red)' };
}

const RISK_ALL = [...RISK_FEAR, ...RISK_ONOFF];
const riskLabel = sym => (RISK_ALL.find(x => x.sym === sym) || {}).label || sym;
let riskChartInstance = null;
let riskBySym = {};
let currentRiskSym = '^VIX';
let currentRiskPeriod = '3mo';
const RISK_RANGE = { '1mo':'1mo', '3mo':'3mo', '6mo':'6mo', '1y':'1y', '2y':'2y', '5y':'5y', '10y':'10y', 'max':'max' };
const RISK_PLABEL = { '1mo':'1M', '3mo':'3M', '6mo':'6M', '1y':'1Å', '2y':'2Å', '5y':'5Å', '10y':'10Å', 'max':'Max' };
// Kortens upplösning per period (grafen har sin egen karta i loadRiskChart).
// Yahoo degraderar ändå till månad vid range=max, så vi ber om det direkt.
const RISK_INTERVAL = { '10y':'1wk', 'max':'1mo' };

// Kompakt, klickbart indikatorkort. Klick väljer indikator för den stora grafen.
function riskCard(def, d) {
  // Förändring över vald period: från periodens första stängning till nu.
  let chg = null;
  if(d && d.closes && d.closes.length >= 2) chg = ((d.price - d.closes[0]) / d.closes[0]) * 100;
  const chgStr = chg != null ? (chg>=0?'▲ +':'▼ ') + Math.abs(chg).toFixed(1) + '%' : '';
  const chgCls = chg == null ? 'muted' : (chg>=0 ? 'green' : 'red');
  const band = (d && def.band) ? def.band(d.price) : null;
  const sel = def.sym === currentRiskSym ? ' sel' : '';
  const pl = RISK_PLABEL[currentRiskPeriod] || '';
  const sub = d
    ? `<span class="${chgCls}" title="Förändring över vald period (${pl})">${chgStr}</span> <span class="muted">${pl}</span>${band ? ` <span class="muted">· ${band.text}</span>` : ''}`
    : '<span class="muted">ingen data</span>';
  return `<div class="kpi-card risk-card${sel}" data-sym="${def.sym}" onclick="selectRiskSym('${def.sym}')">
    <div class="kpi-label">${def.label}</div>
    <div class="kpi-value"${band ? ` style="color:${band.color}"` : ''}>${d ? def.fmt(d.price) : '–'}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

function selectRiskSym(sym) {
  currentRiskSym = sym;
  document.querySelectorAll('#section-risk .risk-card').forEach(c => c.classList.toggle('sel', c.getAttribute('data-sym') === sym));
  document.getElementById('risk-chart-title').textContent = riskLabel(sym);
  loadRiskChart(sym, currentRiskPeriod);
}

async function setRiskPeriod(el, period) {
  document.querySelectorAll('#risk-periods .filter-chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  currentRiskPeriod = period;
  loadRiskChart(currentRiskSym, period);
  await refreshRiskCards(); // uppdatera kortens % till den nya perioden
}

// Stor graf över vald indikator, med valbar tidsaxel.
async function loadRiskChart(sym, period) {
  const rangeMap = {'1mo':'1mo','3mo':'3mo','6mo':'6mo','1y':'1y','2y':'2y','5y':'5y','10y':'10y','max':'max'};
  const intervalMap = {'1mo':'1d','3mo':'1d','6mo':'1d','1y':'1wk','2y':'1wk','5y':'1mo','10y':'1mo','max':'1mo'};
  try {
    const data = await fetchYahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${intervalMap[period]}&range=${rangeMap[period]}`);
    const r = data.chart.result[0];
    const ts = r.timestamp || [];
    const closes = (r.indicators.quote[0].close || []).map(v => v!=null ? +v.toFixed(2) : null);
    const labels = ts.map(t => new Date(t*1000).toLocaleDateString('sv-SE', {year:'numeric', month:'short', day:'numeric'}));
    const valid = closes.filter(v => v!=null);
    const up = valid.length ? valid[valid.length-1] >= valid[0] : true;
    const color = up ? '#22c55e' : '#ef4444';
    if(riskChartInstance) riskChartInstance.destroy();
    riskChartInstance = new Chart(document.getElementById('riskChart').getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ data: closes, borderColor: color, borderWidth: 2, backgroundColor: color + '18', fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, spanGaps: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 10 }, maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 10 } } } } }
    });
  } catch(e) {}
}

// Hämtar indikatordata för vald period och renderar korten.
async function refreshRiskCards() {
  let bySym = {};
  try {
    bySym = await fetchSparkData(RISK_ALL.map(x => x.sym), RISK_RANGE[currentRiskPeriod] || 'ytd', RISK_INTERVAL[currentRiskPeriod] || '1d');
  } catch(e) { /* visar "ingen data" per kort nedan */ }
  riskBySym = bySym; // spara för AI-sammanvägningen
  document.getElementById('risk-fear').innerHTML = RISK_FEAR.map(x => riskCard(x, bySym[x.sym])).join('');
  document.getElementById('risk-onoff').innerHTML = RISK_ONOFF.map(x => riskCard(x, bySym[x.sym])).join('');
}

// Skickar aktuella indikatorvärden till AI:n för en sammanvägd riskbedömning.
function aiAnalyzeRisk() {
  const pl = RISK_PLABEL[currentRiskPeriod] || '';
  const lines = RISK_ALL.map(def => {
    const d = riskBySym[def.sym];
    if(!d) return `- ${def.label}: data saknas`;
    const band = def.band ? def.band(d.price) : null;
    const chg = (d.closes && d.closes.length >= 2) ? ((d.price - d.closes[0]) / d.closes[0]) * 100 : null;
    const chgStr = chg != null ? (chg>=0?'+':'') + chg.toFixed(1) + '%' : '–';
    return `- ${def.label}: ${def.fmt(d.price)}${band ? ` (${band.text})` : ''}, ${pl}: ${chgStr}`;
  }).join('\n');
  openAI();
  const prompt =
    `Här är aktuella värden från min riskbarometer (förändring visas över ${pl}):\n\n${lines}\n\n` +
    `Gör en SAMMANVÄGD bedömning av dessa indikatorer tillsammans: lutar marknaden mot ` +
    `risk-på eller risk-av just nu, och hur starkt? Vilka indikatorer drar åt vilket håll, ` +
    `och finns det motstridiga signaler? Vad betyder helheten för mig som långsiktig svensk ` +
    `investerare? Avsluta med en kort, tydlig slutsats i en mening.`;
  stageAnalysis(prompt, 'Riskbarometer');
}

// Visar den senaste dagliga AI-sammanvägningen (skriven av motorn till Supabase).
async function loadDailyRiskAnalysis() {
  const el = document.getElementById('risk-daily');
  if(!el) return;
  if(!cloudEnabled || !sb) { el.style.display = 'none'; return; }
  try {
    const { data, error } = await sb.from('risk_analysis')
      .select('date,analysis,model').order('date', { ascending: false }).limit(1);
    if(error || !data || !data.length) { el.style.display = 'none'; return; }
    const a = data[0];
    const modelShort = a.model ? ' · ' + a.model.replace('claude-', '').replace(/-\d.*$/, '') : '';
    el.style.display = '';
    el.innerHTML = `<div class="card-title">✦ Dagens AI-sammanvägning <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· ${escHtml(a.date)}${escHtml(modelShort)}</span></div>
      <div style="font-size:13px;line-height:1.65;color:var(--text)">${escHtml(a.analysis).replace(/\n/g, '<br>')}</div>`;
  } catch(e) { el.style.display = 'none'; }
}

async function renderRisk() {
  document.getElementById('risk-fear').innerHTML = document.getElementById('risk-onoff').innerHTML = `<div class="muted" style="font-size:12px;padding:8px">Hämtar…</div>`;
  loadDailyRiskAnalysis();
  await refreshRiskCards();
  document.getElementById('risk-chart-title').textContent = riskLabel(currentRiskSym);
  loadRiskChart(currentRiskSym, currentRiskPeriod);
  setUpdatedStamp('stamp-risk');
}

// ══════════ MEGATRENDER ══════════
// Visar motorns dagliga temaanalyser (senaste datumet), en per tema.
function trendCompanyRow(c) {
  const dir = c.direction === 'gynnas' ? { sym: '▲', col: 'var(--green)' }
    : c.direction === 'missgynnas' ? { sym: '▼', col: 'var(--red)' }
    : { sym: '◆', col: 'var(--amber)' };
  const chip = c.ticker
    ? `<span class="ticker-chip" onclick="loadStock('${escQuote(c.ticker)}','${escQuote(c.name || c.ticker)}')">${escHtml(c.ticker)}</span>`
    : `<span class="ticker-chip macro">${escHtml(c.name || '')}</span>`;
  const nm = c.ticker && c.name ? escHtml(c.name) + ' — ' : '';
  return `<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:6px;font-size:12.5px">
    <span style="color:${dir.col};flex-shrink:0" title="${c.direction || ''}">${dir.sym}</span>
    ${chip}
    <span style="color:var(--text2)">${nm}${escHtml(c.reason || '')}</span>
  </div>`;
}

function trendCard(r) {
  const modelShort = r.model ? ' · ' + r.model.replace('claude-', '').replace(/-\d.*$/, '') : '';
  const companies = Array.isArray(r.companies) ? r.companies : [];
  const compHtml = companies.length ? `
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
      <div class="kpi-label" style="margin-bottom:8px">Påverkade bolag</div>
      ${companies.map(trendCompanyRow).join('')}
    </div>` : '';
  return `<div class="card" style="margin-bottom:12px">
    <div class="card-title">${escHtml(r.name)} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· ${r.signal_count || 0} signaler${escHtml(modelShort)}</span></div>
    <div style="font-size:13px;line-height:1.65;color:var(--text)">${escHtml(r.analysis || '').replace(/\n/g, '<br>')}</div>
    ${compHtml}
  </div>`;
}

async function renderTrends() {
  const el = document.getElementById('trends-list');
  if(!cloudEnabled || !sb) { el.innerHTML = `<div class="info-msg">Molnet är inte konfigurerat.</div>`; return; }
  el.innerHTML = `<div class="muted" style="padding:20px 4px">Laddar…</div>`;
  let data;
  try {
    const res = await sb.from('megatrends')
      .select('date,theme,name,analysis,companies,signal_count,model').order('date', { ascending: false }).limit(30);
    if(res.error) throw new Error(res.error.message);
    data = res.data || [];
  } catch(e) {
    el.innerHTML = `<div class="error-msg">Kunde inte hämta megatrender: ${escHtml(e.message)}</div>`;
    return;
  }
  if(!data.length) {
    el.innerHTML = `<div class="muted" style="padding:20px 4px">Inga megatrend-analyser ännu. Motorn genererar dem dagligen.</div>`;
    return;
  }
  const latest = data[0].date;
  const rows = data.filter(r => r.date === latest);
  const stamp = document.getElementById('stamp-trends');
  if(stamp) stamp.textContent = '· Analys ' + latest;
  el.innerHTML = rows.map(trendCard).join('');
  loadThemeSuggestions();
}

// Visar AI-föreslagna nya teman (status 'suggested') med aktivera/avfärda.
async function loadThemeSuggestions() {
  const el = document.getElementById('trends-suggestions');
  if(!el) return;
  if(!cloudEnabled || !sb) { el.innerHTML = ''; return; }
  let data;
  try {
    const res = await sb.from('themes').select('id,name,rationale').eq('status', 'suggested').order('created_at', { ascending: false });
    if(res.error) throw new Error(res.error.message);
    data = res.data || [];
  } catch(e) { el.innerHTML = ''; return; }
  if(!data.length) { el.innerHTML = ''; return; }
  const items = data.map(t => {
    const actions = currentUser
      ? `<span class="ticker-chip" onclick="activateTheme('${escQuote(t.id)}')">✓ Aktivera</span><span class="ticker-chip macro" onclick="dismissTheme('${escQuote(t.id)}')">Avfärda</span>`
      : '<span class="muted">Logga in för att aktivera</span>';
    return `<div class="signal-item" style="border-left-color:var(--purple)">
      <div class="signal-body">
        <div class="signal-summary"><b>${escHtml(t.name)}</b>${t.rationale ? ` — <span class="muted">${escHtml(t.rationale)}</span>` : ''}</div>
        <div class="signal-meta">${actions}</div>
      </div></div>`;
  }).join('');
  el.innerHTML = `<div class="card-title" style="margin:2px 0 10px">✦ Föreslagna teman (AI) <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· aktiveras och analyseras vid nästa dagliga körning</span></div>${items}`;
}

async function activateTheme(id) {
  if(!sb || !currentUser) return;
  const { error } = await sb.from('themes').update({ status: 'active' }).eq('id', id);
  if(error) { alert('Kunde inte aktivera temat: ' + error.message); return; }
  loadThemeSuggestions();
}
async function dismissTheme(id) {
  if(!sb || !currentUser) return;
  const { error } = await sb.from('themes').update({ status: 'dismissed' }).eq('id', id);
  if(error) { alert('Kunde inte avfärda temat: ' + error.message); return; }
  loadThemeSuggestions();
}

// Hämtar senaste värdet för en FRED-serie via proxyn.
async function fetchFred(series, units) {
  try {
    const r = await fetch(`/api/fred?series=${encodeURIComponent(series)}${units?`&units=${units}`:''}`);
    const j = await r.json();
    if(j && typeof j.value === 'number' && isFinite(j.value)) return { value: j.value, date: j.date };
  } catch(e){}
  return null;
}
async function fillFred(id, series, units, dec) {
  const el = document.getElementById(id);
  if(!el) return;
  const d = await fetchFred(series, units);
  el.textContent = d
    ? d.value.toFixed(dec == null ? 1 : dec) + '%' + (d.date ? ' (' + d.date.slice(0,7) + ')' : '')
    : '–';
}

// Svensk KPIF (12-månadersförändring) live från SCB. {value, period} eller null.
async function fetchScbKpif() {
  try {
    const params = new URLSearchParams({
      path: 'tables/TAB6445/data', lang: 'sv', outputFormat: 'json-stat2',
      'valueCodes[PrelAggr]': 'SKPI02', 'valueCodes[ContentsCode]': '000007PM', 'valueCodes[Tid]': 'top(1)'
    });
    const j = await (await fetch('/api/scb?' + params)).json();
    const val = j && j.value && j.value[0];
    const tidLab = j && j.dimension && j.dimension.Tid && j.dimension.Tid.category.label;
    const period = tidLab ? Object.values(tidLab).pop().replace('M', '-') : '';
    return val != null ? { value: val, period } : null;
  } catch(e) { return null; }
}
async function fillScbKpif(id) {
  const el = document.getElementById(id);
  if(!el) return;
  const d = await fetchScbKpif();
  el.textContent = d ? d.value.toFixed(1) + '%' + (d.period ? ' (' + d.period + ')' : '') : '–';
}

async function renderMacro() {
  // Datumstämpel: aktuell månad/år istället för fast "juni 2026"
  const dateEl = document.getElementById('macro-date');
  if(dateEl) dateEl.textContent = '· Globalt läge ' + new Date().toLocaleDateString('sv-SE', { month:'long', year:'numeric' });

  // Rita direkt med fallback-siffror så diagrammet syns även innan Yahoo svarat
  drawMacroChart(MACRO_INDICES.map(i=>i.label), MACRO_INDICES.map(i=>i.fallback));

  try {
    const bySym = await fetchSparkData([...MACRO_INDICES.map(i=>i.sym), 'BZ=F', 'SEK=X', '^TNX']);
    const values = MACRO_INDICES.map(i => (bySym[i.sym] && bySym[i.sym].ytd != null) ? +bySym[i.sym].ytd.toFixed(1) : i.fallback);
    drawMacroChart(MACRO_INDICES.map(i=>i.label), values);

    const brent = bySym['BZ=F'];
    if(brent) {
      const valEl = document.getElementById('m-brent'), subEl = document.getElementById('m-brent-sub');
      if(valEl) valEl.textContent = '$' + fmtSekNum(brent.price, brent.price < 100 ? 2 : 0);
      if(subEl && brent.day != null) {
        subEl.textContent = fmtSekPct(brent.day) + ' idag';
        subEl.className = 'kpi-sub ' + (brent.day >= 0 ? 'green' : 'red');
      }
    }
    const sek = bySym['SEK=X'];
    if(sek) { const el = document.getElementById('m-usdsek'); if(el) el.textContent = fmtSekNum(sek.price, 2); }
    const tnx = bySym['^TNX'];
    if(tnx) { const el = document.getElementById('m-us10y'); if(el) el.textContent = fmtSekNum(tnx.price, 2) + '%'; }
    setUpdatedStamp('stamp-macro');
  } catch(e) { /* behåll fallback-siffrorna om Yahoo strular */ }
  refreshRates();

  // Makrostatistik live via FRED (USA) och FRED/OECD (Sverige).
  fillFred('m-us-gdp',   'A191RL1Q225SBEA', 'lin', 1);
  fillFred('m-us-cpi',   'CPIAUCSL',        'pc1', 1);
  fillFred('m-us-core',  'CPILFESL',        'pc1', 1);
  fillFred('m-us-unemp', 'UNRATE',          'lin', 1);
  fillScbKpif('m-se-cpi'); // svensk inflation (KPIF) live från SCB
  fillFred('m-se-unemp', 'LRHUTTTTSEM156S',  'lin', 1);
  fillFred('m-se-gdp',   'CLVMNACSCAB1GQSE', 'pc1', 1);
}

// Centralbankernas styrräntor via egen Pages Function (nyckelfria källor).
async function refreshRates() {
  try {
    const r = await fetch('/api/rates');
    const d = await r.json();
    const dstr = s => s ? new Date(s).toLocaleDateString('sv-SE', { day:'numeric', month:'short' }) : '';
    const set = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
    if(d.fed) {
      set('r-fed', fmtSekNum(d.fed.low, 2) + '–' + fmtSekNum(d.fed.high, 2) + '%');
      set('r-fed-sub', 'EFFR ' + fmtSekNum(d.fed.effr, 2) + '% · ' + dstr(d.fed.date));
    }
    if(d.riksbank) {
      set('r-riks', fmtSekNum(d.riksbank.rate, 2) + '%');
      set('r-riks-sub', 'Styrränta · ' + dstr(d.riksbank.date));
      set('m-se-repo', fmtSekNum(d.riksbank.rate, 2) + '%');
    }
    if(d.ecb) {
      set('r-ecb', fmtSekNum(d.ecb.rate, 2) + '%');
      set('r-ecb-sub', 'Huvudränta (MRO)' + (d.ecb.date ? ' · ' + dstr(d.ecb.date) : ''));
    }
  } catch(e) { /* behåll fallback-värden om källorna strular */ }
}
