// conny-stocks · Aktiescreenern + AI-triage.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ SCREENER ══════════
// Mappning från svenska filterknappar till Yahoos sektor-/industri-taxonomi.
const SECTOR_MAP = {
  'Teknik':     { sector: 'Technology' },
  'Halvledare': { industry: 'Semiconductors' },
  'Hälsovård':  { sector: 'Healthcare' },
  'Finans':     { sector: 'Financial Services' },
  'Industri':   { sector: 'Industrials' },
  'Energi':     { sector: 'Energy' },
  'Konsument':  { sector: 'Consumer Cyclical' },
  'Försvar':    { industry: 'Aerospace & Defense' },
};
const REGION_FLAGS = { us:'🇺🇸', se:'🇸🇪', gb:'🇬🇧', de:'🇩🇪', fr:'🇫🇷', no:'🇳🇴', dk:'🇩🇰', fi:'🇫🇮',
  nl:'🇳🇱', ch:'🇨🇭', it:'🇮🇹', es:'🇪🇸', pt:'🇵🇹', be:'🇧🇪', at:'🇦🇹', ie:'🇮🇪', ca:'🇨🇦', jp:'🇯🇵' };

// Landskod ur Yahoo-suffixet, som reserv när q.market saknas.
const TICKER_SUFFIX_REGION = { '.ST':'se', '.OL':'no', '.CO':'dk', '.HE':'fi', '.DE':'de', '.F':'de',
  '.PA':'fr', '.AS':'nl', '.BR':'be', '.MI':'it', '.MC':'es', '.LS':'pt', '.VI':'at', '.SW':'ch',
  '.L':'gb', '.IR':'ie', '.TO':'ca' };
function marketFromTickerCode(sym){
  const s = (sym || '').toUpperCase();
  const dot = s.lastIndexOf('.');
  return dot < 0 ? 'us' : (TICKER_SUFFIX_REGION[s.slice(dot)] || '');
}
function fmtVol(v) {
  if(v >= 1e9) return (v/1e9).toFixed(1)+'B';
  if(v >= 1e6) return (v/1e6).toFixed(1)+'M';
  if(v >= 1e3) return (v/1e3).toFixed(1)+'K';
  return String(v);
}
function pct(v, color) {
  if(v == null) return '–';
  return (color ? '' : '') + (v>=0?'+':'') + v.toFixed(1) + '%';
}

const RATING_LABELS = { 'Strong Buy':'Stark köp', 'Buy':'Köp', 'Hold':'Behåll', 'Underperform':'Underprestera', 'Sell':'Sälj' };

