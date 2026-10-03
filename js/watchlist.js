// conny-stocks · Bevakningslistan.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ WATCHLIST ══════════
// Bevakningslistan sparas i webbläsaren (localStorage) och synkas till molnet när man är inloggad.
const DEFAULT_WATCHLIST = [
  { id:'AAPL', name:'Apple Inc', label:'AAPL · NASDAQ', isFund:false },
  { id:'NVDA', name:'NVIDIA', label:'NVDA · NASDAQ', isFund:false },
  { id:'VOLV-B.ST', name:'Volvo B', label:'VOLV-B · OMX', isFund:false },
  { id:'ERIC-B.ST', name:'Ericsson B', label:'ERIC-B · OMX', isFund:false },
  { id:'ABB.ST', name:'ABB', label:'ABB · OMX', isFund:false },
  { id:'NOVO-B.CO', name:'Novo Nordisk B', label:'NOVO-B · CPH', isFund:false },
  { id:'ASML.AS', name:'ASML', label:'ASML · AMS', isFund:false },
];

function getWatchlist() {
  try { const s = localStorage.getItem('watchlist'); if(s) return JSON.parse(s); } catch(e){}
  return DEFAULT_WATCHLIST.slice();
}
function saveWatchlist(list) {
  try { localStorage.setItem('watchlist', JSON.stringify(list)); } catch(e){}
}

// ── Tabellen: portföljens periodväljare (PF_PERIODS) + aktiescreenerns kolumnuppsättning ──
let wlPeriod = '1d';
let wlSelected = null;                 // markerad rad → grafen nedanför tabellen
let wlInfo = {}, wlSeries = {};        // fundamenta resp. 5-årsserier per ticker
let wlLoading = false, wlChart = null;
const wlPeriodLabel = () => (PF_PERIODS.find(p => p[0] === wlPeriod) || PF_PERIODS[0])[1];
function setWlPeriod(p){ wlPeriod = p; paintWatchlist(); if(wlSelected) drawWatchlistChart(); }

const wlTdNum = v => `<td style="text-align:right" class="td-mono">${v}</td>`;
const wlTdPct = v => `<td style="text-align:right;color:${v==null?'var(--text3)':(v>=0?'var(--green)':'var(--red)')}" class="td-mono">${v!=null?(v>=0?'+':'')+v.toFixed(1)+'%':'–'}</td>`;
const wlTdText = v => `<td style="color:var(--text2);font-size:12px">${escHtml(v||'–')}</td>`;

