// conny-stocks · Grund: tillstånd, aktielista, livepriser, Yahoo spark, index-KPI, auto-uppdatering, navigation.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ STATE ══════════
let currentSection = 'dashboard';
let currentTicker = null;
let currentStockName = null;
let currentPriceChart = null;
let currentPeriod = '1y';
let screenerSel = new Set();       // valda tickers
let screenerSelMeta = {};          // ticker -> objekt (för jämför/analys, även över sidor)
let screenerResults = [];          // aktuell sidas resultat från Yahoo
let screenerPage = 0;
let screenerTotal = 0;
let screenerFilterInfo = null;     // {scanned, kept, dropped, estimated} från tradable-filtret
const SCREENER_SIZE = 25;
let screenerLoading = false;
let triageState = null;            // senaste AI-triagen {key, picks, ...} – null = tabellen visas
let sortCol = 'mcap';              // aktiv sorteringskolumn
let sortDir = 'desc';             // 'asc' | 'desc'
let screenerSortField = 'intradaymarketcap';
let screenerSortType = 'DESC';
let compareList = [];
let currentStockMeta = {};
let currentIsFund = false;
let currentFundId = null;
let detailRefreshTimer = null;
let sectorChartInstance = null;
let activeRegions = new Set(['se']);   // tomt = alla Avanza-marknader
let activeSectors = new Set();         // tomt = alla sektorer
// Nyckeltalsfilter (null/false = av). Filtreras av Yahoo på serversidan – se /api/screener.
let numFilters = { maxPe: null, maxEvEbitda: null, minRoe: null, posFcf: false };
let aiOpen = false;
let aiContext = '';
let aiHistory = [];