// Valbara datakolumner. sortField = Yahoo-fält → sortering över HELA universumet.
// sortField:null = går bara att sortera på den aktuella sidan (Yahoo saknar fältet).
const COL_DEFS = {
  marknad: { label:'Marknad', align:'left',  sortField:null, val:s=>(s.r||''),
    cell:s=>`<td style="color:var(--text2);font-size:12px">${(s.r||'').toUpperCase()}</td>` },
  sektor:  { label:'Sektor', align:'left',  sortField:null, val:s=>(s.sektor||''),
    cell:s=>{const [bg,tc]=sectorColors[s.sektor]||['rgba(100,100,100,0.15)','#888'];return `<td><span class="sector-pill" style="background:${bg};color:${tc}">${escHtml(s.sektor)}</span></td>`;} },
  kurs:    { label:'Kurs', align:'right', sortField:'intradayprice', val:s=>(s.price!=null?s.price:-1),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.kurs}</td>` },
  ytd:     { label:'ÅTD %', align:'right', sortField:null, val:s=>(s.ytd!=null?s.ytd:-1e9),
    cell:s=>`<td style="text-align:right;color:${(s.ytd||0)>=0?'var(--green)':'var(--red)'}" class="td-mono">${s.ytd!=null?pct(s.ytd):'…'}</td>` },
  dag:     { label:'Dag %', align:'right', sortField:'percentchange', val:s=>(s.dag!=null?s.dag:-1e9),
    cell:s=>`<td style="text-align:right;color:${(s.dag||0)>=0?'var(--green)':'var(--red)'}" class="td-mono">${pct(s.dag)}</td>` },
  ar52:    { label:'52v %', align:'right', sortField:'fiftytwowkpercentchange', val:s=>(s.ar52!=null?s.ar52:-1e9),
    cell:s=>`<td style="text-align:right;color:${(s.ar52||0)>=0?'var(--green)':'var(--red)'}" class="td-mono">${pct(s.ar52)}</td>` },
  pe:      { label:'P/E', align:'right', sortField:'peratio.lasttwelvemonths', val:s=>(s.pe!=null?s.pe:1e12),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.pe!=null?s.pe.toFixed(1):'–'}</td>` },
  fpe:     { label:'Fwd P/E', align:'right', sortField:null, val:s=>(s.fpe!=null?s.fpe:1e12),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.fpe!=null?s.fpe.toFixed(1):'–'}</td>` },
  pb:      { label:'P/B', align:'right', sortField:null, val:s=>(s.pb!=null?s.pb:1e12),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.pb!=null?s.pb.toFixed(1):'–'}</td>` },
  eps:     { label:'EPS', align:'right', sortField:null, val:s=>(s.eps!=null?s.eps:-1e12),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.eps!=null?s.eps.toFixed(2):'–'}</td>` },
  rating:  { label:'Analytiker', align:'left', sortField:null,
    val:s=>{const m=(s.rating||'').match(/^([\d.]+)/);return m?parseFloat(m[1]):99;},
    cell:s=>{ if(!s.rating) return '<td style="color:var(--text3)">–</td>'; const n=parseFloat(s.rating); const col=n<=1.5?'var(--green)':n<=2.5?'#86c34a':n<=3.5?'var(--amber)':'var(--red)'; const lbl=RATING_LABELS[(s.rating.split(' - ')[1]||'').trim()]||(s.rating.split(' - ')[1]||s.rating); return `<td style="font-size:12px;color:${col}">${escHtml(lbl)}</td>`; } },
  div:     { label:'Utd.%', align:'right', sortField:'forward_dividend_yield', val:s=>(s.div||0),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.div>0?s.div.toFixed(1)+'%':'–'}</td>` },
  mcap:    { label:'Mkt cap', align:'right', sortField:'intradaymarketcap', val:s=>(s.mcap||0),
    cell:s=>`<td style="text-align:right;color:var(--text2);font-size:12px">${s.mcap!=null?(s.mcap>=1000?(s.mcap/1000).toFixed(1)+'T':s.mcap+'B'):'–'}</td>` },
  volym:   { label:'Volym', align:'right', sortField:'dayvolume', val:s=>(s.volym||0),
    cell:s=>`<td style="text-align:right;color:var(--text2);font-size:12px">${s.volym!=null?fmtVol(s.volym):'–'}</td>` },
  valuta:  { label:'Valuta', align:'left', sortField:null, val:s=>(s.valuta||''),
    cell:s=>`<td style="color:var(--text2);font-size:12px">${escHtml(s.valuta||'–')}</td>` },
  hi52:    { label:'52v hög', align:'right', sortField:null, val:s=>(s.hi52!=null?s.hi52:-1),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.hi52!=null?fmtSekNum(s.hi52,2):'–'}</td>` },
  lo52:    { label:'52v låg', align:'right', sortField:null, val:s=>(s.lo52!=null?s.lo52:-1),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.lo52!=null?fmtSekNum(s.lo52,2):'–'}</td>` },
  fwdeps:  { label:'Fwd EPS', align:'right', sortField:null, val:s=>(s.fwdeps!=null?s.fwdeps:-1e12),
    cell:s=>`<td style="text-align:right" class="td-mono">${s.fwdeps!=null?s.fwdeps.toFixed(2):'–'}</td>` },
  avgvol:  { label:'Snittvol.', align:'right', sortField:null, val:s=>(s.avgvol||0),
    cell:s=>`<td style="text-align:right;color:var(--text2);font-size:12px">${s.avgvol!=null?fmtVol(s.avgvol):'–'}</td>` },
};
const COL_ORDER = ['marknad','valuta','sektor','kurs','ytd','dag','ar52','hi52','lo52','pe','fpe','pb','eps','fwdeps','div','mcap','volym','avgvol','rating'];
const DEFAULT_COLS = ['marknad','sektor','kurs','ytd','pe','div','mcap']; // samma 7 som tidigare

function getCols() {
  try { const s = JSON.parse(localStorage.getItem('screenerCols')); if(Array.isArray(s) && s.length) return COL_ORDER.filter(k=>s.includes(k)); } catch(e){}
  return DEFAULT_COLS.slice();
}
function saveCols() { try { localStorage.setItem('screenerCols', JSON.stringify(visibleCols)); } catch(e){} }
let visibleCols = getCols();

function colspan() { return visibleCols.length + 3; } // kryssruta + Bolag + Detalj

function renderScreenerHead() {
  const arrow = k => sortCol===k ? `<span class="sort-arrow">${sortDir==='desc'?'▼':'▲'}</span>` : '';
  let th = `<tr><th style="width:28px"></th>`;
  th += `<th class="sortable" onclick="onSort('name')">Bolag${arrow('name')}</th>`;
  visibleCols.forEach(k => {
    const d = COL_DEFS[k];
    const pageOnly = !d.sortField;
    th += `<th class="sortable" style="text-align:${d.align}" title="${pageOnly?'Sorterar endast denna sida':'Sorterar alla aktier'}" onclick="onSort('${k}')">${d.label}${pageOnly?'<span class="sort-page" title="Endast denna sida">·</span>':''}${arrow(k)}</th>`;
  });
  th += `<th></th></tr>`;
  document.getElementById('screener-thead').innerHTML = th;
}

function onSort(key) {
  if(sortCol === key) sortDir = (sortDir === 'desc') ? 'asc' : 'desc';
  else { sortCol = key; sortDir = (key === 'pe') ? 'asc' : 'desc'; }
  const d = COL_DEFS[key];
  if(d && d.sortField) { // global sortering via servern
    screenerSortField = d.sortField;
    screenerSortType = sortDir.toUpperCase();
    screenerPage = 0;
    loadScreener();
  } else { // ÅTD / Bolag / Marknad / Sektor – sortera bara aktuell sida
    renderScreenerHead();
    paintScreener();
  }
}

