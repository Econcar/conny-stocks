// conny-stocks · Fondsida, jämförelse, aktiesidan (Aktiedetalj) och insynshandel.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ AVANZA FUND DETAIL ══════════
function fmtDev(v) { return (v===null||v===undefined) ? '–' : (v>=0?'+':'')+v.toFixed(1)+'%'; }
function devCls(v) { return (v===null||v===undefined) ? '' : (v>=0?'green':'red'); }

const avanzaPeriodMap = { '1w':'one_week','1mo':'one_month','3mo':'three_months','6mo':'six_months','1y':'one_year','2y':'three_years','5y':'five_years' };

async function loadFund(orderBookId, name) {
  currentTicker = 'AZA:' + orderBookId;
  currentStockName = name;
  currentIsFund = true;
  currentFundId = orderBookId;
  stopDetailAutoRefresh(); // fonder prissätts en gång per dag – ingen auto-uppdatering
  currentStockMeta = { kurs:'–', ytd:null, pe:null, div:null, mcap:null, sektor:'Fond', flag:'🇸🇪', r:'' };
  currentPeriod = '3mo';
  renderFundamentals(null);
  compareSyms = [];
  aiStockDetail = '';
  const _cc = document.getElementById('chart-controls'); if(_cc) _cc.style.display = 'none'; // jämförelse stöds ej för fonder
  { const c = document.getElementById('d-insider-card'); if(c) c.style.display = 'none'; }   // insynshandel gäller bolag, inte fonder
  resetDeepAnalysis(false); // djupanalysen bygger på bolagsnyckeltal – finns inte för fonder
  document.getElementById('nav-detail').style.display = 'flex';
  document.getElementById('nav-detail-name').textContent = name.length > 12 ? name.slice(0,12)+'…' : name;
  showSection('detail');
  document.getElementById('detail-loading').style.display = 'block';
  document.getElementById('detail-content').style.display = 'none';
  document.getElementById('detail-error').style.display = 'none';
  setAIContext(`Aktuell fond: ${name}`);
  try {
    const f = await avanzaGet('/_api/fund-guide/guide/' + orderBookId);
    const cur = f.currency || 'SEK';
    const d1 = f.developmentOneDay;
    document.getElementById('d-name').textContent = name;
    document.getElementById('d-fullname').textContent = f.isin || '';
    document.getElementById('d-exchange').textContent = 'Avanza fond';
    document.getElementById('d-sector-tag').textContent = 'Fond';
    document.getElementById('d-price').textContent = (f.nav!=null ? f.nav.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}) : '–') + ' ' + cur;
    const chEl = document.getElementById('d-change');
    chEl.textContent = `${d1>=0?'+':''}${d1!=null?d1.toFixed(2):'0'}% idag`;
    chEl.className = 'detail-change ' + (d1>=0?'green':'red');
    document.getElementById('d-meta').innerHTML = [
      f.rating ? `<span class="meta-pill">Morningstar: ${f.rating}/5</span>` : '',
      f.risk!=null ? `<span class="meta-pill">Risk: ${f.riskText||f.risk}</span>` : '',
      `<span class="meta-pill">ISIN: ${f.isin||'–'}</span>`
    ].filter(Boolean).join('');
    const kpis = [
      {l:'NAV (kurs)', v:(f.nav!=null?f.nav.toFixed(2):'–')+' '+cur},
      {l:'Idag', v:`${d1>=0?'+':''}${d1!=null?d1.toFixed(2):'0'}%`, cls:d1>=0?'green':'red'},
      {l:'I år', v:fmtDev(f.developmentThisYear), cls:devCls(f.developmentThisYear)},
      {l:'1 år', v:fmtDev(f.developmentOneYear), cls:devCls(f.developmentOneYear)},
      {l:'3 år', v:fmtDev(f.developmentThreeYears), cls:devCls(f.developmentThreeYears)},
      {l:'5 år', v:fmtDev(f.developmentFiveYears), cls:devCls(f.developmentFiveYears)},
      {l:'Avgift', v:(f.managementFee!=null?f.managementFee+'%':'–')},
      {l:'Risknivå', v:(f.risk!=null?f.risk+'/7':'–')},
    ];
    document.getElementById('d-kpis').innerHTML = kpis.map(k=>`<div class="kpi-mini"><div class="kpi-mini-label">${k.l}</div><div class="kpi-mini-val ${k.cls||''}">${k.v}</div></div>`).join('');
    document.getElementById('d-facts').innerHTML = [
      `ISIN: <span style="color:var(--text);font-family:var(--mono)">${f.isin||'–'}</span>`,
      `Valuta: <span style="color:var(--text)">${cur}</span>`,
      `Förvaltningsavgift: <span style="color:var(--text)">${f.managementFee!=null?f.managementFee+'%':'–'}</span>`,
      `Risknivå: <span style="color:var(--text)">${f.risk!=null?f.risk+'/7 '+(f.riskText||''):'–'}</span>`,
      f.rating ? `Morningstar: <span style="color:var(--text)">${f.rating}/5</span>` : ''
    ].filter(Boolean).map(l=>`<div>${l}</div>`).join('');
    document.getElementById('d-description').innerHTML = formatDescription(f.description);
    currentStockMeta = {
      kurs: (f.nav!=null?f.nav.toFixed(2):'–')+' '+cur,
      ytd: (f.developmentThisYear!=null?f.developmentThisYear:null),
      pe: null, div: null, mcap: null, sektor: 'Fond', flag: '🇸🇪', r: '',
      fee: f.managementFee, risk: f.risk, dev1y: f.developmentOneYear
    };
    // återställ graf-knapparna till 3M
    document.querySelectorAll('#section-detail .filter-chip').forEach(c=>c.classList.remove('on'));
    const chip3m = document.querySelector("#section-detail .filter-chip[onclick*=\"'3mo'\"]");
    if(chip3m) chip3m.classList.add('on');
    await loadFundChart(orderBookId, 'three_months');
    document.getElementById('detail-loading').style.display = 'none';
    document.getElementById('detail-content').style.display = 'block';
  } catch(e) {
    document.getElementById('detail-loading').style.display = 'none';
    document.getElementById('detail-error').style.display = 'block';
    document.getElementById('detail-error').textContent = `Kunde inte hämta fonddata för ${name}. Avanzas API kan ha tillfälliga problem – försök igen.`;
  }
}