// ══════════ STOCK DATABASE ══════════
const stocks = [
  // USA
  {name:'NVIDIA',ticker:'NVDA',r:'usa',sektor:'Halvledare',kurs:'$134',ytd:20.1,pe:38.2,div:0.0,mcap:3280,flag:'🇺🇸'},
  {name:'Apple',ticker:'AAPL',r:'usa',sektor:'Teknik',kurs:'$196',ytd:-5.2,pe:31.4,div:0.5,mcap:2970,flag:'🇺🇸'},
  {name:'Microsoft',ticker:'MSFT',r:'usa',sektor:'Teknik',kurs:'$448',ytd:12.8,pe:35.1,div:0.7,mcap:3330,flag:'🇺🇸'},
  {name:'Alphabet',ticker:'GOOGL',r:'usa',sektor:'Teknik',kurs:'$172',ytd:-3.1,pe:21.8,div:0.0,mcap:2090,flag:'🇺🇸'},
  {name:'Amazon',ticker:'AMZN',r:'usa',sektor:'Konsument',kurs:'$212',ytd:8.4,pe:41.2,div:0.0,mcap:2240,flag:'🇺🇸'},
  {name:'Meta Platforms',ticker:'META',r:'usa',sektor:'Teknik',kurs:'$614',ytd:18.3,pe:27.6,div:0.4,mcap:1560,flag:'🇺🇸'},
  {name:'Broadcom',ticker:'AVGO',r:'usa',sektor:'Halvledare',kurs:'$248',ytd:31.4,pe:44.2,div:1.1,mcap:1170,flag:'🇺🇸'},
  {name:'Tesla',ticker:'TSLA',r:'usa',sektor:'Konsument',kurs:'$248',ytd:-14.8,pe:88.4,div:0.0,mcap:796,flag:'🇺🇸'},
  {name:'JPMorgan Chase',ticker:'JPM',r:'usa',sektor:'Finans',kurs:'$268',ytd:14.6,pe:13.8,div:2.1,mcap:770,flag:'🇺🇸'},
  {name:'Berkshire Hathaway',ticker:'BRK-B',r:'usa',sektor:'Finans',kurs:'$492',ytd:9.2,pe:21.1,div:0.0,mcap:1080,flag:'🇺🇸'},
  {name:'Johnson & Johnson',ticker:'JNJ',r:'usa',sektor:'Hälsovård',kurs:'$162',ytd:2.1,pe:16.4,div:3.1,mcap:391,flag:'🇺🇸'},
  {name:'Palantir',ticker:'PLTR',r:'usa',sektor:'Teknik',kurs:'$128',ytd:62.3,pe:218,div:0.0,mcap:278,flag:'🇺🇸'},
  {name:'ExxonMobil',ticker:'XOM',r:'usa',sektor:'Energi',kurs:'$118',ytd:4.2,pe:14.1,div:3.4,mcap:478,flag:'🇺🇸'},
  {name:'Lockheed Martin',ticker:'LMT',r:'usa',sektor:'Försvar',kurs:'$498',ytd:22.8,pe:18.4,div:2.7,mcap:124,flag:'🇺🇸'},
  // Sverige
  {name:'Atlas Copco',ticker:'ATCO-A.ST',r:'se',sektor:'Industri',kurs:'182 kr',ytd:-14.2,pe:33.5,div:1.6,mcap:852,flag:'🇸🇪'},
  {name:'Investor A',ticker:'INVE-A.ST',r:'se',sektor:'Finans',kurs:'341 kr',ytd:3.2,pe:6.6,div:1.7,mcap:1020,flag:'🇸🇪'},
  {name:'Volvo B',ticker:'VOLV-B.ST',r:'se',sektor:'Industri',kurs:'228 kr',ytd:-8.1,pe:11.3,div:4.2,mcap:471,flag:'🇸🇪'},
  {name:'ABB',ticker:'ABB.ST',r:'se',sektor:'Industri',kurs:'620 kr',ytd:-5.2,pe:28.4,div:2.1,mcap:1310,flag:'🇸🇪'},
  {name:'AstraZeneca',ticker:'AZN.L',r:'se',sektor:'Hälsovård',kurs:'1540 kr',ytd:6.8,pe:22.1,div:1.8,mcap:2450,flag:'🇸🇪'},
  {name:'SAAB B',ticker:'SAAB-B.ST',r:'se',sektor:'Försvar',kurs:'706 kr',ytd:41.2,pe:43.3,div:0.3,mcap:379,flag:'🇸🇪'},
  {name:'Ericsson B',ticker:'ERIC-B.ST',r:'se',sektor:'Teknik',kurs:'86 kr',ytd:4.1,pe:11.4,div:3.1,mcap:282,flag:'🇸🇪'},
  {name:'Nordea',ticker:'NDA-SE.ST',r:'se',sektor:'Finans',kurs:'148 kr',ytd:11.1,pe:9.1,div:7.2,mcap:580,flag:'🇸🇪'},
  {name:'Hexagon',ticker:'HEXA-B.ST',r:'se',sektor:'Teknik',kurs:'101 kr',ytd:-12.3,pe:38.0,div:1.5,mcap:271,flag:'🇸🇪'},
  // Europa
  {name:'ASML',ticker:'ASML.AS',r:'eu',sektor:'Halvledare',kurs:'€788',ytd:22.4,pe:34.8,div:0.7,mcap:310,flag:'🇳🇱'},
  {name:'SAP',ticker:'SAP.DE',r:'eu',sektor:'Teknik',kurs:'€284',ytd:28.1,pe:48.2,div:0.7,mcap:329,flag:'🇩🇪'},
  {name:'Siemens',ticker:'SIE.DE',r:'eu',sektor:'Industri',kurs:'€224',ytd:14.8,pe:19.4,div:2.1,mcap:200,flag:'🇩🇪'},
  {name:'LVMH',ticker:'MC.PA',r:'eu',sektor:'Konsument',kurs:'€688',ytd:4.2,pe:21.4,div:2.2,mcap:347,flag:'🇫🇷'},
  {name:'Shell',ticker:'SHEL.L',r:'eu',sektor:'Energi',kurs:'£28,4',ytd:6.8,pe:11.2,div:4.1,mcap:198,flag:'🇬🇧'},
  {name:'HSBC',ticker:'HSBA.L',r:'eu',sektor:'Finans',kurs:'£9,12',ytd:11.4,pe:8.4,div:5.8,mcap:162,flag:'🇬🇧'},
  // Norge
  {name:'Equinor',ticker:'EQNR.OL',r:'no',sektor:'Energi',kurs:'298 NOK',ytd:8.1,pe:9.8,div:5.8,mcap:980,flag:'🇳🇴'},
  {name:'Norsk Hydro',ticker:'NHY.OL',r:'no',sektor:'Industri',kurs:'68 NOK',ytd:12.4,pe:14.2,div:4.4,mcap:138,flag:'🇳🇴'},
  // Danmark
  {name:'Novo Nordisk',ticker:'NOVO-B.CO',r:'dk',sektor:'Hälsovård',kurs:'498 DKK',ytd:-28.4,pe:22.1,div:1.7,mcap:1120,flag:'🇩🇰'},
  {name:'Vestas Wind',ticker:'VWS.CO',r:'dk',sektor:'Energi',kurs:'118 DKK',ytd:14.2,pe:28.4,div:0.8,mcap:124,flag:'🇩🇰'},
  // Asien
  {name:'TSMC',ticker:'TSM',r:'as',sektor:'Halvledare',kurs:'$188',ytd:38.4,pe:28.4,div:1.4,mcap:978,flag:'🇹🇼'},
  {name:'Samsung Electronics',ticker:'005930.KS',r:'as',sektor:'Halvledare',kurs:'₩74 000',ytd:22.8,pe:14.2,div:2.8,mcap:440,flag:'🇰🇷'},
  {name:'Toyota',ticker:'7203.T',r:'as',sektor:'Konsument',kurs:'¥2 840',ytd:9.8,pe:9.2,div:3.1,mcap:368,flag:'🇯🇵'},
  {name:'Alibaba',ticker:'BABA',r:'as',sektor:'Teknik',kurs:'$92',ytd:42.1,pe:14.8,div:0.0,mcap:238,flag:'🇭🇰'},
];