// ── Kolumnväljare ──
function toggleColMenu() {
  const m = document.getElementById('col-menu');
  const show = m.style.display === 'none';
  m.style.display = show ? 'block' : 'none';
  if(show) renderColMenu();
}
function renderColMenu() {
  document.getElementById('col-menu').innerHTML = COL_ORDER.map(k =>
    `<label><input type="checkbox" ${visibleCols.includes(k)?'checked':''} onchange="toggleCol('${k}')"> ${COL_DEFS[k].label}</label>`
  ).join('');
}
function toggleCol(k) {
  if(visibleCols.includes(k)) {
    if(visibleCols.length <= 1) return; // minst en kolumn kvar
    visibleCols = visibleCols.filter(x=>x!==k);
  } else {
    visibleCols = COL_ORDER.filter(x => visibleCols.includes(x) || x===k);
  }
  saveCols();
  renderScreenerHead();
  paintScreener();
  renderColMenu();
}

// Klick = välj bara den här. Ctrl/⌘-klick = lägg till eller ta bort ur urvalet.
// "Alla länder"/"Alla sektorer" nollställer alltid – de är inte kombinerbara.
function setFilter(el, type, ev) {
  const region = type === 'region';
  const set = region ? activeRegions : activeSectors;
  const val = region ? el.dataset.r : el.dataset.s;
  const multi = ev && (ev.ctrlKey || ev.metaKey);

  if(val === 'alla' || !multi){
    set.clear();
    if(val !== 'alla') set.add(val);
  } else if(set.has(val)){
    set.delete(val);                       // sista valet bort = tillbaka till "alla"
  } else {
    set.delete('norden');                  // gruppen krockar med enskilda länder
    set.add(val);
  }
  paintFilterChips();
  screenerPage = 0;
  loadScreener();
}

function paintFilterChips(){
  const mark = (sel, set, key) => document.querySelectorAll(sel + ' .filter-chip').forEach(c => {
    const v = c.dataset[key];
    c.classList.toggle('on', set.size ? set.has(v) : v === 'alla');
  });
  mark('#region-filters', activeRegions, 'r');
  mark('#sector-filters', activeSectors, 's');
  const hint = document.getElementById('filter-hint');
  if(hint) hint.innerHTML = activeRegions.size > 1 || activeRegions.size === 0
    ? 'Flera marknader valda — börsvärdessorteringen blir ungefärlig eftersom bolagen redovisas i olika valutor. Ctrl/⌘-klicka för att ändra urvalet.'
    : 'Tips: håll <b>Ctrl</b> (⌘ på Mac) för att välja flera länder eller sektorer samtidigt.';
}

function paintNumFilters(){
  for(const k of ['maxPe', 'maxEvEbitda', 'minRoe']){ const el = document.getElementById('nf-' + k); if(el) el.value = numFilters[k] != null ? numFilters[k] : ''; }
  const f = document.getElementById('nf-posFcf'); if(f) f.checked = !!numFilters.posFcf;
}
function setNumFilters(){
  const val = id => { const v = parseFloat((document.getElementById(id) || {}).value); return isFinite(v) ? v : null; };
  numFilters = { maxPe: val('nf-maxPe'), maxEvEbitda: val('nf-maxEvEbitda'), minRoe: val('nf-minRoe'),
                 posFcf: !!(document.getElementById('nf-posFcf') || {}).checked };
  screenerPage = 0;
  loadScreener();
}
function clearNumFilters(){
  numFilters = { maxPe: null, maxEvEbitda: null, minRoe: null, posFcf: false };
  paintNumFilters();
  const o = document.getElementById('screener-origin'); if(o) o.innerHTML = '';
  screenerPage = 0;
  loadScreener();
}