async function loadFundChart(orderBookId, period) {
  try {
    const data = await avanzaGet('/_api/fund-guide/chart/' + orderBookId + '/' + period);
    const serie = data.dataSerie || [];
    const labels = serie.map(p=>new Date(p.x).toLocaleDateString('sv-SE',{year:'numeric',month:'short',day:'numeric'}));
    const values = serie.map(p=>+p.y.toFixed(2));
    if(currentPriceChart) currentPriceChart.destroy();
    const ctx = document.getElementById('priceChart').getContext('2d');
    const first = values[0], last = values[values.length-1];
    const isUp = last >= first;
    const color = isUp ? '#22c55e' : '#ef4444';
    currentPriceChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderColor: color, borderWidth: 2, backgroundColor: color+'18', fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: c=>c.parsed.y+'%' } } },
        scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 10 }, maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 10 }, callback: v=>v+'%' } } } }
    });
    document.getElementById('d-chart-title').textContent = 'Utveckling (%)';
  } catch(e) {}
}

// ══════════ COMPARE ══════════
function compareSelected() {
  [...screenerSel].forEach(t=>{
    const s = screenerSelMeta[t];
    if(s && compareList.length < 5 && !compareList.some(c=>c.ticker===s.ticker)) compareList.push(s);
  });
  showSection('compare');
}

function addToCompare() {
  if(!currentTicker) return;
  if(compareList.some(c=>c.ticker===currentTicker)) { showSection('compare'); return; }
  if(compareList.length >= 5) { alert('Du kan jämföra max 5 aktier åt gången. Ta bort en först.'); return; }
  const local = stocks.find(s=>s.ticker===currentTicker);
  compareList.push(local || {
    name: currentStockName, ticker: currentTicker,
    flag: currentStockMeta.flag || '', r: currentStockMeta.r || '',
    sektor: currentStockMeta.sektor || 'Aktie', kurs: currentStockMeta.kurs || '–',
    ytd: currentStockMeta.ytd, pe: currentStockMeta.pe, div: currentStockMeta.div, mcap: currentStockMeta.mcap
  });
  showSection('compare');
}

function removeFromCompare(ticker) {
  compareList = compareList.filter(c=>c.ticker!==ticker);
  renderCompare();
}

function renderCompare() {
  const content = document.getElementById('compare-content');
  const sel = compareList.slice(0,5);
  if(sel.length === 0) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">⇄</div><div class="empty-text">Inga aktier valda ännu.<br>Bocka i aktier i <strong>Aktiescreener</strong> och klicka <strong>"Jämför valda"</strong>, eller klicka <strong>"+ Jämförelse"</strong> på en aktiesida.</div></div>`;
    return;
  }
  const rows = [
    ['Marknad', s=> s.r ? `${s.flag||''} ${s.r.toUpperCase()}` : '–'],
    ['Sektor', s=> s.sektor || '–'],
    ['Kurs', s=> s.kurs || '–'],
    ['ÅTD %', s=> (s.ytd===null||s.ytd===undefined) ? '–' : {v:(s.ytd>=0?'+':'')+s.ytd.toFixed(1)+'%', cls:s.ytd>=0?'green':'red'}],
    ['P/E-tal', s=> s.pe ? s.pe.toFixed(1) : '–'],
    ['Direktavkastning', s=> s.div>0 ? s.div.toFixed(1)+'%' : '–'],
    ['Marknadsvärde', s=> s.mcap ? (s.mcap>=1000?(s.mcap/1000).toFixed(1)+'T USD':'$'+s.mcap+'B') : '–'],
  ];
  let html = '<div class="card" style="padding:0"><div class="table-wrap"><table>';
  html += '<thead><tr><th></th>' + sel.map(s=>`<th style="color:var(--text)">${s.flag||''} ${s.name}<div class="td-ticker">${s.ticker}</div><div onclick="removeFromCompare('${escQuote(s.ticker)}')" style="font-size:10px;color:var(--text3);cursor:pointer;margin-top:2px">✕ ta bort</div></th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(([label, fn])=>{
    html += `<tr><td style="color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:0.04em">${label}</td>`;
    sel.forEach(s=>{
      const r = fn(s);
      if(typeof r === 'object') html += `<td class="td-mono ${r.cls||''}">${r.v}</td>`;
      else html += `<td class="td-mono">${r}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  html += `<div style="margin-top:14px;display:flex;gap:8px"><button class="ghost-btn" onclick="showSection('screener')">← Till screener</button><button class="action-btn" onclick="analyzeCompareList()">✦ Analysera jämförelsen med AI</button></div>`;
  if(sel.some(s=>s.pe===null||s.pe===undefined)) {
    html += `<div class="info-msg" style="margin-top:12px">Vissa nyckeltal saknas för aktier som hämtats via Yahoo-sökningen. AI-analysen fyller i bilden.</div>`;
  }
  content.innerHTML = html;
}

function analyzeCompareList() {
  if(compareList.length === 0) return;
  const names = compareList.map(c=>c.name);
  openAI();
  const prompt = names.length === 1
    ? `Analysera ${names[0]} – ge mig nyckeltal, styrkor, risker och en sammanfattande bedömning.`
    : `Jämför och analysera dessa aktier: ${names.join(', ')}. Visa styrkor, risker och vilken som ser mest attraktiv ut.`;
  stageAnalysis(prompt, names.length === 1 ? 'Analys: ' + names[0] : 'Jämförelse: ' + names.join(', '));
}

// ══════════ STOCK DETAIL ══════════
async function loadStock(ticker, name) {
  currentTicker = ticker;
  currentStockName = name;
  currentIsFund = false;
  currentFundId = null;
  currentStockMeta = { kurs:'–', ytd:null, pe:null, div:null, mcap:null, sektor:'Aktie', flag:'', r:'' };
  renderFundamentals(null);
  { const c = document.getElementById('d-insider-card'); if(c) c.style.display = 'none'; } // föregående bolags rader ska inte ligga kvar
  resetDeepAnalysis(true);
  compareSyms = [];
  aiStockDetail = '';
  const _cc = document.getElementById('chart-controls'); if(_cc) _cc.style.display = 'flex';
  const _ch = document.getElementById('compare-chips'); if(_ch) _ch.innerHTML = '';
  document.getElementById('d-chart-title').textContent = 'Kursutveckling';
  document.getElementById('nav-detail').style.display = 'flex';
  document.getElementById('nav-detail-name').textContent = name.length > 12 ? name.slice(0,12)+'…' : name;
  showSection('detail');
  document.getElementById('detail-loading').style.display = 'block';
  document.getElementById('detail-content').style.display = 'none';
  document.getElementById('detail-error').style.display = 'none';
  setAIContext(`Aktuell aktie: ${name} (${ticker})`);
  try {
    await Promise.all([loadStockQuote(ticker, name), loadPriceChart(ticker, currentPeriod)]);
    document.getElementById('detail-loading').style.display = 'none';
    document.getElementById('detail-content').style.display = 'block';
    startStockAutoRefresh();
  } catch(e) {
    document.getElementById('detail-loading').style.display = 'none';
    document.getElementById('detail-error').style.display = 'block';
    document.getElementById('detail-error').textContent = `Kunde inte hämta data för ${ticker}. Yahoo Finance-proxyn kan ha temporära problem. Försök igen eller klicka på en annan aktie.`;
    loadStockFallback(ticker, name);
  }
}