const sectorColors = {
  'Halvledare': ['rgba(167,139,250,0.2)','#a78bfa'],
  'Teknik': ['rgba(79,142,247,0.2)','#4f8ef7'],
  'Hälsovård': ['rgba(244,114,182,0.2)','#f472b6'],
  'Finans': ['rgba(34,197,94,0.2)','#22c55e'],
  'Industri': ['rgba(96,165,250,0.2)','#60a5fa'],
  'Konsument': ['rgba(245,158,11,0.2)','#f59e0b'],
  'Energi': ['rgba(251,146,60,0.2)','#fb923c'],
  'Försvar': ['rgba(52,211,153,0.2)','#34d399'],
};

// ══════════ LIVE-PRISER I LISTOR ══════════
function fmtPrice(p, cur) {
  const n = p >= 100 ? Math.round(p).toLocaleString('sv-SE') : p.toFixed(2);
  switch(cur) {
    case 'USD': return '$' + n;
    case 'EUR': return '€' + n;
    case 'GBP': return '£' + n;
    case 'GBp': return n + ' p';
    case 'SEK': return n + ' kr';
    case 'NOK': return n + ' NOK';
    case 'DKK': return n + ' DKK';
    case 'JPY': return '¥' + n;
    case 'KRW': return '₩' + n;
    default: return n + (cur ? (' ' + cur) : '');
  }
}

// Senast hämtade live-priser per ticker (även för bevakade aktier utanför de 37).
const livePrices = {};