// Hämta YTD + senaste kurs för en lista tickers via spark (chunkat, Yahoo klarar ~20/anrop).
async function fetchSparkPrices(symbols) {
  const out = {};
  const CHUNK = 15;
  const chunks = [];
  for(let i=0;i<symbols.length;i+=CHUNK) chunks.push(symbols.slice(i,i+CHUNK));
  const responses = await Promise.all(chunks.map(c =>
    fetchYahoo(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(c.join(','))}&range=ytd&interval=1d`).catch(()=>null)
  ));
  responses.forEach(data => {
    const results = (data && data.spark && data.spark.result) || [];
    results.forEach(r => {
      const resp = r.response && r.response[0]; if(!resp) return;
      const meta = resp.meta || {};
      const closes = ((resp.indicators && resp.indicators.quote[0] && resp.indicators.quote[0].close) || []).filter(v=>v!=null);
      const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : (closes.length ? closes[closes.length-1] : null);
      if(price == null) return;
      let ytd = null;
      if(closes.length > 1) { const y = ((price-closes[0])/closes[0])*100; if(isFinite(y)) ytd = +y.toFixed(1); }
      out[r.symbol] = { price, ytd, currency: meta.currency };
    });
  });
  return out;
}

// Frågan till /api/screener utifrån aktuella filter + sortering. Delas av tabellen och AI-triagen.
function screenerParams(offset, size) {
  // Valda sektorer kan blanda Yahoos "sector" och "industry" (Halvledare är en
  // bransch) – skicka dem som två listor, proxyn OR:ar ihop dem.
  const maps = [...activeSectors].map(s => SECTOR_MAP[s] || {});
  const params = new URLSearchParams();
  const sectorList = maps.map(m => m.sector).filter(Boolean);
  const industryList = maps.map(m => m.industry).filter(Boolean);
  if(sectorList.length) params.set('sector', sectorList.join(','));
  if(industryList.length) params.set('industry', industryList.join(','));
  if(activeRegions.size) params.set('region', [...activeRegions].join(','));
  for(const k of ['maxPe', 'maxEvEbitda', 'minRoe']) if(numFilters[k] != null) params.set(k, numFilters[k]);
  if(numFilters.posFcf) params.set('posFcf', '1');
  params.set('tradable', '1');  // bara börser Avanza handlar på, en rad per bolag
  params.set('sortField', screenerSortField);
  params.set('sortType', screenerSortType);
  params.set('offset', offset);
  params.set('size', size);
  return params.toString();
}
// Vilka filter som gäller (utan sida/sortering) – AI-triagens kort stängs när de ändras.
const screenerFilterKey = () => JSON.stringify([[...activeRegions].sort(), [...activeSectors].sort(), numFilters]);

let screenerReload = false; // filter ändrades medan en hämtning pågick → hämta igen efteråt
async function loadScreener() {
  if(screenerLoading) { screenerReload = true; return; }
  screenerLoading = true;
  renderScreenerHead();
  const tbody = document.getElementById('screener-tbody');
  tbody.innerHTML = `<tr><td colspan="${colspan()}" style="text-align:center;padding:28px;color:var(--text2)">Hämtar aktier…</td></tr>`;
  document.getElementById('pg-info').textContent = '';
  if(triageState && triageState.key !== screenerFilterKey()) closeTriage(); // korten gällde andra filter
  try {
    const res = await fetch(`/api/screener?${screenerParams(screenerPage * SCREENER_SIZE, SCREENER_SIZE)}`);
    const data = await res.json();
    const result = data && data.finance && data.finance.result && data.finance.result[0];
    const quotes = (result && result.quotes) || [];
    screenerTotal = (result && result.total) || 0;
    screenerFilterInfo = (result && result.tradableFilter) || null;
    screenerResults = quotes.map(q => {
      // q.region är opålitlig (= query-regionen, ofta "US"). q.market = "se_market" ger rätt land.
      // Med flera valda marknader går det inte att gissa land ur filtret – då får
      // q.market avgöra ensam (den är rätt) och flaggan falla tillbaka på tickern.
      const only = activeRegions.size === 1 ? [...activeRegions][0] : '';
      const market = (q.market || '').split('_')[0] || (only && only !== 'norden' ? only : '');
      return {
      name: q.shortName || q.longName || q.symbol,
      ticker: q.symbol,
      r: market,
      sektor: activeSectors.size === 1 ? [...activeSectors][0] : (q.sector || 'Aktie'),
      kurs: q.regularMarketPrice != null ? fmtPrice(q.regularMarketPrice, q.currency) : '–',
      price: q.regularMarketPrice != null ? q.regularMarketPrice : null,
      ytd: null,
      dag: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(1) : null,
      ar52: q.fiftyTwoWeekChangePercent != null ? +q.fiftyTwoWeekChangePercent.toFixed(1) : null,
      volym: q.regularMarketVolume != null ? q.regularMarketVolume : null,
      pe: q.trailingPE != null ? +q.trailingPE.toFixed(1) : null,
      fpe: q.forwardPE != null ? +q.forwardPE.toFixed(1) : null,
      pb: q.priceToBook != null ? +q.priceToBook.toFixed(1) : null,
      eps: q.epsTrailingTwelveMonths != null ? +q.epsTrailingTwelveMonths.toFixed(2) : null,
      rating: q.averageAnalystRating || null,
      div: q.trailingAnnualDividendYield != null ? +(q.trailingAnnualDividendYield*100).toFixed(1)
           : (q.dividendYield != null ? +q.dividendYield.toFixed(1) : 0),
      mcap: q.marketCap != null ? Math.round(q.marketCap/1e9) : null,
      valuta: q.currency || '',
      hi52: q.fiftyTwoWeekHigh != null ? q.fiftyTwoWeekHigh : null,
      lo52: q.fiftyTwoWeekLow != null ? q.fiftyTwoWeekLow : null,
      fwdeps: q.epsForward != null ? +q.epsForward.toFixed(2) : null,
      avgvol: q.averageDailyVolume3Month != null ? q.averageDailyVolume3Month : null,
      flag: REGION_FLAGS[market] || REGION_FLAGS[marketFromTickerCode(q.symbol)] || '🏳️'
      };
    });
    paintScreener();
    if(triageState) renderTriageCards(); // korten visar ev. nya djupanalyser sedan sist
    // Berika med riktig ÅTD (och färsk kurs) via spark – separat anrop, uppdatera sen.
    const syms = screenerResults.map(s=>s.ticker);
    if(syms.length) {
      const prices = await fetchSparkPrices(syms);
      screenerResults.forEach(s => {
        const p = prices[s.ticker];
        if(p) { if(p.ytd != null) s.ytd = p.ytd; if(p.price != null) { s.price = p.price; s.kurs = fmtPrice(p.price, p.currency); } }
      });
      paintScreener();
    }
    setUpdatedStamp('stamp-screener');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="${colspan()}" style="text-align:center;padding:28px;color:var(--red)">Kunde inte hämta aktier just nu. Försök igen.</td></tr>`;
  } finally {
    screenerLoading = false;
    if(screenerReload) { screenerReload = false; loadScreener(); }
  }
}

// Bakåtkompatibelt namn (kallas från navigation/init).
function renderScreener() { loadScreener(); }

function paintScreener() {
  const q = (document.getElementById('name-search').value || '').toLowerCase().trim();
  let rows = screenerResults.filter(s => !q || s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q));
  // Servern väljer vilka aktier som hamnar på sidan (globalt). Här ordnar vi sidan exakt efter
  // det VISADE värdet, så ordningen alltid matchar siffrorna (t.ex. P/E där Yahoos sorteringsfält
  // skiljer sig från det P/E-tal vi visar).
  const def = sortCol === 'name' ? { val:s=>s.name } : COL_DEFS[sortCol];
  if(def && def.val) rows = rows.slice().sort((a,b) => {
    const va = def.val(a), vb = def.val(b);
    if(typeof va === 'string') { const c = va.localeCompare(vb,'sv'); return sortDir==='desc'?-c:c; }
    return sortDir==='desc' ? (vb-va) : (va-vb);
  });
  const tbody = document.getElementById('screener-tbody');
  if(!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan()}" style="text-align:center;padding:28px;color:var(--text2)">Inga aktier matchar.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(s => {
      const sel = screenerSel.has(s.ticker);
      const cells = visibleCols.map(k => COL_DEFS[k].cell(s)).join('');
      return `<tr class="${sel?'selected':''}" onclick="toggleScreenerRow('${escQuote(s.ticker)}')">
        <td><div class="chk ${sel?'on':''}">${sel?'✓':''}</div></td>
        <td><div class="td-name">${s.flag} ${triagePickRank(s.ticker) ? `<span class="triage-mark" title="Vald av AI-triagen (nr ${triagePickRank(s.ticker)})">✦${triagePickRank(s.ticker)}</span> ` : ''}${escHtml(s.name)}</div><div class="td-ticker">${escHtml(s.ticker)} ${verdictBadge(s.ticker)}</div></td>
        ${cells}
        <td><button onclick="event.stopPropagation();loadStock('${escQuote(s.ticker)}','${escQuote(s.name)}')" style="background:none;border:1px solid var(--border2);color:var(--text2);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer">Detalj</button></td>
      </tr>`;
    }).join('');
  }
  const totalPages = Math.max(1, Math.ceil(screenerTotal / SCREENER_SIZE));
  const from = screenerTotal ? screenerPage*SCREENER_SIZE+1 : 0;
  const to = Math.min(screenerTotal, (screenerPage+1)*SCREENER_SIZE);
  // Totalen är uppskattad när filtret bara sett en del av universumet – markera det.
  const approx = screenerFilterInfo && screenerFilterInfo.estimated ? '≈' : '';
  document.getElementById('pg-info').textContent = screenerTotal
    ? `${from}–${to} av ${approx}${screenerTotal.toLocaleString('sv-SE')} · Sida ${screenerPage+1}/${totalPages}`
      + (screenerFilterInfo && screenerFilterInfo.dropped ? ` · ${screenerFilterInfo.dropped} dubbletter/ej Avanza-handlade dolda` : '')
    : '';
  document.getElementById('pg-prev').disabled = screenerPage <= 0;
  document.getElementById('pg-next').disabled = (screenerPage+1) >= totalPages;
  updateSelBar();
}