async function fetchYahoo(url) {
  const proxy = `/api/yahoo?url=${encodeURIComponent(url)}`;
  const r = await fetch(proxy);
  return await r.json();
}

// Live fundamenta för valfri ticker via quoteSummary-proxyn.
async function fetchFundamentals(ticker) {
  try {
    const r = await fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`);
    const j = await r.json();
    const res = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
    if(!res) return null;
    const sd = res.summaryDetail || {}, pr = res.price || {}, ap = res.assetProfile || {},
          ks = res.defaultKeyStatistics || {}, fd = res.financialData || {};
    const raw = o => (o && typeof o.raw === 'number') ? o.raw : null;
    const pct1 = o => raw(o) != null ? raw(o) * 100 : null;
    const dy = raw(sd.dividendYield);
    return {
      pe: raw(sd.trailingPE),
      forwardPe: raw(sd.forwardPE) != null ? raw(sd.forwardPE) : raw(ks.forwardPE),
      pb: raw(ks.priceToBook),
      peg: raw(ks.pegRatio),
      ps: raw(sd.priceToSalesTrailing12Months),
      beta: raw(sd.beta),
      eps: raw(ks.trailingEps),
      div: dy != null ? dy * 100 : (raw(sd.trailingAnnualDividendYield) != null ? raw(sd.trailingAnnualDividendYield) * 100 : null),
      payout: pct1(sd.payoutRatio),
      mcap: raw(pr.marketCap) != null ? raw(pr.marketCap) : raw(sd.marketCap),
      ev: raw(ks.enterpriseValue),
      evEbitda: raw(ks.enterpriseToEbitda),
      currency: pr.currency || null,
      revenue: raw(fd.totalRevenue),
      revenueGrowth: pct1(fd.revenueGrowth),
      grossMargin: pct1(fd.grossMargins),
      opMargin: pct1(fd.operatingMargins),
      profitMargin: pct1(fd.profitMargins),
      roe: pct1(fd.returnOnEquity),
      cash: raw(fd.totalCash),
      debt: raw(fd.totalDebt),
      debtToEquity: raw(fd.debtToEquity),
      currentRatio: raw(fd.currentRatio),
      fcf: raw(fd.freeCashflow),
      ebitda: raw(fd.ebitda),
      opCashflow: raw(fd.operatingCashflow),
      netIncome: raw(ks.netIncomeToCommon),
      sharesOut: raw(ks.sharesOutstanding),
      // Rapportvalutan kan skilja sig från handelsvalutan (t.ex. USD-rapporterande
      // bolag på Stockholmsbörsen) – då går FCF/börsvärde inte att dela rakt av.
      finCurrency: fd.financialCurrency || null,
      targetMean: raw(fd.targetMeanPrice),
      targetHigh: raw(fd.targetHighPrice),
      targetLow: raw(fd.targetLowPrice),
      recommendation: fd.recommendationKey || null,
      numAnalysts: raw(fd.numberOfAnalystOpinions),
      sector: ap.sector || null,
      industry: ap.industry || null,
      description: ap.longBusinessSummary || null,
      // Insynshandel (SEC Form 4) – tom lista för icke-US-noterade bolag.
      insider: ((res.insiderTransactions || {}).transactions || []).map(t => ({
        datum: (t.startDate && t.startDate.fmt) || null,
        person: t.filerName || '',
        befattning: t.filerRelation || '',
        text: t.transactionText || '',
        volym: raw(t.shares),
        varde: raw(t.value)
      })),
      insiderNetto: (() => {
        const n = res.netSharePurchaseActivity;
        if(!n) return null;
        return { period: n.period || null, kopta: raw(n.buyInfoShares), salda: raw(n.sellInfoShares),
                 netto: raw(n.netInfoShares), kopAntal: raw(n.buyInfoCount), saljAntal: raw(n.sellInfoCount) };
      })()
    };
  } catch(e) { return null; }
}

// ══════════ INSYNSHANDEL ══════════
// Två källor: Yahoo (SEC Form 4 → bara US-noterade bolag) och Finansinspektionens
// insynsregister via /api/insider-se (svensknoterade). Resten av världen saknar
// vi källa för – då säger kortet det rakt ut i stället för att se tomt ut.
const insiderSeCache = {};

// Klassar en transaktion som köp/sälj/övrigt. Yahoo skriver fritext ("Sale at
// price ..."), FI har ett kodat fält (Förvärv/Avyttring/Tilldelning/…).
function insiderTyp(text) {
  const t = (text || '').toLowerCase();
  if(/förvärv|teckning|purchase|\bbuy\b/.test(t)) return 'kop';
  if(/avyttring|sale|sold|disposal/.test(t)) return 'salj';
  return 'ovrigt';
}
// Räknar ihop köp/sälj i en lista insynsaffärer. Fungerar för båda källorna:
// Yahoo har fritext i .text ("Sale at price …"), FI ett kodat fält i .karaktar.
function insynSummering(lista, manader = 12){
  const grans = new Date(Date.now() - manader*31*86400*1000).toISOString().slice(0,10);
  let kop = 0, salj = 0, ovrigt = 0, senast = null;
  for(const t of lista || []){
    const d = (t.datum || '').slice(0,10);
    if(d && d < grans) continue;
    const typ = insiderTyp(t.karaktar || t.text || '');
    if(typ === 'kop') kop++; else if(typ === 'salj') salj++; else ovrigt++;
    if(d && (!senast || d > senast)) senast = d;
  }
  return (kop || salj || ovrigt) ? { kop, salj, ovrigt, senast } : null;
}

const INSIDER_FARG = { kop:'var(--green)', salj:'var(--red)', ovrigt:'var(--text2)' };
const INSIDER_ETIKETT = { kop:'Köp', salj:'Sälj', ovrigt:'Övrigt' };

function insiderRad({ datum, person, befattning, typ, textLang, volym, belopp, valuta }) {
  const f = INSIDER_FARG[typ];
  return `<tr>
    <td style="white-space:nowrap;color:var(--text2);font-size:12px">${escHtml(datum || '–')}</td>
    <td><div style="font-size:12.5px">${escHtml(person || '–')}</div>${befattning ? `<div style="font-size:10px;color:var(--text3)">${escHtml(befattning)}</div>` : ''}</td>
    <td style="color:${f};font-size:12px;white-space:nowrap">${INSIDER_ETIKETT[typ]}${textLang ? `<div style="font-size:10px;color:var(--text3)">${escHtml(textLang)}</div>` : ''}</td>
    <td style="text-align:right" class="td-mono">${volym != null ? fmtSekNum(volym, 0) : '–'}</td>
    <td style="text-align:right" class="td-mono">${belopp != null ? fmtSekNum(belopp, 0) + (valuta ? ' ' + escHtml(valuta) : '') : '–'}</td>
  </tr>`;
}

function insiderTabell(rader) {
  return `<div style="overflow-x:auto"><table class="wl-table">
    <thead><tr><th>Datum</th><th>Person</th><th>Typ</th><th style="text-align:right">Volym</th><th style="text-align:right">Belopp</th></tr></thead>
    <tbody>${rader.join('')}</tbody></table></div>`;
}

async function renderInsider(ticker, name, fund) {
  const card = document.getElementById('d-insider-card');
  if(!card) return;
  const src = document.getElementById('d-insider-src');
  const net = document.getElementById('d-insider-net');
  const body = document.getElementById('d-insider-body');
  const tom = t => { card.style.display = ''; net.innerHTML = ''; body.innerHTML = `<div class="muted" style="font-size:13px;padding:6px 2px">${t}</div>`; };

  // 1) Yahoo/SEC – finns bara för US-noterade bolag.
  const us = (fund && fund.insider) || [];
  if(us.length){
    src.textContent = '· SEC Form 4 via Yahoo';
    const n = fund.insiderNetto;
    // Yahoos egen sammanställning räknar även tilldelningar och optionslösen som
    // "köpta" – därför kan den säga hundratusentals köpta aktier medan tabellen
    // nedan (som klassar per transaktion) visar noll rena marknadsköp. Säg vems
    // siffra det är, annars ser de två motsägelsefulla ut.
    net.innerHTML = (n && (n.kopta || n.salda))
      ? `<div style="font-size:12.5px;color:var(--text2);margin-bottom:10px">Yahoos sammanställning, senaste ${escHtml(n.period || '6m')} (inkl. tilldelningar):
          <span style="color:var(--green)">${fmtSekNum(n.kopta||0,0)} köpta</span> (${n.kopAntal||0} affärer) ·
          <span style="color:var(--red)">${fmtSekNum(n.salda||0,0)} sålda</span> (${n.saljAntal||0} affärer) ·
          netto <span style="color:${(n.netto||0)>=0?'var(--green)':'var(--red)'}">${(n.netto||0)>=0?'+':''}${fmtSekNum(n.netto||0,0)}</span> aktier</div>`
      : '';
    body.innerHTML = insiderTabell(us.slice(0, 25).map(t => insiderRad({
      datum: t.datum, person: t.person, befattning: t.befattning,
      typ: insiderTyp(t.text), textLang: (t.text || '').replace(/ at price.*/i, '').trim() || null,
      volym: t.volym, belopp: t.varde || null, valuta: fund.currency
    })));
    card.style.display = '';
    return;
  }

  // 2) Finansinspektionen – svensknoterade bolag.
  if(/\.ST$/i.test(ticker)){
    src.textContent = '· Finansinspektionens insynsregister';
    const q = name || ticker.replace(/\.ST$/i, '');
    try {
      let data = insiderSeCache[ticker];
      if(!data){
        tom('Hämtar insynshandel från Finansinspektionen…'); // bara vid första hämtningen,
        const r = await fetch(`/api/insider-se?q=${encodeURIComponent(q)}&months=12`);
        data = await r.json();                               // annars blinkar den var 30:e sekund
        insiderSeCache[ticker] = data;
      }
      const tx = (data && data.transaktioner) || [];
      if(!tx.length){
        const k = (data && data.kandidater) || [];
        return tom(k.length
          ? `Hittade inga affärer för <b>${escHtml(q)}</b>. Registret har däremot träffar för: ${k.map(escHtml).join(', ')}.`
          : 'Inga rapporterade insynsaffärer de senaste 12 månaderna.');
      }
      src.textContent = `· Finansinspektionen${data.emittent ? ' · ' + data.emittent : ''}`;
      const kop = tx.filter(t => insiderTyp(t.karaktar) === 'kop').length;
      const salj = tx.filter(t => insiderTyp(t.karaktar) === 'salj').length;
      // Räknarna gäller raderna vi faktiskt fått – säg det om listan är kapad.
      const kapad = data.totalt != null && data.totalt > tx.length;
      net.innerHTML = `<div style="font-size:12.5px;color:var(--text2);margin-bottom:10px">${kapad ? `Senaste ${tx.length} av ${data.totalt} affärer` : 'Senaste 12 månaderna'}:
        <span style="color:var(--green)">${kop} köp</span> · <span style="color:var(--red)">${salj} försäljningar</span> ·
        ${tx.length - kop - salj} övriga (tilldelning, gåva m.m.)</div>`;
      body.innerHTML = insiderTabell(tx.slice(0, 25).map(t => insiderRad({
        datum: t.datum, person: t.person, befattning: t.befattning,
        typ: insiderTyp(t.karaktar), textLang: t.karaktar + (t.narstaende ? ' · närstående' : ''),
        volym: t.volym, belopp: (t.volym != null && t.pris) ? t.volym * t.pris : null, valuta: t.valuta
      })));
    } catch(e){ tom('Kunde inte hämta insynshandel från Finansinspektionen just nu.'); }
    return;
  }

  // 3) Övriga marknader – ingen källa.
  src.textContent = '';
  tom('Insynshandel visas för US-noterade bolag (SEC Form 4) och svensknoterade (Finansinspektionen). För den här marknaden saknar vi källa.');
}

function fmtMcap(v, cur) {
  if(v == null) return null;
  const c = cur ? ' ' + cur : '';
  const s = Math.abs(v);
  if(s >= 1e12) return (v/1e12).toFixed(2) + 'T' + c;
  if(s >= 1e9) return (v/1e9).toFixed(1) + 'B' + c;
  if(s >= 1e6) return (v/1e6).toFixed(1) + 'M' + c;
  return v.toLocaleString('sv-SE') + c;
}

const REC_LABELS = { strong_buy:'Stark köp', buy:'Köp', hold:'Behåll', underperform:'Underprestera', sell:'Sälj', none:'–' };
let currentDescRaw = '';

// Bryter en lång löptext i stycken (befintliga radbrytningar om de finns, annars grupper om ~3 meningar).
function formatDescription(raw) {
  if(!raw) return '';
  let paras = String(raw).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if(paras.length <= 1) {
    const sentences = String(raw).match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [raw];
    paras = [];
    let buf = '', count = 0;
    for(const s of sentences) {
      buf += s;
      if(++count >= 3) { paras.push(buf.trim()); buf = ''; count = 0; }
    }
    if(buf.trim()) paras.push(buf.trim());
  }
  return paras.map(p => `<p style="margin:0 0 10px">${escHtml(p)}</p>`).join('');
}

// Visar bolagsbeskrivningen; erbjuder svensk översättning (cachas per bolag).
function renderDescription(ticker, desc) {
  const el = document.getElementById('d-description');
  const tr = document.getElementById('d-desc-translate');
  if(!el) return;
  currentDescRaw = desc || '';
  if(tr) tr.innerHTML = '';
  const cached = ticker ? localStorage.getItem('descsv_' + ticker) : null;
  if(cached) { el.innerHTML = formatDescription(cached); return; }   // redan svensk (cachad)
  if(!desc) { el.innerHTML = ''; return; }
  el.innerHTML = formatDescription(desc);                            // visa engelska medan vi översätter
  if(getApiKey()) {
    translateDesc(ticker);                                      // alltid svenska: auto-översätt
  } else if(tr) {
    tr.innerHTML = `<span onclick="translateDesc('${escQuote(ticker)}')" style="color:var(--accent);cursor:pointer;font-size:12px">🌐 Översätt till svenska</span>`;
  }
}

async function translateDesc(ticker) {
  const raw = currentDescRaw;
  if(!raw) return;
  if(!getApiKey()) { openAI(); return; }
  const el = document.getElementById('d-description');
  el.innerHTML = `<div class="muted" style="font-size:12px">Översätter…</div>`;
  try {
    const r = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': getApiKey() },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 800,
        messages: [{ role: 'user', content: `Översätt följande bolagsbeskrivning till svenska. Behåll alla fakta exakt – hitta inte på något och lägg inte till något. Svara ENDAST med den svenska översättningen:\n\n${raw}` }]
      })
    });
    const j = await r.json();
    const sv = j.content && j.content[0] && j.content[0].text && j.content[0].text.trim();
    if(!sv) throw new Error('tomt svar');
    try { localStorage.setItem('descsv_' + ticker, sv); } catch(e){}
    el.innerHTML = formatDescription(sv);
    const tr = document.getElementById('d-desc-translate'); if(tr) tr.innerHTML = '';
  } catch(e) {
    el.innerHTML = `${formatDescription(raw)}<div style="margin-top:8px;color:#fca5a5;font-size:12px">Kunde inte översätta (kontrollera API-nyckeln).</div>`;
  }
}

// Renderar det rika Nyckeltal-kortet i aktiedetaljen.
function renderFundamentals(f, currency) {
  const card = document.getElementById('d-fund-card');
  const el = document.getElementById('d-fundamentals');
  if(!card || !el) return;
  if(!f) { card.style.display = 'none'; return; }
  const cur = f.currency || currency || '';
  const money = v => v == null ? null : fmtMcap(v, cur);
  const pctv = v => v == null ? null : (v>=0?'+':'') + v.toFixed(1) + '%';
  const nn = (v, d) => v == null ? null : v.toFixed(d);
  const rows = [
    ['P/E (TTM)', nn(f.pe,1)],
    ['Forward P/E', nn(f.forwardPe,1)],
    ['P/B', nn(f.pb,1)],
    ['PEG', nn(f.peg,2)],
    ['P/S', nn(f.ps,1)],
    ['EPS', f.eps!=null ? nn(f.eps,2)+' '+cur : null],
    ['Direktavkastning', f.div!=null ? f.div.toFixed(2)+'%' : null],
    ['Utdelningsandel', pctv(f.payout)],
    ['Beta', nn(f.beta,2)],
    ['Börsvärde', money(f.mcap)],
    ['EV', money(f.ev)],
    ['EV/EBITDA', nn(f.evEbitda,1)],
    ['Omsättning', money(f.revenue)],
    ['Oms.tillväxt', pctv(f.revenueGrowth)],
    ['Bruttomarginal', pctv(f.grossMargin)],
    ['Rörelsemarginal', pctv(f.opMargin)],
    ['Vinstmarginal', pctv(f.profitMargin)],
    ['Avk. eget kap.', pctv(f.roe)],
    ['Kassa', money(f.cash)],
    ['Skuld', money(f.debt)],
    ['Skuld/EK', nn(f.debtToEquity,0)],
    ['Fritt kassaflöde', money(f.fcf)],
    ['Riktkurs (snitt)', f.targetMean!=null ? f.targetMean.toFixed(2)+' '+cur+(f.numAnalysts?` (${f.numAnalysts} analytiker)`:'') : null],
    ['Rekommendation', f.recommendation ? (REC_LABELS[f.recommendation]||f.recommendation) : null],
  ].filter(r => r[1] != null);
  if(!rows.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  el.innerHTML = rows.map(([l,v]) => `<div class="kpi-card" style="padding:11px 13px"><div class="kpi-label">${l}</div><div class="kpi-value" style="font-size:16px">${escHtml(v)}</div></div>`).join('');
}

async function loadStockQuote(ticker, name) {
  const local = stocks.find(s=>s.ticker===ticker);
  try {
    const data = await fetchYahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`);
    const q = data.chart.result[0];
    const meta = q.meta;
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose || meta.chartPreviousClose;
    const change = price - prev;
    const changePct = (change/prev)*100;
    const currency = meta.currency;
    // Live fundamenta för valfri ticker (fallback till lokala storbolagslistan).
    // ÅTD hämtas live via spark – den lokala listan täcker bara ett fåtal storbolag,
    // så bolag utanför den (t.ex. EQT) hade ingen ÅTD alls tidigare.
    const [fund, spark] = await Promise.all([
      fetchFundamentals(ticker),
      fetchSparkPrices([ticker]).catch(() => ({}))
    ]);
    const ytd = (spark[ticker] && spark[ticker].ytd != null) ? spark[ticker].ytd : (local ? local.ytd : null);
    // Nyckeltal: enbart live från Yahoo (inga hårdkodade reservvärden).
    const pe = fund?.pe != null ? fund.pe : null;
    const div = fund?.div != null ? fund.div : null;
    const sector = fund?.sector || local?.sektor || 'Aktie';
    const mcapStr = fund?.mcap != null ? fmtMcap(fund.mcap, fund.currency || currency) : null;
    const desc = fund?.description
      || `${name} är ett bolag noterat på ${meta.exchangeName || ticker}. Klicka "Analysera med AI" för en fullständig bolagsanalys.`;
    currentStockMeta = {
      kurs: price.toFixed(2) + ' ' + currency,
      ytd,
      pe, div, mcap: mcapStr, sektor: sector,
      flag: local ? local.flag : '',
      r: local ? local.r : '',
      desc, industry: fund?.industry || null, fund
    };
    renderFundamentals(fund, currency);
    renderInsider(ticker, meta.longName || name, fund); // fyller på i bakgrunden, blockerar inte sidan
    refreshStockAIContext(ticker, name); // ge chatten full data (nyckeltal + kurs + nyheter)
    document.getElementById('d-name').textContent = name;
    document.getElementById('d-fullname').textContent = meta.longName || meta.shortName || '';
    document.getElementById('d-exchange').textContent = meta.exchangeName || ticker;
    document.getElementById('d-sector-tag').textContent = sector;
    document.getElementById('d-price').textContent = price.toLocaleString('sv-SE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ' + currency;
    const chEl = document.getElementById('d-change');
    chEl.textContent = `${change>=0?'+':''}${change.toFixed(2)} (${changePct>=0?'+':''}${changePct.toFixed(2)}%) idag`;
    chEl.className = 'detail-change ' + (change>=0?'green':'red');
    const yr52hi = meta['52WeekHigh'] || meta.fiftyTwoWeekHigh;
    const yr52lo = meta['52WeekLow'] || meta.fiftyTwoWeekLow;
    document.getElementById('d-meta').innerHTML = [
      `<span class="live-badge" style="margin-left:0"><span class="live-dot"></span>Live · uppdateras var 30:e sek</span>`,
      `<span class="meta-pill">Volym: ${(meta.regularMarketVolume||0).toLocaleString('sv-SE')}</span>`,
      yr52hi?`<span class="meta-pill">52v Hög: ${yr52hi.toFixed(2)}</span>`:'',
      yr52lo?`<span class="meta-pill">52v Låg: ${yr52lo.toFixed(2)}</span>`:'',
      `<span class="update-stamp">Uppdaterad ${new Date().toLocaleTimeString('sv-SE')}</span>`,
    ].join('');
    const kpis = [
      {l:'Senaste kurs',v: price.toFixed(2)+' '+currency},
      // Både belopp och procent – enbart ett tal utan enhet gick inte att tolka.
      {l:'Dagens förändring',v: `${change>=0?'+':''}${change.toFixed(2)} ${currency} (${changePct>=0?'+':''}${changePct.toFixed(2)}%)`, cls: change>=0?'green':'red'},
      {l:'ÅTD (i år)', v: ytd!=null?(ytd>=0?'+':'')+ytd.toFixed(1)+'%':'–', cls: ytd!=null&&ytd>=0?'green':'red'},
      {l:'P/E-tal', v: pe!=null?pe.toFixed(1):'–'},
      {l:'Direktavkastning', v: div!=null?div.toFixed(2)+'%':'–'},
      {l:'Marknadsv.', v: mcapStr||'–'},
      {l:'Sektor', v: sector||'–'},
      {l:'Marknad', v: meta.exchangeName||ticker},
    ];
    document.getElementById('d-kpis').innerHTML = kpis.map(k=>`<div class="kpi-mini"><div class="kpi-mini-label">${k.l}</div><div class="kpi-mini-val ${k.cls||''}">${k.v}</div></div>`).join('');
    document.getElementById('d-facts').innerHTML = [
      `Ticker: <span style="color:var(--text);font-family:var(--mono)">${ticker}</span>`,
      `Valuta: <span style="color:var(--text)">${currency}</span>`,
      `Marknad: <span style="color:var(--text)">${meta.exchangeName||'–'}</span>`,
      fund?.industry?`Bransch: <span style="color:var(--text)">${escHtml(fund.industry)}</span>`:'',
      pe!=null?`P/E: <span style="color:var(--text)">${pe.toFixed(1)}</span>`:'',
      div!=null?`Direktavkastning: <span style="color:var(--text)">${div.toFixed(2)}%</span>`:'',
    ].filter(Boolean).map(l=>`<div>${l}</div>`).join('');
    renderDescription(ticker, desc);
  } catch(e) {
    loadStockFallback(ticker, name);
  }
}