const WL_COL_DEFS = {
  marknad: { label:'Marknad', align:'left', val:r=>r.marknad||'', cell:r=>wlTdText(r.marknad) },
  valuta:  { label:'Valuta', align:'left', val:r=>r.valuta||'', cell:r=>wlTdText(r.valuta) },
  sektor:  { label:'Sektor', align:'left', val:r=>r.sektor||'', cell:r=>wlTdText(r.sektor) },
  kurs:    { label:'Kurs', val:r=>r.price, cell:r=>wlTdNum(r.price!=null?fmtSekNum(r.price,2):'–') },
  change:  { label:()=>wlPeriodLabel(), val:r=>r.ret, cell:r=>wlTdPct(r.ret) },
  ytd:     { label:'ÅTD %', val:r=>r.ytd, cell:r=>wlTdPct(r.ytd) },
  dag:     { label:'Dag %', val:r=>r.dag, cell:r=>wlTdPct(r.dag) },
  ar52:    { label:'52v %', val:r=>r.ar52, cell:r=>wlTdPct(r.ar52) },
  hi52:    { label:'52v hög', val:r=>r.hi52, cell:r=>wlTdNum(r.hi52!=null?fmtSekNum(r.hi52,2):'–') },
  lo52:    { label:'52v låg', val:r=>r.lo52, cell:r=>wlTdNum(r.lo52!=null?fmtSekNum(r.lo52,2):'–') },
  pe:      { label:'P/E', val:r=>r.pe, cell:r=>wlTdNum(r.pe!=null?r.pe.toFixed(1):'–') },
  fpe:     { label:'Fwd P/E', val:r=>r.fpe, cell:r=>wlTdNum(r.fpe!=null?r.fpe.toFixed(1):'–') },
  pb:      { label:'P/B', val:r=>r.pb, cell:r=>wlTdNum(r.pb!=null?r.pb.toFixed(1):'–') },
  eps:     { label:'EPS', val:r=>r.eps, cell:r=>wlTdNum(r.eps!=null?r.eps.toFixed(2):'–') },
  fwdeps:  { label:'Fwd EPS', val:r=>r.fwdeps, cell:r=>wlTdNum(r.fwdeps!=null?r.fwdeps.toFixed(2):'–') },
  div:     { label:'Utd.%', val:r=>r.divy, cell:r=>wlTdNum(r.divy>0?r.divy.toFixed(1)+'%':'–') },
  mcap:    { label:'Mkt cap', val:r=>r.mcap, cell:r=>wlTdNum(r.mcap!=null?(r.mcap>=1000?(r.mcap/1000).toFixed(1)+'T':r.mcap+'B'):'–') },
  volym:   { label:'Volym', val:r=>r.volym, cell:r=>wlTdNum(r.volym!=null?fmtVol(r.volym):'–') },
  avgvol:  { label:'Snittvol.', val:r=>r.avgvol, cell:r=>wlTdNum(r.avgvol!=null?fmtVol(r.avgvol):'–') },
  rating:  { label:'Analytiker', align:'left', val:r=>r.rec?r.rec.buy:null, cell:r=>{ if(!r.rec) return wlTdText(null); const t=r.rec.buy+r.rec.hold+r.rec.sell;
    return `<td style="font-size:12px;white-space:nowrap"><span style="color:var(--green)">${r.rec.buy} köp</span> · ${r.rec.hold} håll · <span style="color:var(--red)">${r.rec.sell} sälj</span><div style="font-size:10px;color:var(--text3)">${t} analytiker</div></td>`; } },
  // Sorteras på nettot (köp − sälj): flest nettoköp överst.
  insyn:   { label:'Insyn 12 mån', align:'left', val:r=>r.insyn?(r.insyn.kop - r.insyn.salj):null, cell:r=>{
    const i = r.insyn;
    if(!i) return `<td style="color:var(--text3);font-size:12px">${r.insynVantar ? '…' : '–'}</td>`;
    return `<td style="font-size:12px;white-space:nowrap"><span style="color:var(--green)">${i.kop} köp</span> · <span style="color:var(--red)">${i.salj} sälj</span>${i.ovrigt?` <span style="color:var(--text3)">· ${i.ovrigt} övr</span>`:''}${i.senast?`<div style="font-size:10px;color:var(--text3)">senast ${escHtml(i.senast)}</div>`:''}</td>`; } },
};
const WL_COL_ORDER = ['marknad','valuta','sektor','kurs','change','ytd','dag','ar52','hi52','lo52','pe','fpe','pb','eps','fwdeps','div','mcap','volym','avgvol','rating','insyn'];
const WL_DEFAULT_COLS = ['kurs','change','ytd','pe','div','mcap','insyn'];
const wlColLabel = k => { const l = WL_COL_DEFS[k].label; return typeof l === 'function' ? l() : l; };
function getWlCols(){
  try {
    const s = JSON.parse(localStorage.getItem('wlCols'));
    if(Array.isArray(s) && s.length){
      // Engångspåfyllning: insynskolumnen är ny. Den som redan sparat ett kolumnval
      // hade annars aldrig sett den utan att leta i ⚙-menyn.
      if(!localStorage.getItem('wlColsInsyn')){
        localStorage.setItem('wlColsInsyn', '1');
        if(!s.includes('insyn')){ s.push('insyn'); localStorage.setItem('wlCols', JSON.stringify(s)); }
      }
      return WL_COL_ORDER.filter(k => s.includes(k));
    }
  } catch(e){}
  return WL_DEFAULT_COLS.slice();
}
let wlVisibleCols = getWlCols();
function saveWlCols(){ try { localStorage.setItem('wlCols', JSON.stringify(wlVisibleCols)); } catch(e){} }
function toggleWlColMenu(){ const m = document.getElementById('wl-col-menu'); const show = m.style.display === 'none'; m.style.display = show ? 'block' : 'none'; if(show) renderWlColMenu(); }
function renderWlColMenu(){ document.getElementById('wl-col-menu').innerHTML = WL_COL_ORDER.map(k =>
  `<label><input type="checkbox" ${wlVisibleCols.includes(k)?'checked':''} onchange="toggleWlCol('${k}')"> ${escHtml(wlColLabel(k))}</label>`).join(''); }