function screenerPrev() { if(screenerPage>0){ screenerPage--; loadScreener(); } }
function screenerNext() {
  const totalPages = Math.ceil(screenerTotal / SCREENER_SIZE);
  if(screenerPage+1 < totalPages){ screenerPage++; loadScreener(); }
}

function toggleScreenerRow(ticker) {
  if(screenerSel.has(ticker)) { screenerSel.delete(ticker); delete screenerSelMeta[ticker]; }
  else { screenerSel.add(ticker); const m = screenerResults.find(s=>s.ticker===ticker); if(m) screenerSelMeta[ticker] = m; }
  paintScreener();
}

function clearScreenerSel() { screenerSel.clear(); screenerSelMeta = {}; paintScreener(); }

function updateSelBar() {
  const n = screenerSel.size;
  document.getElementById('sel-count').textContent = n;
  document.getElementById('analyze-btn').disabled = n === 0;
  document.getElementById('compare-btn').disabled = n === 0;
}

function analyzeSelected() {
  const sel = [...screenerSel].map(t=>screenerSelMeta[t]).filter(Boolean);
  const names = sel.map(s=>s.name);
  const tickers = sel.map(s=>s.ticker);
  openAI();
  const prompt = names.length === 1
    ? `Analysera ${names[0]} (${tickers[0]}) – ge mig nyckeltal, styrkor, risker och en sammanfattande bedömning.`
    : `Jämför och analysera dessa aktier: ${names.join(', ')}. Visa styrkor, risker och vilken som ser mest attraktiv ut.`;
  stageAnalysis(prompt, names.length === 1 ? 'Analys: ' + names[0] : 'Jämförelse: ' + names.join(', '));
}