function loadStockFallback(ticker, name) {
  const local = stocks.find(s=>s.ticker===ticker);
  if(!local) return;
  document.getElementById('d-name').textContent = name;
  document.getElementById('d-fullname').textContent = ticker;
  document.getElementById('d-exchange').textContent = ticker;
  document.getElementById('d-sector-tag').textContent = local.sektor;
  document.getElementById('d-price').textContent = local.kurs;
  document.getElementById('d-change').textContent = `${local.ytd>=0?'+':''}${local.ytd.toFixed(1)}% ÅTD`;
  document.getElementById('d-change').className = 'detail-change ' + (local.ytd>=0?'green':'red');
  document.getElementById('d-meta').innerHTML = `<span class="meta-pill">Data från lokal databas</span>`;
  const kpis = [
    {l:'Kurs',v:local.kurs},{l:'ÅTD 2026',v:(local.ytd>=0?'+':'')+local.ytd.toFixed(1)+'%',cls:local.ytd>=0?'green':'red'},
    {l:'P/E',v:local.pe?local.pe.toFixed(1):'–'},{l:'Direktavkastning',v:local.div?local.div.toFixed(1)+'%':'–'},
    {l:'Mkt cap',v:local.mcap>=1000?(local.mcap/1000).toFixed(1)+'T USD':'$'+local.mcap+'B'},{l:'Sektor',v:local.sektor},
    {l:'Region',v:local.r.toUpperCase()},{l:'Marknad',v:ticker.split('.')[1]||'NASDAQ'},
  ];
  document.getElementById('d-kpis').innerHTML = kpis.map(k=>`<div class="kpi-mini"><div class="kpi-mini-label">${k.l}</div><div class="kpi-mini-val ${k.cls||''}">${k.v}</div></div>`).join('');
  document.getElementById('d-facts').innerHTML = `<div>Ticker: <span style="color:var(--text);font-family:var(--mono)">${ticker}</span></div><div>Sektor: <span style="color:var(--text)">${local.sektor}</span></div>`;
  document.getElementById('d-description').textContent = `Klicka "Analysera med AI" för en fullständig bolagsanalys av ${name}.`;
  document.getElementById('detail-loading').style.display = 'none';
  document.getElementById('detail-content').style.display = 'block';
}