async function refreshLivePrices() {
  try {
    const watchTickers = getWatchlist().filter(w=>!w.isFund).map(w=>w.id);
    const allSymbols = [...new Set([...stocks.map(s=>s.ticker), ...watchTickers])];
    // Yahoos spark-endpoint klarar bara ~20 symboler per anrop – dela upp i bitar.
    const CHUNK = 15;
    const chunks = [];
    for(let i=0; i<allSymbols.length; i+=CHUNK) chunks.push(allSymbols.slice(i, i+CHUNK));
    const responses = await Promise.all(chunks.map(c => {
      const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(c.join(','))}&range=ytd&interval=1d`;
      return fetchYahoo(url).catch(() => null); // en trasig bit ska inte slå ut de andra
    }));
    let changed = false;
    responses.forEach(data => {
      const results = (data && data.spark && data.spark.result) || [];
      results.forEach(r => {
        const resp = r.response && r.response[0];
        if(!resp) return;
        const meta = resp.meta || {};
        const closes = ((resp.indicators && resp.indicators.quote[0] && resp.indicators.quote[0].close) || []).filter(v=>v!=null);
        const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : (closes.length ? closes[closes.length-1] : null);
        if(price == null) return;
        let ytd = null;
        if(closes.length > 1) {
          const y = ((price - closes[0]) / closes[0]) * 100;
          if(isFinite(y)) ytd = +y.toFixed(1);
        }
        const stock = stocks.find(s=>s.ticker === r.symbol);
        // behåll tidigare YTD om Yahoo inte gav nog historik
        const effYtd = ytd != null ? ytd : (stock ? stock.ytd : 0);
        // Dagsförändring från de två senaste stängningarna (samma resonemang som i
        // fetchSparkData: spark saknar previousClose och chartPreviousClose är fjolårets sista).
        let prev;
        if(closes.length >= 2) prev = (Math.abs(closes[closes.length-1] - price) < 1e-6) ? closes[closes.length-2] : closes[closes.length-1];
        else prev = meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose;
        const day = prev ? +(((price - prev)/prev)*100).toFixed(2) : null;
        // price/day (rådata) används av bevakningslistans tabell, kurs av sidomeny/översikt.
        livePrices[r.symbol] = { kurs: fmtPrice(price, meta.currency), ytd: effYtd, price, day, currency: meta.currency };
        if(stock) { stock.kurs = livePrices[r.symbol].kurs; if(ytd != null) stock.ytd = ytd; }
        changed = true;
      });
    });
    if(changed) {
      if(currentSection === 'dashboard') renderDashboard();
      updateWatchlistPrices();
    }
    setUpdatedStamp('stamp-dashboard');
  } catch(e) { /* behåll hårdkodade värden om Yahoo strular */ }
}

// ══════════ MARKNADSDATA VIA YAHOO SPARK ══════════
// Delad hjälpare: hämtar pris, ÅTD-% och dagsförändring för valfria symboler.
// `interval` grovkornar långa spann: på 10 år ger dagsdata ~2 500 punkter per symbol
// bara för att räkna ut en procentsiffra. Korta spann använder dagsdata som förut.
async function fetchSparkData(symbols, range = 'ytd', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}&interval=${interval}`;
  const data = await fetchYahoo(url);
  const results = (data && data.spark && data.spark.result) || [];
  const bySym = {};
  results.forEach(r => {
    const resp = r.response && r.response[0];
    if(!resp) return;
    const meta = resp.meta || {};
    const closes = ((resp.indicators && resp.indicators.quote[0] && resp.indicators.quote[0].close) || []).filter(v=>v!=null);
    const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : (closes.length ? closes[closes.length-1] : null);
    if(price == null) return;
    // Dagsförändring från de två SENASTE stängningarna. Spark saknar previousClose,
    // och meta.chartPreviousClose är föregående års sista kurs vid range=ytd – att
    // använda den gav "1 dag" = hela YTD-uppgången (helt fel dagssiffra).
    let prev;
    if(closes.length >= 2) prev = (Math.abs(closes[closes.length-1] - price) < 1e-6) ? closes[closes.length-2] : closes[closes.length-1];
    else prev = meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose;
    const ytd = closes.length ? ((price - closes[0]) / closes[0]) * 100 : null;
    const day = prev ? ((price - prev) / prev) * 100 : null;
    bySym[r.symbol] = { price, ytd, day, closes, currency: meta.currency };
  });
  return bySym;
}

const fmtSekNum = (n, dec) => n.toLocaleString('sv-SE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
// Avrundas först, så att t.ex. −0,004 % visas som 0,0 % (inte "−0,0 %").
const fmtSekPct = v => { v = Math.round(v * 10) / 10 || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%'; };

// Stämplar "Uppdaterad HH:MM:SS" när en sidas data faktiskt hämtats.
function setUpdatedStamp(id) {
  const el = document.getElementById(id);
  if(el) el.textContent = '· Uppdaterad ' + new Date().toLocaleTimeString('sv-SE');
}

// ══════════ MARKNADSINDEX (KPI-korten på översikten) ══════════
async function refreshMarketKpis() {
  try {
    const bySym = await fetchSparkData(['^GSPC','^IXIC','^OMX','SEK=X','EURSEK=X']);
    const fmtNum = fmtSekNum, fmtPct = fmtSekPct;
    const setIndex = (valId, subId, sym) => {
      const d = bySym[sym]; if(!d) return;
      const valEl = document.getElementById(valId), subEl = document.getElementById(subId);
      if(valEl) valEl.textContent = fmtNum(d.price, 0);
      if(subEl) {
        const parts = [];
        if(d.ytd != null) parts.push(fmtPct(d.ytd) + ' ÅTD');
        if(d.day != null) parts.push(fmtPct(d.day) + ' idag');
        subEl.textContent = parts.join(' · ') || '—';
        const ref = d.day != null ? d.day : d.ytd;
        subEl.className = 'kpi-sub ' + (ref == null ? 'muted' : ref >= 0 ? 'green' : 'red');
      }
    };
    setIndex('k-sp500', 'k-sp500-sub', '^GSPC');
    setIndex('k-nasdaq', 'k-nasdaq-sub', '^IXIC');
    setIndex('k-omxs', 'k-omxs-sub', '^OMX');
    const usd = bySym['SEK=X'], eur = bySym['EURSEK=X'];
    if(usd) { const el = document.getElementById('k-usdsek'); if(el) el.textContent = fmtNum(usd.price, 2); }
    if(eur) { const el = document.getElementById('k-usdsek-sub'); if(el) el.textContent = 'EUR/SEK ' + fmtNum(eur.price, 2); }
    setUpdatedStamp('stamp-dashboard');
  } catch(e) { /* behåll föregående värden om Yahoo strular */ }
}

// Kallas av refreshLivePrices var 60:e sekund. Tabellen läser livePrices direkt,
// så det räcker att rita om den – och bara när sidan faktiskt är framme.
function updateWatchlistPrices() {
  if(currentSection !== 'watchlist') return;
  if(!document.querySelector('#watchlist-items .wl-row')) return;
  paintWatchlist();
  setUpdatedStamp('stamp-watchlist');
}

// ══════════ AUTO-UPPDATERING PÅ DETALJSIDAN ══════════
function stopDetailAutoRefresh() {
  if(detailRefreshTimer) { clearInterval(detailRefreshTimer); detailRefreshTimer = null; }
}

function startStockAutoRefresh() {
  stopDetailAutoRefresh();
  detailRefreshTimer = setInterval(() => {
    if(currentSection === 'detail' && !currentIsFund && currentTicker) {
      loadStockQuote(currentTicker, currentStockName); // tyst uppdatering, ingen spinner
    } else {
      stopDetailAutoRefresh();
    }
  }, 30000);
}

// ══════════ NAVIGATION ══════════
function showSection(s) {
  if(s !== 'detail') stopDetailAutoRefresh();
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('section-' + s).classList.add('active');
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(el => { if(el.getAttribute('onclick') && el.getAttribute('onclick').includes("'"+s+"'")) el.classList.add('active'); });
  currentSection = s;
  if(s === 'dashboard') renderDashboard();
  if(s === 'signals') renderSignals();
  if(s === 'screener') renderScreener();
  if(s === 'macro') renderMacro();
  if(s === 'risk') renderRisk();
  if(s === 'trends') renderTrends();
  if(s === 'compare') renderCompare();
  if(s === 'watchlist') renderWatchlist();
  if(s === 'portfolio') renderPortfolio();
  if(s === 'analyses') renderAnalyses();
  if(s === 'aifund') renderAIFund();
  if(s === 'earnings') renderEarnings();
  if(s === 'aicost') renderAiCost();
  if(s === 'track') renderTrack();
  if(s === 'model') renderModelPortfolios();
}