// ══════════ AI-TRIAGE (Aktiescreenern) ══════════
// Steg mellan screenern och djupanalysen: AI:n läser bruttolistan (alla bolag som
// matchar filtren, max 150, berikade med ROE, EV/EBITDA och FCF) och vaskar fram exakt
// `targetCount` bolag givet senaste CIO-analysen. Svaret är maskinläsbart
// (<triage_result>) och blir kort med knapp vidare till Institutionell djupanalys.
const SCR_TRIAGE_MODEL = 'claude-sonnet-5';
// Tak för bruttolistan: alla bolag som matchar filtren, men högst så här många
// (~130 tokens och ett nyckeltalsanrop per bolag). Proxyn ger max 50 per sida.
const SCR_TRIAGE_GROSS = 150;
const triageSystemPrompt = targetCount => `Du är en obarmhärtig aktieanalytiker och 'stock picker' på en institutionell fond.
Din uppgift är att sålla marknadens brus. Du kommer att ta emot en JSON-lista med
aktier som passerat fondens kvantitativa grundkrav (Screenern), samt vår CIO:s aktuella
makro- och sektorallokering.

UPPGIFT:
1. Analysera bruttolistan strikt utifrån CIO:ns makrovy. Om CIO:n förespråkar defensiva
   kassaflöden, kasta ut allt cykliskt. Om CIO:n varnar för multipelkontraktion, slakta
   alla bolag med orimligt höga P/E oavsett historisk tillväxt.
2. Välj ut EXAKT ${targetCount} bolag som uppvisar den överlägset starkaste asymmetrin
   mellan makroekonomisk medvind och fundamental prislapp (ROE, EV/EBITDA, P/E, FCF).

REGEL 1: INGET BRUS.
Du får inte skriva någon inledande text, hälsning eller övergripande sammanfattning.
Börja direkt med XML-taggen.

REGEL 2: MASKINLÄSBART FORMAT.
Din enda uppgift är att returnera ett JSON-objekt inkapslat i taggarna <triage_result>
och </triage_result>. Arrayen "top_picks" MÅSTE innehålla exakt ${targetCount} bolag.
Följ denna exakta struktur:

<triage_result>
{
  "top_picks": [
    {
      "ticker": "TICKER",
      "name": "Bolagsnamn",
      "sector": "Sektor",
      "justification": "Max två krasst formulerade meningar om varför bolaget överlever din utrensning givet CIO-vyn och bolagets nyckeltal."
    }
  ]
}
</triage_result>`;

// Aktiva filter i klartext (till modellen och till den sparade analysen).
function screenerFilterText() {
  const label = code => { const c = document.querySelector(`#region-filters [data-r="${code}"]`); return c ? c.textContent.replace(/[^\p{L}\s-]/gu, '').trim() : code; };
  const parts = [activeRegions.size ? [...activeRegions].map(label).join(', ') : 'alla marknader',
                 activeSectors.size ? [...activeSectors].join(', ') : 'alla sektorer'];
  if(numFilters.maxPe != null) parts.push('P/E ≤ ' + numFilters.maxPe);
  if(numFilters.maxEvEbitda != null) parts.push('EV/EBITDA ≤ ' + numFilters.maxEvEbitda);
  if(numFilters.minRoe != null) parts.push('ROE ≥ ' + numFilters.minRoe + ' %');
  if(numFilters.posFcf) parts.push('positivt fritt kassaflöde');
  return parts.join(' · ');
}

// Bruttolistan: alla bolag som matchar filtren (i vald sortering, högst
// SCR_TRIAGE_GROSS), berikade med nyckeltalen prompten kräver – screenerns egna rader
// saknar ROE, EV/EBITDA och FCF. Returnerar { list, total } (total = hur många som matchar).
async function triageGrossList(onProgress) {
  const byTicker = new Map();
  let total = 0;
  for(let offset = 0; offset < SCR_TRIAGE_GROSS; offset += 50) {
    const res = await fetch(`/api/screener?${screenerParams(offset, 50)}`);
    const data = await res.json();
    const r = (data && data.finance && data.finance.result && data.finance.result[0]) || {};
    total = r.total || total;
    const page = r.quotes || [];
    page.forEach(q => { if(q.symbol && !byTicker.has(q.symbol)) byTicker.set(q.symbol, q); });
    if(page.length < 50) break; // sista sidan (proxyns total är bara en uppskattning)
  }
  const quotes = [...byTicker.values()].slice(0, SCR_TRIAGE_GROSS);
  if(onProgress) onProgress(quotes.length, total);
  const fund = {};
  for(let i = 0; i < quotes.length; i += 8) {
    await Promise.all(quotes.slice(i, i + 8).map(async q => { fund[q.symbol] = await fetchFundamentals(q.symbol); }));
  }
  return { total: Math.max(total, quotes.length), list: quotes.map(q => {
    const f = fund[q.symbol] || {};
    const cur = q.currency || f.currency || null;
    const netDebt = (f.debt != null && f.cash != null) ? f.debt - f.cash : null;
    return {
      ticker: q.symbol, name: q.longName || q.shortName || q.symbol,
      sector: f.sector || q.sector || null, industry: f.industry || null,
      market: (q.market || '').split('_')[0] || null, currency: cur,
      market_cap_bn: q.marketCap != null ? deepR1(q.marketCap / 1e9) : null,
      pe_ttm: deepR1(q.trailingPE), pe_forward: deepR1(q.forwardPE), ev_ebitda: deepR1(f.evEbitda),
      roe_pct: deepR1(f.roe), operating_margin_pct: deepR1(f.opMargin), revenue_growth_pct: deepR1(f.revenueGrowth),
      fcf_mn: deepMn(f.fcf),
      fcf_yield_pct: (f.fcf != null && f.mcap && f.finCurrency && f.finCurrency === cur) ? deepR1(f.fcf / f.mcap * 100) : null,
      net_debt_to_ebitda: (netDebt != null && f.ebitda > 0) ? deepR2(netDebt / f.ebitda) : null,
      dividend_yield_pct: deepR2(f.div), chg_52w_pct: deepR1(q.fiftyTwoWeekChangePercent),
      price: q.regularMarketPrice != null ? q.regularMarketPrice : null
    };
  }) };
}