let chartMode = 'price';   // 'price' | 'pct'
let compareSyms = [];      // [{sym, name}]
const COMPARE_COLORS = ['#4f8ef7', '#f59e0b', '#a78bfa', '#06b6d4', '#ec4899', '#84cc16'];

async function fetchChartSeries(sym, range, interval) {
  try {
    const data = await fetchYahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`);
    const r = data.chart.result[0];
    return { ts: r.timestamp || [], closes: (r.indicators.quote[0].close || []), off: (r.meta && r.meta.gmtoffset) || 0, cur: (r.meta && r.meta.currency) || '' };
  } catch(e) { return null; }
}

// Ritar en kurs-/utvecklingsgraf med valfria jämförelseserier. Delas av aktiesidan
// och bevakningslistan – tidsaxel-inriktningen nedan (keyOf/alignRebase) är klurig
// nog att bara få finnas på ett ställe. Returnerar Chart-instansen, eller null om
// primärserien saknas (då lämnas `prev` orörd).
async function drawSeriesChart({ canvasId, sym, name, compare = [], range, interval, mode = 'price', prev = null }) {
  const intraday = /[mh]$/.test(interval);
  try {
    const primary = await fetchChartSeries(sym, range, interval);
    if(!primary || !primary.ts.length) return null;
    const comp = [];
    for(const c of compare) {
      const s = await fetchChartSeries(c.sym, range, interval);
      if(s && s.ts.length) comp.push({ ...c, ...s });
    }
    const hasCompare = comp.length > 0;
    const pct = mode === 'pct' || hasCompare; // jämförelse kräver %

    const ts = primary.ts;
    const labels = ts.map(t=>{
      const d = new Date(t*1000);
      return intraday
        ? d.toLocaleString('sv-SE',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
        : d.toLocaleDateString('sv-SE',{year:'numeric',month:'short',day:'numeric'});
    });

    // Rikta in en serie mot primärens tidsaxel; rebasera till % om pct-läge.
    // Nyckel per DATUM för dags-/vecko-/månadsdata (så olika börser aligner trots
    // olika stängningstider); exakt tidsstämpel bara för intradag. Datumet räknas i
    // varje börs LOKALA tid (via gmtoffset) – annars hamnar t.ex. Stockholms
    // veckostaplar (midnatt lokal tid = föregående dag i UTC) på fel datum och
    // matchar aldrig en nordamerikansk primäraxel (så OMXS30-linjen blev osynlig).
    const keyOf = intraday ? ((t,off) => t) : ((t,off) => new Date((t + (off||0))*1000).toISOString().slice(0,10));
    const primKeys = ts.map(t => keyOf(t, primary.off));
    const alignRebase = (series) => {
      const m = new Map();
      series.ts.forEach((t,i) => { if(series.closes[i] != null) m.set(keyOf(t, series.off), series.closes[i]); });
      const vals = primKeys.map(k => m.has(k) ? m.get(k) : null);
      if(!pct) return vals.map(v => v != null ? +v.toFixed(2) : null);
      const base = vals.find(v => v != null);
      return vals.map(v => (v != null && base) ? +(((v - base) / base) * 100).toFixed(2) : null);
    };

    const primVals = alignRebase(primary);
    const pf = primVals.find(v => v != null), pl = [...primVals].reverse().find(v => v != null);
    const primColor = (pl >= pf) ? '#22c55e' : '#ef4444';
    const datasets = [{
      label: name || sym, data: primVals,
      borderColor: primColor, backgroundColor: hasCompare ? 'transparent' : primColor + '18',
      fill: !hasCompare, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, spanGaps: true
    }];
    comp.forEach((c, i) => {
      const col = COMPARE_COLORS[i % COMPARE_COLORS.length];
      datasets.push({
        label: c.name || c.sym, data: alignRebase(c),
        borderColor: col, backgroundColor: 'transparent', fill: false,
        borderWidth: 1.6, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, spanGaps: true
      });
    });

    if(prev) prev.destroy();
    return new Chart(document.getElementById(canvasId).getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: datasets.length > 1, labels: { color: '#8b91a8', font: { size: 11 }, boxWidth: 12 } },
          tooltip: { mode: 'index', intersect: false,
            callbacks: pct ? { label: (c) => `${c.dataset.label}: ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y}%` } : {} }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 10 }, maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 10 }, callback: pct ? (v => (v >= 0 ? '+' : '') + v + '%') : undefined } }
        } }
    });
  } catch(e) { return null; }
}

async function loadPriceChart(ticker, period) {
  const rangeMap = {'1w':'5d','1mo':'1mo','3mo':'3mo','6mo':'6mo','1y':'1y','2y':'2y','5y':'5y'};
  const intervalMap = {'1w':'60m','1mo':'1d','3mo':'1d','6mo':'1wk','1y':'1wk','2y':'1wk','5y':'1mo'};
  const chart = await drawSeriesChart({
    canvasId: 'priceChart', sym: ticker, name: currentStockName || ticker,
    compare: compareSyms, range: rangeMap[period], interval: intervalMap[period],
    mode: chartMode, prev: currentPriceChart
  });
  if(chart) currentPriceChart = chart;
  updateCompareChips();
}

function reloadChart() {
  if(currentIsFund && currentFundId) loadFundChart(currentFundId, avanzaPeriodMap[currentPeriod] || 'three_months');
  else if(currentTicker) loadPriceChart(currentTicker, currentPeriod);
}
function setChartMode(m) {
  chartMode = m;
  document.getElementById('mode-price').classList.toggle('on', m === 'price');
  document.getElementById('mode-pct').classList.toggle('on', m === 'pct');
  reloadChart();
}
function addCompare(sym, name) {
  sym = sym.trim();
  if(!sym || sym === currentTicker || compareSyms.find(c => c.sym === sym)) return;
  if(compareSyms.length >= 5) return;
  compareSyms.push({ sym, name: name || sym });
  reloadChart();
}
// Slår upp namn/ticker → riktig Yahoo-symbol (samma endpoint som sökrutan).
async function resolveSymbol(q) {
  try {
    const j = await fetchYahoo(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`);
    const quotes = (j.quotes || []).filter(r => r.symbol && ['EQUITY','ETF','INDEX','MUTUALFUND'].includes(r.quoteType));
    if(quotes.length) { const r = quotes[0]; return { sym: r.symbol, name: r.shortname || r.longname || r.symbol }; }
  } catch(e) {}
  return null;
}
async function addCompareInput() {
  const el = document.getElementById('compare-input');
  const v = (el.value || '').trim();
  if(!v) return;
  el.value = '';
  el.placeholder = 'söker…';
  const r = await resolveSymbol(v);
  el.placeholder = '+ ticker/fond';
  if(r) addCompare(r.sym, r.name);
  else addCompare(v.toUpperCase(), v.toUpperCase()); // fallback: prova som ticker
}
function removeCompare(sym) {
  compareSyms = compareSyms.filter(c => c.sym !== sym);
  reloadChart();
}
function updateCompareChips() {
  const el = document.getElementById('compare-chips');
  if(!el) return;
  el.innerHTML = compareSyms.map(c =>
    `<span class="ticker-chip" style="cursor:default">${escHtml(c.name)} <span onclick="removeCompare('${escQuote(c.sym)}')" style="cursor:pointer;color:var(--text3)">×</span></span>`
  ).join('');
}