function toggleWlCol(k){
  if(wlVisibleCols.includes(k)){ if(wlVisibleCols.length <= 1) return; wlVisibleCols = wlVisibleCols.filter(x => x !== k); }
  else wlVisibleCols = WL_COL_ORDER.filter(x => wlVisibleCols.includes(x) || x === k);
  saveWlCols(); paintWatchlist(); renderWlColMenu();
  if(k === 'insyn') loadWatchlistInsyn(); // hämtas först när kolumnen slås på
}

// Slår ihop bevakat papper + live-kurs + fundamenta + periodavkastning till en tabellrad.
function wlRow(w){
  const lp = livePrices[w.id] || {}, inf = wlInfo[w.id] || {};
  const ser = wlSeries[w.id];
  const dag = lp.day != null ? lp.day : inf.dag;
  // 1 dag kommer från kursanropet, längre perioder ur 5-årsserien (som i portföljen).
  const ret = w.isFund ? null : (wlPeriod === '1d' ? dag : (ser ? pfReturn(ser, wlPeriod) : null));
  // Insyn: US-bolag kommer med i /api/quote-svaret, svenska hämtas separat från FI.
  const svensk = !w.isFund && /\.ST$/i.test(w.id);
  return { id:w.id, name:w.name, label:w.label||w.id, isFund:!!w.isFund, ret, dag,
    insyn: inf.insyn || wlInsynSe[w.id] || null,
    insynVantar: svensk && !(w.id in wlInsynSe),
    price: lp.price != null ? lp.price : inf.price,
    ytd: lp.ytd != null ? lp.ytd : null,
    valuta: inf.valuta || lp.currency || null,
    ar52:inf.ar52, hi52:inf.hi52, lo52:inf.lo52, pe:inf.pe, fpe:inf.fpe, pb:inf.pb,
    eps:inf.eps, fwdeps:inf.fwdeps, divy:inf.divy, mcap:inf.mcap, volym:inf.volym,
    avgvol:inf.avgvol, marknad:inf.marknad, sektor:inf.sektor, rec:inf.rec };
}

// col:null = listans egen ordning (som den sparats). Klick på en rubrik sorterar.
let wlSort = { col:null, dir:'desc' };
function sortWatchlist(col){
  if(wlSort.col === col) wlSort.dir = wlSort.dir === 'asc' ? 'desc' : 'asc';
  else wlSort = { col, dir: col === 'name' ? 'asc' : 'desc' };
  paintWatchlist();
}