function parseTriageResult(text) {
  const m = (text || '').match(/<triage_result>\s*([\s\S]*?)\s*<\/triage_result>/);
  if(!m) return null;
  try {
    const j = JSON.parse(m[1].replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    return Array.isArray(j && j.top_picks) ? j.top_picks : null;
  } catch(e) { return null; }
}

function closeTriage() {
  triageState = null;
  const out = document.getElementById('triage-out'); if(out) out.innerHTML = '';
  if(screenerResults.length) paintScreener(); // ta bort ✦-markeringarna i listan
}

// Kortets knapp: öppna bolaget och starta djupanalysen direkt när sidan laddat.
async function triageDeep(ticker, name) {
  await loadStock(ticker, name);
  if(currentTicker === ticker) runDeepAnalysis();
}

// Triagens val i tabellen: ✦ + rangordning (1 = AI:ns främsta val), 0 = inte vald.
function triagePickRank(ticker) {
  if(!triageState) return 0;
  return triageState.picks.findIndex(p => p.ticker === ticker) + 1;
}

function renderTriageCards() {
  const out = document.getElementById('triage-out');
  const s = triageState;
  if(!out || !s) return;
  const kpi = (label, v, suf = '', dec = 1) => v != null ? `${label} ${fmtSekNum(v, dec)}${suf}` : null;
  const signed = (label, v) => v != null ? `${label} ${v >= 0 ? '+' : '−'}${fmtSekNum(Math.abs(v), 0)} %` : null;
  const cards = s.picks.map((p, i) => {
    const g = p.data, nm = escQuote(p.name || g.name), tk = escQuote(p.ticker);
    const kpis = [kpi('P/E', g.pe_ttm), kpi('EV/EBITDA', g.ev_ebitda), kpi('ROE', g.roe_pct, ' %'), kpi('FCF-yield', g.fcf_yield_pct, ' %')].filter(Boolean).join(' · ');
    const more = [kpi('Fwd P/E', g.pe_forward), signed('52 v', g.chg_52w_pct), signed('Oms.tillväxt', g.revenue_growth_pct),
      kpi('Nettoskuld/EBITDA', g.net_debt_to_ebitda, 'x'), kpi('Utd.', g.dividend_yield_pct, ' %'),
      g.market_cap_bn != null ? `Börsvärde ${fmtSekNum(g.market_cap_bn, 0)} md ${escHtml(g.currency || '')}` : null].filter(Boolean).join(' · ');
    const [bg, tc] = sectorColors[p.sector] || ['rgba(100,100,100,0.15)', '#888'];
    const verdict = verdictBadge(p.ticker);
    return `<div class="card triage-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div><div style="font-weight:600">${i + 1}. ${escHtml(p.name || g.name)}</div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${escHtml(p.ticker)}${g.price != null ? ` · ${fmtSekNum(g.price, 2)} ${escHtml(g.currency || '')}` : ''}</div></div>
        ${p.sector ? `<span class="sector-pill" style="background:${bg};color:${tc};flex-shrink:0">${escHtml(p.sector)}</span>` : ''}
      </div>
      ${kpis ? `<div class="triage-kpis">${kpis}</div>` : ''}
      ${more ? `<div class="triage-kpis" style="color:var(--text3)">${more}</div>` : ''}
      <div class="triage-why">${escHtml(p.justification || '')}</div>
      ${verdict ? `<div style="font-size:12px;color:var(--text2)">Djupanalys: ${verdict}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="action-btn" onclick="triageDeep('${tk}','${nm}')">${verdict ? '↻ Ny djupanalys' : '✦ Kör Institutionell Djupanalys'}</button>
        <button class="ghost-btn" onclick="openModelAdd('${tk}','${nm}')">+ Modellportfölj</button>
        <button class="ghost-btn" onclick="loadStock('${tk}','${nm}')">Öppna</button>
      </div>
    </div>`;
  }).join('');
  const cio = s.cio ? `CIO-direktiv: ${s.cio.source} (${s.cio.date})` : 'ingen CIO-analys hittades – urvalet bygger på nyckeltalen';
  out.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:13px"><b>✦ AI-triage: ${s.picks.length} av ${s.grossCount} bolag</b>
        <span class="muted" style="font-size:12px">· ${escHtml(s.filters)} · ${escHtml(cio)}</span></div>
      <button class="ghost-btn" onclick="closeTriage()">× Stäng korten</button>
    </div>
    ${s.note ? `<div class="info-msg">${escHtml(s.note)}</div>` : ''}
    <div class="triage-grid">${cards}</div>
    <div class="deep-meta" style="margin-top:0;margin-bottom:14px">Sparad i Sparade analyser · ${escHtml(s.costMeta)} · triagens val är markerade med ✦ i listan nedan</div>`;
}

let triageRunId = 0;
async function runTriage() {
  const out = document.getElementById('triage-out'), btn = document.getElementById('triage-btn');
  if(!getApiKey()) {
    out.innerHTML = '<div class="error-msg">Ingen API-nyckel. Klistra in din Anthropic-nyckel i AI-panelen (✦ AI-analys) först.</div>';
    return;
  }
  const targetCount = Math.max(1, Math.min(15, Number(document.getElementById('triage-count').value) || 5));
  const id = ++triageRunId, live = () => id === triageRunId;
  const key = screenerFilterKey(), filters = screenerFilterText();
  const status = txt => { if(live()) memoStatus(out, txt); };
  const fail = msg => { if(live()) { out.innerHTML = `<div class="error-msg">${msg}</div>`; btn.disabled = false; btn.textContent = '✦ Kör AI-triage'; } };
  btn.disabled = true; btn.textContent = '✦ Vaskar…';

  status('Hämtar bruttolistan – alla bolag som matchar filtren…');
  let grossRes, cio;
  try {
    [grossRes, cio] = await Promise.all([
      triageGrossList((n, total) => status(`Hämtar ROE, EV/EBITDA och FCF för ${n} bolag${total > n ? ` (de ${n} första av ≈${total} som matchar – taket är ${SCR_TRIAGE_GROSS})` : ''}…`)),
      latestCioDirective()
    ]);
  } catch(e) { return fail('Kunde inte hämta bruttolistan: ' + escHtml(e.message)); }
  const gross = grossRes.list;
  if(!gross.length) return fail('Inga bolag matchar filtren – vidga urvalet och försök igen.');
  const capped = grossRes.total > gross.length;
  const target = Math.min(targetCount, gross.length);
  status(`AI:n vaskar fram ${target} av ${gross.length} bolag${capped ? ` (≈${grossRes.total} matchar, de ${gross.length} första i vald sortering tas med)` : ''} ${cio ? 'mot CIO-direktivet' : '(ingen CIO-analys hittades – kör den på Översikt för ett skarpare urval)'} – modellen tänker innan den svarar…`);

  const today = new Date().toLocaleDateString('sv-SE', { year:'numeric', month:'long', day:'numeric' });
  const user = `Dagens datum: ${today}. Screenerns filter: ${filters}.

Om underlaget:
- gross_list är bolagen som matchar filtren (${gross.length} st). Välj bara bland dem och ange ticker exakt som i listan.
- Fält som slutar på _mn är belopp i miljoner i bolagets rapportvaluta; market_cap_bn är miljarder i handelsvalutan.
- cio_directive är slutsatserna ur den senaste CIO-analysen. Är den null finns ingen – välj då utifrån nyckeltalen.
- null betyder att datan saknas. Hitta inte på siffror.

<underlag>
${JSON.stringify({ cio_directive: cio, gross_list: gross }, null, 1)}
</underlag>`;
  const result = await callClaudeStream({ model: SCR_TRIAGE_MODEL, max_tokens: 32000, system: triageSystemPrompt(target),
    output_config: { effort: 'high' }, messages: [{ role: 'user', content: user }] });
  if(result.error) return fail('API-fel: ' + escHtml(result.error.message || result.error.type || 'okänt fel'));

  const raw = parseTriageResult(result.text);
  if(!raw) return fail(`AI:n svarade inte med ett giltigt urval${result.stop_reason === 'max_tokens' ? ' (svaret kapades)' : ''}. Försök igen.`);
  const byTicker = new Map(gross.map(g => [g.ticker.toUpperCase(), g]));
  const seen = new Set();
  const picks = raw.map(p => ({ ...p, data: byTicker.get(String(p.ticker || '').trim().toUpperCase()) }))
    .filter(p => p.data && !seen.has(p.data.ticker) && seen.add(p.data.ticker))
    .map(p => ({ ...p, ticker: p.data.ticker }))
    .slice(0, target);
  if(!picks.length) return fail('AI:ns urval matchade inga bolag i bruttolistan. Försök igen.');

  const costMeta = estimateCostText(SCR_TRIAGE_MODEL, result.usage);
  recordAiUsage('screener_triage', SCR_TRIAGE_MODEL, result.usage);
  const note = picks.length < target ? `AI:n levererade ${picks.length} giltiga bolag av ${target} begärda (övriga fanns inte i bruttolistan).` : '';
  saveAnalysis({ ts: Date.now(), title: `AI-triage: ${picks.length} av ${gross.length} bolag (${filters})`, model: SCR_TRIAGE_MODEL, cost: costMeta,
    answer: `### AI-triage: ${picks.length} av ${gross.length} bolag\nFilter: ${filters} · ${cio ? `CIO-direktiv: ${cio.source} (${cio.date})` : 'utan CIO-direktiv'}\n\n` +
      picks.map((p, i) => `${i + 1}. **${p.name || p.data.name} (${p.ticker})**, ${p.sector || p.data.sector || '–'} – ${p.justification || ''}`).join('\n') });
  // Urvalet till beslutsloggen (AI:ns träffsäkerhet) – varje kort är en köpkandidat.
  recordDecisions('triage', `AI-triage: ${picks.length} av ${gross.length} bolag (${filters})`, picks.map(p => ({
    ticker: p.ticker, name: p.name || p.data.name, action: 'KANDIDAT', price: p.data.price, currency: p.data.currency, note: p.justification })));
  if(!live()) return;
  triageState = { key, picks, grossCount: gross.length, filters, cio, costMeta, note };
  renderTriageCards();
  if(screenerResults.length) paintScreener(); // ✦-markera triagens val i listan
  btn.disabled = false; btn.textContent = '↻ Kör ny AI-triage';
}