async function setPeriod(el, period) {
  document.querySelectorAll('#section-detail .filter-chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  currentPeriod = period;
  if(currentIsFund && currentFundId) {
    await loadFundChart(currentFundId, avanzaPeriodMap[period] || 'three_months');
  } else if(currentTicker) {
    await loadPriceChart(currentTicker, period);
  }
}

// Nyckeltal som text (från currentStockMeta) – delas av AI-analys och chatt-kontext.
function stockFundamentalsText() {
  const m = currentStockMeta || {}, f = m.fund || {}, cur = f.currency || '';
  const p = [];
  if(m.sektor) p.push(`sektor ${m.sektor}`);
  if(m.industry) p.push(`bransch ${m.industry}`);
  if(f.pe != null) p.push(`P/E ${f.pe.toFixed(1)}`);
  if(f.forwardPe != null) p.push(`forward P/E ${f.forwardPe.toFixed(1)}`);
  if(f.pb != null) p.push(`P/B ${f.pb.toFixed(1)}`);
  if(f.ps != null) p.push(`P/S ${f.ps.toFixed(1)}`);
  if(f.eps != null) p.push(`EPS ${f.eps.toFixed(2)} ${cur}`);
  if(m.div != null) p.push(`direktavkastning ${m.div.toFixed(2)}%`);
  if(m.mcap) p.push(`börsvärde ${m.mcap}`);
  if(f.revenue != null) p.push(`omsättning ${fmtMcap(f.revenue, cur)}`);
  if(f.revenueGrowth != null) p.push(`oms.tillväxt ${f.revenueGrowth.toFixed(1)}%`);
  if(f.profitMargin != null) p.push(`vinstmarginal ${f.profitMargin.toFixed(1)}%`);
  if(f.grossMargin != null) p.push(`bruttomarginal ${f.grossMargin.toFixed(1)}%`);
  if(f.roe != null) p.push(`avk. eget kapital ${f.roe.toFixed(1)}%`);
  if(f.cash != null) p.push(`kassa ${fmtMcap(f.cash, cur)}`);
  if(f.debt != null) p.push(`skuld ${fmtMcap(f.debt, cur)}`);
  if(f.fcf != null) p.push(`fritt kassaflöde ${fmtMcap(f.fcf, cur)}`);
  if(f.targetMean != null) p.push(`analytikers riktkurs ${f.targetMean.toFixed(2)} ${cur}${f.numAnalysts?` (${f.numAnalysts} analytiker)`:''}`);
  if(f.recommendation) p.push(`rekommendation ${REC_LABELS[f.recommendation]||f.recommendation}`);
  return p.join(', ');
}

// Bygger en rik kontext (nyckeltal + kursutveckling + nyheter) för CHATTEN,
// så även fritextfrågor om aktien har tillgång till datan.
let aiStockDetail = '';
async function refreshStockAIContext(ticker, name) {
  const ft = stockFundamentalsText();
  const desc = (currentStockMeta && currentStockMeta.desc) ? ` Bolagsbeskrivning: ${currentStockMeta.desc}` : '';
  const [perf, news] = await Promise.all([buildPerfContext(ticker), buildNewsContext(ticker)]);
  if(currentTicker !== ticker) return; // användaren bytte aktie under tiden
  aiStockDetail = `Data för ${name} (${ticker}): ${ft ? ft + '.' : ''}${perf}${news}${desc}`;
}

// Kursutveckling över perioder + 52v-intervall (så AI:n ser rörelser).
async function buildPerfContext(ticker) {
  try {
    const data = await fetchYahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`);
    const r = data.chart.result[0];
    const ts = r.timestamp || [], closes = (r.indicators.quote[0].close || []);
    const valid = closes.filter(v => v != null);
    if(!valid.length) return '';
    const price = r.meta.regularMarketPrice != null ? r.meta.regularMarketPrice : valid[valid.length-1];
    const cur = r.meta.currency || '';
    const closeSince = (secAgo) => { const target = Date.now()/1000 - secAgo; for(let i=0;i<ts.length;i++){ if(ts[i] >= target && closes[i] != null) return closes[i]; } return null; };
    const chg = (past) => past ? ((price - past)/past*100) : null;
    const parts = [];
    const add = (lbl, days) => { const c = chg(closeSince(days*86400)); if(c != null) parts.push(`${lbl} ${c>=0?'+':''}${c.toFixed(1)}%`); };
    add('1 vecka',7); add('1 mån',30); add('3 mån',91); add('6 mån',182); add('1 år',365); add('2 år',730);
    const yStart = new Date(new Date().getFullYear(),0,1).getTime()/1000;
    let ytdClose = null; for(let i=0;i<ts.length;i++){ if(ts[i] >= yStart && closes[i] != null){ ytdClose = closes[i]; break; } }
    const ytd = chg(ytdClose); if(ytd != null) parts.push(`i år ${ytd>=0?'+':''}${ytd.toFixed(1)}%`);
    const hi = r.meta.fiftyTwoWeekHigh, lo = r.meta.fiftyTwoWeekLow;
    const range = (hi && lo) ? ` 52-veckorsintervall ${lo.toFixed(2)}–${hi.toFixed(2)} ${cur}, aktuell kurs ${price.toFixed(2)} ${cur}.` : '';
    return parts.length ? ` Kursutveckling: ${parts.join(', ')}.${range}` : range;
  } catch(e) { return ''; }
}
// Senaste nyhetsrubriker för tickern (från Yahoo).
async function buildNewsContext(ticker) {
  try {
    const j = await fetchYahoo(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=0&newsCount=3`);
    const news = (j.news || []).slice(0,3).map(n => {
      const d = n.providerPublishTime ? ' (' + new Date(n.providerPublishTime*1000).toISOString().slice(0,10) + ')' : '';
      return `- ${n.title}${d}`;
    });
    return news.length ? ` Senaste nyheter (Yahoo):\n${news.join('\n')}` : '';
  } catch(e) { return ''; }
}