function paintWatchlist(){
  const el = document.getElementById('watchlist-items');
  if(!el) return;
  const list = getWatchlist();
  if(!list.length){
    el.innerHTML = '<div class="muted" style="padding:16px;font-size:13px">Inga bevakade papper ännu. Öppna en aktie eller fond och klicka <b>+ Bevakningslista</b>.</div>';
    const card = document.getElementById('wl-chart-card'); if(card) card.style.display = 'none';
    return;
  }
  const chips = PF_PERIODS.map(([p,lbl]) =>
    `<div class="filter-chip${p===wlPeriod?' on':''}" onclick="setWlPeriod('${p}')">${lbl}</div>`).join('');
  const sortStyle = 'cursor:pointer;user-select:none';
  const arrow = c => wlSort.col === c ? (wlSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const head = wlVisibleCols.map(k =>
    `<th style="text-align:${WL_COL_DEFS[k].align||'right'};${sortStyle}" onclick="sortWatchlist('${k}')">${escHtml(wlColLabel(k))}${arrow(k)}</th>`).join('');
  // Tomma värden hamnar sist oavsett riktning – annars fyller "–" toppen.
  let rows = list.map(wlRow);
  if(wlSort.col){
    const dir = wlSort.dir === 'asc' ? 1 : -1;
    const getk = wlSort.col === 'name' ? (r => r.name.toLowerCase()) : WL_COL_DEFS[wlSort.col].val;
    rows = rows.slice().sort((a,b) => {
      const va = getk(a), vb = getk(b);
      if(va == null && vb == null) return 0;
      if(va == null) return 1; if(vb == null) return -1;
      if(typeof va === 'string' && typeof vb === 'string') return va < vb ? -dir : va > vb ? dir : 0;
      return (va - vb) * dir;
    });
  }
  const body = rows.map(r => {
    const open = r.isFund ? `loadFund('${escQuote(r.id)}','${escQuote(r.name)}')` : `loadStock('${escQuote(r.id)}','${escQuote(r.name)}')`;
    return `<tr class="wl-row${r.id===wlSelected?' sel':''}" data-id="${escHtml(r.id)}" onclick="selectWlRow('${escQuote(r.id)}')">
      <td><div class="wl-name">${escHtml(r.name)}</div><div class="wl-ticker">${escHtml(r.label)}</div></td>
      ${wlVisibleCols.map(k => WL_COL_DEFS[k].cell(r)).join('')}
      <td style="text-align:right;white-space:nowrap">
        <button class="wl-open" title="Öppna sidan" onclick="event.stopPropagation();${open}">↗</button>
        <button class="wl-remove" title="Ta bort från bevakning" onclick="event.stopPropagation();removeFromWatchlist('${escQuote(r.id)}')">×</button>
      </td></tr>`;
  }).join('');
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div class="filter-row" style="margin:0;align-items:center"><span style="font-size:12px;color:var(--text3)">Utveckling:</span>${chips}</div>
      <div style="position:relative">
        <button class="filter-input" onclick="toggleWlColMenu()" style="width:auto;cursor:pointer">⚙ Kolumner</button>
        <div id="wl-col-menu" class="col-menu" style="display:none;left:auto;right:0"></div>
      </div>
    </div>
    <div style="overflow-x:auto"><table class="wl-table">
      <thead><tr><th style="${sortStyle}" onclick="sortWatchlist('name')">Namn${arrow('name')}</th>${head}<th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

// Klick på en rad markerar den och ritar grafen; klick igen avmarkerar.
function selectWlRow(id){
  wlSelected = wlSelected === id ? null : id;
  paintWatchlist();
  if(wlSelected) drawWatchlistChart();
  else { const c = document.getElementById('wl-chart-card'); if(c) c.style.display = 'none'; }
}

// Grafens upplösning per period – 1 dag blir intradag, långa spann veckovis.
const WL_CHART_RANGE = { '1d':['1d','5m'], '1w':['5d','30m'], '1mo':['1mo','1d'], 'ytd':['ytd','1d'], '1y':['1y','1d'], '2y':['2y','1wk'], '5y':['5y','1wk'] };

// Jämförelseserier i bevakningsgrafen – samma mönster som aktiesidans.
let wlChartMode = 'price';
let wlCompare = [];
function setWlChartMode(m){
  wlChartMode = m;
  document.getElementById('wl-mode-price').classList.toggle('on', m === 'price');
  document.getElementById('wl-mode-pct').classList.toggle('on', m === 'pct');
  if(wlSelected) drawWatchlistChart();
}
function addWlCompare(sym, name){
  sym = (sym || '').trim();
  if(!sym || sym === wlSelected || wlCompare.find(c => c.sym === sym)) return;
  if(wlCompare.length >= 5) return;
  wlCompare.push({ sym, name: name || sym });
  if(wlSelected) drawWatchlistChart(); else updateWlCompareChips();
}
async function addWlCompareInput(){
  const el = document.getElementById('wl-compare-input');
  const v = (el.value || '').trim();
  if(!v) return;
  el.value = ''; el.placeholder = 'söker…';
  const r = await resolveSymbol(v);
  el.placeholder = '+ ticker/fond';
  if(r) addWlCompare(r.sym, r.name);
  else addWlCompare(v.toUpperCase(), v.toUpperCase()); // fallback: prova som ticker
}
function removeWlCompare(sym){
  wlCompare = wlCompare.filter(c => c.sym !== sym);
  if(wlSelected) drawWatchlistChart(); else updateWlCompareChips();
}
function updateWlCompareChips(){
  const el = document.getElementById('wl-compare-chips');
  if(!el) return;
  el.innerHTML = wlCompare.map(c =>
    `<span class="ticker-chip" style="cursor:default">${escHtml(c.name)} <span onclick="removeWlCompare('${escQuote(c.sym)}')" style="cursor:pointer;color:var(--text3)">×</span></span>`).join('');
}

async function drawWatchlistChart(){
  const card = document.getElementById('wl-chart-card');
  const item = getWatchlist().find(w => w.id === wlSelected);
  if(!card || !item) return;
  card.style.display = '';
  document.getElementById('wl-chart-title').textContent = `${item.name} · ${wlPeriodLabel()}`;
  updateWlCompareChips();
  const msg = document.getElementById('wl-chart-msg'), wrap = document.getElementById('wl-chart-wrap');
  const fail = t => { msg.textContent = t; msg.style.display = ''; wrap.style.display = 'none'; if(wlChart){ wlChart.destroy(); wlChart = null; } };
  if(item.isFund) return fail('Fonder saknar kursserie hos Yahoo – öppna fondens egen sida för utvecklingen.');
  // Canvasen måste vara synlig INNAN Chart.js mäter den, annars ritas grafen
  // med noll höjd efter ett tidigare felmeddelande.
  msg.style.display = 'none'; wrap.style.display = '';
  const [range, interval] = WL_CHART_RANGE[wlPeriod] || ['1y','1d'];
  const chart = await drawSeriesChart({
    canvasId: 'wlChart', sym: item.id, name: item.name, compare: wlCompare,
    range, interval, mode: wlChartMode, prev: wlChart
  });
  if(!chart) return fail('Ingen kursdata för den här perioden.');
  wlChart = chart;
}

// Insynshandel för svensknoterade papper via Finansinspektionen. US-bolagen har
// redan sin insyn med i /api/quote-svaret, så bara .ST-tickers kostar ett anrop –
// och bara om kolumnen faktiskt visas. Delar cache med aktiesidans insynskort.
let wlInsynSe = {};
async function loadWatchlistInsyn(){
  if(!wlVisibleCols.includes('insyn')) return;
  const kvar = getWatchlist().filter(w => !w.isFund && /\.ST$/i.test(w.id) && !(w.id in wlInsynSe));
  if(!kvar.length) return;
  for(let i = 0; i < kvar.length; i += 4){
    await Promise.all(kvar.slice(i, i + 4).map(async w => {
      const namn = (wlInfo[w.id] && wlInfo[w.id].langtNamn) || w.name;
      try {
        let data = insiderSeCache[w.id];
        if(!data){
          const r = await fetch(`/api/insider-se?q=${encodeURIComponent(namn)}&months=12`);
          data = await r.json();
          insiderSeCache[w.id] = data;
        }
        wlInsynSe[w.id] = insynSummering(data.transaktioner);
      } catch(e){ wlInsynSe[w.id] = null; } // markera som färdigförsökt
    }));
    paintWatchlist();
  }
}

// Fundamenta och 5-årshistorik hämtas en gång per papper (fonder hoppas över).
async function loadWatchlistData(){
  const tickers = getWatchlist().filter(w => !w.isFund).map(w => w.id);
  const missing = tickers.filter(t => !wlInfo[t] || !wlSeries[t]);
  if(missing.length && !wlLoading){
    wlLoading = true;
    try {
      const [inf, ser] = await Promise.all([fetchHoldingInfo(missing), fetchSparkSeries(missing, '5y')]);
      Object.assign(wlInfo, inf); Object.assign(wlSeries, ser);
    } catch(e){ /* tabellen visar "–" för det som saknas */ }
    wlLoading = false;
    paintWatchlist();
    setUpdatedStamp('stamp-watchlist');
  }
  loadWatchlistInsyn(); // efter fundamenta: FI-sökningen behöver bolagets långa namn
}

// Ritar alltid om; hämtar fundamenta bara när sidan är framme, så att en
// vanlig sidladdning inte drar igång ett anrop per bevakat papper i onödan.
function renderWatchlist(){
  paintWatchlist();
  if(currentSection === 'watchlist') loadWatchlistData();
}

function addToWatchlist() {
  const id = currentIsFund ? currentFundId : currentTicker;
  if(!id || !currentStockName) return;
  const list = getWatchlist();
  if(list.some(w => w.id === id)) return; // redan bevakad
  const item = {
    id,
    name: currentStockName,
    label: currentIsFund ? 'Avanza fond' : (currentTicker || id),
    isFund: !!currentIsFund
  };
  list.push(item);
  saveWatchlist(list);
  renderWatchlist();
  if(!item.isFund) refreshLivePrices(); // hämta kursen direkt istället för att vänta på nästa snurra
  pushItemCloud(item); // synka till molnet om inloggad
}

function removeFromWatchlist(id) {
  saveWatchlist(getWatchlist().filter(w => w.id !== id));
  renderWatchlist();
  deleteItemCloud(id); // synka till molnet om inloggad
}