async function aiAnalyzeStock() {
  openAI();
  if(currentIsFund) {
    const m = currentStockMeta;
    const ctx = `Det är en svensk fond. Avgift: ${m.fee!=null?m.fee+'%':'okänd'}, risknivå: ${m.risk!=null?m.risk+'/7':'okänd'}, utveckling i år: ${m.ytd!=null?m.ytd.toFixed(1)+'%':'okänd'}, 1 år: ${m.dev1y!=null?m.dev1y.toFixed(1)+'%':'okänd'}.`;
    stageAnalysis(`Analysera fonden ${currentStockName}. ${ctx} Beskriv fondens inriktning, risk, avgift, historisk utveckling och vilken typ av sparare den passar. Avsluta med en sammanfattande bedömning.`, 'Fondanalys: ' + currentStockName);
    return;
  }
  const m = currentStockMeta || {};
  const ft = stockFundamentalsText();
  const ctx = ft ? `Aktuella nyckeltal (live från Yahoo): ${ft}.` : '';
  const desc = m.desc ? ` Bolagsbeskrivning: ${m.desc}` : '';
  const [perf, news] = await Promise.all([buildPerfContext(currentTicker), buildNewsContext(currentTicker)]);
  stageAnalysis(`Gör en djupgående analys av ${currentStockName} (${currentTicker}). ${ctx}${desc}${perf}${news} Inkludera: affärsmodell, styrkor, risker, värdering och en sammanfattande rekommendation. Om frågan gäller en specifik kursrörelse, använd kursutvecklingen och nyheterna ovan för att förklara den. Om du fortfarande saknar tillförlitlig information, säg det tydligt istället för att gissa.`, 'Aktieanalys: ' + currentStockName);
}
