// conny-stocks · Sök + escHtml/escQuote, Min portfölj, portföljgraf och portföljgenomlysning.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ SEARCH ══════════
const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');

let searchTimer = null;
let searchSeq = 0;

// ══════════ PORTFÖLJ (Avanza-import) ══════════
let portfolio = loadPortfolioLocal();
let pfParsed = [];

function loadPortfolioLocal(){ try{ const s=localStorage.getItem('portfolio'); if(s) return JSON.parse(s); }catch(e){} return []; }
function savePortfolioLocal(){ try{ localStorage.setItem('portfolio', JSON.stringify(portfolio)); }catch(e){} }

// Likvida medel (kontanter) – sparas lokalt, läggs till i totalvärdet.
let portfolioCash = (function(){ const v = parseFloat(localStorage.getItem('portfolio_cash')||''); return isFinite(v) ? v : 0; })();
function setCash(v){
  const n = pfNum(v); portfolioCash = n != null ? n : 0;
  try { localStorage.setItem('portfolio_cash', String(portfolioCash)); } catch(e){}
  renderPortfolio();
}

// Börskod (MIC från Avanzas "Marknad") → Yahoo-suffix. '' = USA (inget suffix).
const MIC_SUFFIX = { XNYS:'', XNAS:'', ARCX:'', BATS:'', XASE:'', PINX:'', OTCM:'',
  XPAR:'.PA', XSTO:'.ST', XNGM:'.ST', FNSE:'.ST', XSAT:'.ST', XETR:'.DE', XFRA:'.DE',
  XLON:'.L', XAMS:'.AS', XBRU:'.BR', XHEL:'.HE', XCSE:'.CO', XOSL:'.OL', MERK:'.OL',
  XMIL:'.MI', XMAD:'.MC', XSWX:'.SW', XVTX:'.SW', XTSE:'.TO', XTSX:'.V', XLIS:'.LS',
  XWBO:'.VI', XIST:'.IS', XDUB:'.IR', XHKG:'.HK', XTKS:'.T' };
// Valuta → Yahoo FX-symbol (1 enhet i SEK).
const FX_SYMBOL = { USD:'SEK=X', EUR:'EURSEK=X', GBP:'GBPSEK=X', DKK:'DKKSEK=X',
  NOK:'NOKSEK=X', CAD:'CADSEK=X', CHF:'CHFSEK=X', JPY:'JPYSEK=X', PLN:'PLNSEK=X',
  ZAR:'ZARSEK=X', ILS:'ILSSEK=X', HKD:'HKDSEK=X', AUD:'AUDSEK=X' };

// Yahoos prisvaluta kan vara en minorenhet (pence, cent). Normalisera till
// huvudvaluta + delare. GBp/GBX = pence (÷100) osv – annars blir London-aktier
// (som prissätts i pence) 100× för dyra.
function normPriceCurrency(cur){
  const c = (cur || '').trim();
  const minor = { GBp:['GBP',100], GBX:['GBP',100], ZAc:['ZAR',100], ILA:['ILS',100], ZAX:['ZAR',100] };
  if(minor[c]) return { ccy: minor[c][0], div: minor[c][1] };
  return { ccy: c.toUpperCase(), div: 1 };
}

// Tolka svenskt tal ("36 622", "1 483,50") → number.
function pfNum(s){
  if(s==null) return null;
  const n = parseFloat(String(s).replace(/ /g,'').replace(/\s/g,'').replace(',', '.').replace(/[^0-9.\-]/g,''));
  return isFinite(n) ? n : null;
}

function avanzaToYahoo(kortnamn, marknad){
  const base = (kortnamn||'').trim().toUpperCase().replace(/\s+/g,'-');
  if(!base) return '';
  const suf = MIC_SUFFIX[(marknad||'').trim().toUpperCase()];
  return base + (suf != null ? suf : '');
}

// Dela en rad i celler med citattecken-hantering.
function splitDelimLine(line, delim){
  const out = []; let cur = '', q = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(q){ if(ch === '"'){ if(line[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if(ch === '"') q = true; else if(ch === delim){ out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Text (CSV-fil eller inklistrad tabell) → rader av celler. Väljer avgränsare
// automatiskt: tab, semikolon eller komma; annars 2+ mellanslag (visuell tabell).
function parseCellRows(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if(!lines.length) return [];
  const headerLine = lines.find(l => /namn/i.test(l)) || lines[0];
  let delim = null;
  if(headerLine.includes('\t')) delim = '\t';
  else if((headerLine.match(/;/g) || []).length >= 2) delim = ';';
  else if((headerLine.match(/,/g) || []).length >= 2) delim = ',';
  if(delim) return lines.map(l => splitDelimLine(l, delim));
  return lines.map(l => l.split(/ {2,}/).map(s => s.trim())); // sista utväg
}

const ISIN_RE = /\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/;

function ingestPortfolioCells(cellRows){
  const mapEl = document.getElementById('pf-map');
  if(!cellRows.length){ mapEl.innerHTML = '<div class="info-msg">Tom fil eller inklistring.</div>'; return; }
  let hi = cellRows.findIndex(c => c.some(x => /^\s*namn\s*$/i.test(x)) && c.some(x => /(kortnamn|isin|volym|antal|marknad)/i.test(x)));
  if(hi < 0) hi = 0;
  const header = cellRows[hi].map(c => c.trim().toLowerCase());
  const find = (...names) => {
    for(const n of names){ const i = header.indexOf(n); if(i >= 0) return i; }
    for(const n of names){ const i = header.findIndex(h => h.includes(n)); if(i >= 0) return i; }
    return -1;
  };
  const idx = { namn:find('namn'), kort:find('kortnamn'), vol:find('volym','antal'),
    gav:find('gav'), val:find('valuta'), isin:find('isin'), mark:find('marknad'),
    mv:find('marknadsvärde','marknadsvarde') };
  const rows = [];
  for(let i = hi+1; i < cellRows.length; i++){
    const c = cellRows[i].map(x => x.trim());
    if(c.length < 2) continue;
    const namn = idx.namn >= 0 ? c[idx.namn] : c[0];
    if(!namn || /^(summa|totalt|total)/i.test(namn)) continue;
    let isin = idx.isin >= 0 ? c[idx.isin] : '';
    if(!ISIN_RE.test(isin)){ const hit = c.map(x => (x.match(ISIN_RE) || [])[0]).find(Boolean); if(hit) isin = hit; }
    const kort = idx.kort >= 0 ? c[idx.kort] : '';
    const marknad = idx.mark >= 0 ? c[idx.mark] : '';
    rows.push({
      namn, kort, isin, marknad,
      qty: pfNum(idx.vol >= 0 ? c[idx.vol] : null),
      gav: pfNum(idx.gav >= 0 ? c[idx.gav] : null),
      mv: pfNum(idx.mv >= 0 ? c[idx.mv] : null),
      currency: (idx.val >= 0 ? c[idx.val] : '') || '',
      ticker: avanzaToYahoo(kort, marknad)
    });
  }
  pfParsed = rows;
  renderPortfolioMap();
}

function parsePortfolioPaste(){
  const raw = (document.getElementById('pf-paste').value || '').trim();
  if(!raw){ document.getElementById('pf-map').innerHTML = '<div class="info-msg">Klistra in tabellen eller välj en CSV-fil först.</div>'; return; }
  ingestPortfolioCells(parseCellRows(raw));
}

function importPortfolioFile(input){
  const f = input.files && input.files[0];
  if(!f) return;
  const rd = new FileReader();
  rd.onload = () => { try { ingestPortfolioCells(parseCellRows(String(rd.result || ''))); } catch(e){ alert('Kunde inte läsa filen: ' + e.message); } };
  rd.onerror = () => alert('Kunde inte läsa filen.');
  rd.readAsText(f);
  input.value = '';
}

// Yahoo spark klarar inte hur många symboler som helst i ett anrop – dela upp.
async function fetchQuotesChunked(tickers){
  const out = {};
  for(let i = 0; i < tickers.length; i += 15){
    try { Object.assign(out, await fetchSparkData(tickers.slice(i, i+15))); } catch(e){}
  }
  return out;
}

// Per-ticker fundamenta via /api/quote (ett anrop/ticker, 8 parallellt): analytikernas
// köp/håll/sälj, P/E, direktavkastning, börsvärde och sektor – till valbara tabellkolumner.
// Används av både portföljen och bevakningslistan; den senare visar även
// nyckeltalen som annars bara finns i aktiescreenern (Fwd P/E, P/B, EPS, 52v, volym).
// Yahoo levererar procentfälten som bråkdelar (0.0032 = 0,32 %) – därför ×100.
async function fetchHoldingInfo(tickers){
  const g = x => (x && typeof x === 'object') ? x.raw : x;
  const out = {};
  for(let i = 0; i < tickers.length; i += 8){
    const chunk = tickers.slice(i, i + 8);
    await Promise.all(chunk.map(async t => {
      try {
        const r = await fetch('/api/quote?symbol=' + encodeURIComponent(t));
        const j = await r.json();
        const res = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
        if(!res) return;
        const sd = res.summaryDetail || {}, pr = res.price || {}, ap = res.assetProfile || {};
        const ks = res.defaultKeyStatistics || {};
        const tr = res.recommendationTrend && res.recommendationTrend.trend;
        const cur = Array.isArray(tr) ? (tr.find(x => x.period === '0m') || tr[0]) : null;
        let rec = null;
        if(cur){
          const buy = (cur.strongBuy||0)+(cur.buy||0), hold = cur.hold||0, sell = (cur.sell||0)+(cur.strongSell||0);
          if(buy + hold + sell > 0) rec = { buy, hold, sell };
        }
        const pe = g(sd.trailingPE);
        const dy = g(sd.dividendYield); const divy = dy != null ? +(dy*100).toFixed(2) : null;
        const mc = g(pr.marketCap) != null ? g(pr.marketCap) : g(sd.marketCap);
        const chg = g(pr.regularMarketChangePercent);
        const w52 = g(ks['52WeekChange']);
        // Insynshandel följer med utan extra anrop – /api/quote begär redan modulen.
        // Tomt för icke-US-bolag; de hämtas från FI i loadWatchlistInsyn().
        const insyn = insynSummering((((res.insiderTransactions || {}).transactions) || [])
          .map(x => ({ datum: (x.startDate && x.startDate.fmt) || null, text: x.transactionText || '' })));
        out[t] = { rec, insyn, langtNamn: pr.longName || pr.shortName || null,
          pe: pe != null ? +pe.toFixed(1) : null, divy,
          mcap: mc != null ? Math.round(mc/1e9) : null, sektor: ap.sector || null,
          price: g(pr.regularMarketPrice), valuta: pr.currency || sd.currency || null,
          marknad: pr.exchangeName || pr.fullExchangeName || null,
          dag: chg != null ? +(chg*100).toFixed(2) : null,
          ar52: w52 != null ? +(w52*100).toFixed(1) : null,
          hi52: g(sd.fiftyTwoWeekHigh), lo52: g(sd.fiftyTwoWeekLow),
          fpe: g(sd.forwardPE), pb: g(ks.priceToBook),
          eps: g(ks.trailingEps), fwdeps: g(ks.forwardEps),
          volym: g(sd.volume), avgvol: g(sd.averageVolume) };
      } catch(e){}
    }));
  }
  return out;
}

function renderPortfolioMap(){
  const el = document.getElementById('pf-map');
  if(!pfParsed.length){ el.innerHTML = '<div class="info-msg">Hittade inga rader. Kontrollera att du kopierade hela tabellen (inkl. rubrikraden med Namn/Kortnamn/ISIN).</div>'; return; }
  const rows = pfParsed.map((r,i) => `
    <tr>
      <td style="text-align:center"><input type="checkbox" id="pf-inc-${i}" checked></td>
      <td>${escHtml(r.namn)}</td>
      <td><input id="pf-tk-${i}" value="${escHtml(r.ticker)}" style="width:120px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:4px 6px;font-family:var(--mono);font-size:12px"></td>
      <td style="text-align:right">${r.qty != null ? fmtSekNum(r.qty,0) : '–'}</td>
      <td style="text-align:right">${r.gav != null ? fmtSekNum(r.gav,2) : '–'} ${escHtml(r.currency)}</td>
      <td style="font-size:11px;color:var(--text3);font-family:var(--mono)">${escHtml(r.isin)}</td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="pf-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:12px;flex-wrap:wrap">
        <div style="font-weight:600">Kontrollera tickers (${pfParsed.length} innehav)</div>
        <div style="display:flex;gap:8px">
          <button class="action-btn" onclick="verifyPortfolioTickers(this)">Verifiera via Yahoo</button>
          <button class="action-btn" onclick="savePortfolio()">Spara portfölj</button>
        </div>
      </div>
      <div style="overflow-x:auto"><table class="pf-table">
        <thead><tr><th></th><th style="text-align:left">Namn</th><th style="text-align:left">Yahoo-ticker</th><th style="text-align:right">Antal</th><th style="text-align:right">GAV</th><th style="text-align:left">ISIN</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="info-msg" style="margin-top:10px">Justera Yahoo-tickern om någon ser fel ut (t.ex. <b>VOLV-B.ST</b>, <b>CS.PA</b>, <b>AMZN</b>). <b>Verifiera via Yahoo</b> slår upp varje ISIN och fyller i rätt symbol automatiskt. Bocka ur innehav du inte vill spara.</div>
    </div>`;
}

// ISIN-landskod → Yahoo-suffix för hemmabörsen ('' = USA, inget suffix).
const ISIN_CC_SUFFIX = { US:'', GB:'.L', FR:'.PA', DE:'.DE', SE:'.ST', DK:'.CO', NO:'.OL',
  FI:'.HE', NL:'.AS', CH:'.SW', IT:'.MI', ES:'.MC', CA:'.TO', BE:'.BR', PT:'.LS',
  AT:'.VI', IE:'.IR', JP:'.T', HK:'.HK', AU:'.AX' };

// Välj bästa Yahoo-symbol bland sökträffar: undvik sifferprefix (1GOOGL.MI),
// föredra hemmabörsen för ISIN-landet, och aktie/ETF framför annat.
function pickBestQuote(quotes, row){
  const cc = (row.isin || '').slice(0,2).toUpperCase();
  const want = ISIN_CC_SUFFIX[cc]; // kan vara '' (USA) eller undefined (okänt land)
  const scored = quotes.map(q => {
    const sym = q.symbol || ''; let s = 0;
    if(/^[0-9]/.test(sym)) s -= 5;                       // undvik t.ex. 1GOOGL.MI
    const dot = sym.indexOf('.'); const suf = dot >= 0 ? sym.slice(dot) : '';
    if(want != null && suf === want) s += 4;             // rätt hemmabörs
    if(!suf) s += 1;                                     // USA-notering allt annat lika
    if(q.quoteType === 'EQUITY') s += 1;
    return { sym, s };
  }).sort((a,b) => b.s - a.s);
  return scored[0] && scored[0].sym;
}

async function resolveBestTicker(row){
  for(const q of [row.isin, row.namn].filter(Boolean)){
    let quotes = [];
    try {
      const j = await fetchYahoo(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`);
      quotes = (j.quotes || []).filter(x => x.symbol && ['EQUITY','ETF','MUTUALFUND'].includes(x.quoteType));
    } catch(e){}
    if(quotes.length){ const best = pickBestQuote(quotes, row); if(best) return best; }
  }
  return '';
}

// Behåll tickers som redan ger kursdata (t.ex. rätt hemmabörs från Kortnamn+Marknad);
// slå bara upp de som saknar data. Så klobbras inte GOOGL till 1GOOGL.MI m.m.
async function verifyPortfolioTickers(btn){
  const old = btn.textContent; btn.disabled = true;
  btn.textContent = 'Kontrollerar kurser…';
  const inputs = pfParsed.map((_,i) => document.getElementById('pf-tk-'+i));
  const cur = [...new Set(inputs.map(inp => inp && inp.value.trim()).filter(Boolean))];
  const have = await fetchQuotesChunked(cur);
  let n = 0;
  for(let i = 0; i < pfParsed.length; i++){
    const inp = inputs[i]; if(!inp) continue;
    const tk = inp.value.trim();
    if(tk && have[tk] && have[tk].price != null) continue; // fungerar redan – rör inte
    n++; btn.textContent = `Slår upp saknade (${n})…`;
    const cand = await resolveBestTicker(pfParsed[i]);
    if(cand) inp.value = cand;
  }
  btn.textContent = old; btn.disabled = false;
}

async function savePortfolio(){
  const raw = [];
  pfParsed.forEach((r,i) => {
    const inc = document.getElementById('pf-inc-'+i); if(inc && !inc.checked) return;
    const tk = (document.getElementById('pf-tk-'+i)?.value || '').trim();
    if(!tk) return;
    raw.push({ ticker: tk, name: r.namn, isin: r.isin, qty: r.qty, gav: r.gav, mv: r.mv, currency: r.currency });
  });
  if(!raw.length){ alert('Inga innehav valda att spara.'); return; }
  // Slå ihop rader med samma ticker (samma aktie på flera konton – "Alla konton"):
  // summera antal och räkna viktad GAV. Krävs, annars krockar unika (user_id,ticker).
  const byT = new Map();
  for(const h of raw){
    const ex = byT.get(h.ticker);
    if(!ex){ byT.set(h.ticker, { ...h }); continue; }
    const q1 = ex.qty || 0, q2 = h.qty || 0, tot = q1 + q2;
    if(ex.gav != null && h.gav != null && tot > 0) ex.gav = +(((ex.gav*q1 + h.gav*q2)/tot).toFixed(4));
    else if(ex.gav == null) ex.gav = h.gav;
    ex.qty = tot || ex.qty;
    if(ex.mv != null || h.mv != null) ex.mv = (ex.mv || 0) + (h.mv || 0);
    if(!ex.currency) ex.currency = h.currency;
    if(!ex.name) ex.name = h.name;
  }
  const list = [...byT.values()];
  portfolio = list;
  savePortfolioLocal();
  const res = await pushPortfolioCloud(list);
  document.getElementById('pf-paste').value = '';
  document.getElementById('pf-map').innerHTML = '';
  pfParsed = [];
  await renderPortfolio();
  if(res && res.ok === false) alert('Portföljen sparades lokalt, men molnsynk misslyckades: ' + (res.error || 'okänt fel') + '\nInnehaven visas ändå.');
}

async function pushPortfolioCloud(list){
  if(!sb || !currentUser) return { ok: true, skipped: true };
  try {
    // Upsert (uppdatera/lägg till) – raderar inte först, så inget wipe:as om det fallerar.
    const rows = list.map(h => ({ user_id: currentUser.id, ticker: h.ticker, name: h.name || null,
      isin: h.isin || null, quantity: h.qty, gav: h.gav, currency: h.currency || null }));
    const { error } = await sb.from('portfolio').upsert(rows, { onConflict: 'user_id,ticker' });
    if(error){ console.warn('portfolio upsert:', error.message); return { ok: false, error: error.message }; }
    // Ta bort innehav som inte längre finns kvar (utan att röra det vi just sparat).
    const existing = await sb.from('portfolio').select('ticker').eq('user_id', currentUser.id);
    if(existing.data){
      const keep = new Set(list.map(h => h.ticker));
      const stale = existing.data.map(r => r.ticker).filter(t => !keep.has(t));
      if(stale.length) await sb.from('portfolio').delete().eq('user_id', currentUser.id).in('ticker', stale);
    }
    return { ok: true };
  } catch(e){ console.warn('portfolio push:', e.message); return { ok: false, error: e.message }; }
}
async function pullPortfolioCloud(){
  if(!sb || !currentUser) return null;
  const { data, error } = await sb.from('portfolio').select('ticker,name,isin,quantity,gav,currency').order('name');
  if(error){ console.warn('portfolio pull:', error.message); return null; }
  return data.map(r => ({ ticker: r.ticker, name: r.name, isin: r.isin, qty: r.quantity, gav: r.gav, currency: r.currency }));
}

async function removeHolding(tk){
  portfolio = portfolio.filter(h => h.ticker !== tk);
  savePortfolioLocal();
  if(sb && currentUser){ try { await sb.from('portfolio').delete().eq('user_id', currentUser.id).eq('ticker', tk); } catch(e){} }
  renderPortfolio();
}

// Sortering av portföljtabellen (klickbara rubriker). Standard: värde fallande.
let pfSort = { col: 'value', dir: 'desc' };
let pfEnriched = [];
function sortPortfolio(col){
  if(pfSort.col === col) pfSort.dir = pfSort.dir === 'asc' ? 'desc' : 'asc';
  else pfSort = { col, dir: col === 'name' ? 'asc' : 'desc' };
  renderPortfolioTable();
}
function renderPortfolioTable(){
  const wrap = document.getElementById('pf-table-wrap'); if(!wrap) return;
  const dir = pfSort.dir === 'asc' ? 1 : -1;
  const total = pfEnriched.reduce((s,r) => s + (r.valSek || 0), 0);
  const ctx = { total };
  const getk = pfSort.col === 'name' ? (r=>r.name)
    : (PF_COL_DEFS[pfSort.col] ? (r => PF_COL_DEFS[pfSort.col].val(r, ctx)) : (r => r.valSek));
  const sorted = pfEnriched.slice().sort((a,b) => {
    const va = getk(a), vb = getk(b);
    if(va == null && vb == null) return 0;
    if(va == null) return 1; if(vb == null) return -1;
    if(typeof va === 'string' && typeof vb === 'string') return va < vb ? -dir : va > vb ? dir : 0;
    return (va - vb) * dir;
  });
  const arrow = c => pfSort.col === c ? (pfSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const s = 'cursor:pointer;user-select:none';
  const periodChips = PF_PERIODS.map(([p,lbl]) =>
    `<div class="filter-chip${p===pfPeriod?' on':''}" onclick="setPfPeriod('${p}')">${lbl}</div>`).join('');
  const headCells = pfVisibleCols.map(k =>
    `<th style="text-align:${PF_COL_DEFS[k].align||'right'};${s}" onclick="sortPortfolio('${k}')">${escHtml(pfColLabel(k))}${arrow(k)}</th>`).join('');
  const bodyRows = sorted.map(r => `<tr onclick="loadStock('${escQuote(r.h.ticker)}','${escQuote(r.h.name||r.h.ticker)}')" style="cursor:pointer">
      <td>${escHtml(r.h.name||r.h.ticker)}<div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${escHtml(r.h.ticker)}</div></td>
      ${pfVisibleCols.map(k => PF_COL_DEFS[k].cell(r, ctx)).join('')}
      <td style="text-align:center"><button class="wl-remove" title="Ta bort" onclick="event.stopPropagation();removeHolding('${escQuote(r.h.ticker)}')" style="opacity:.6">×</button></td>
    </tr>`).join('');
  wrap.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div class="filter-row" style="margin:0;align-items:center"><span style="font-size:12px;color:var(--text3)">Utveckling:</span>${periodChips}</div>
      <div style="position:relative">
        <button class="filter-input" onclick="togglePfColMenu()" style="width:auto;cursor:pointer">⚙ Kolumner</button>
        <div id="pf-col-menu" class="col-menu" style="display:none;left:auto;right:0"></div>
      </div>
    </div>
    <div style="overflow-x:auto"><table class="pf-table">
    <thead><tr>
      <th style="text-align:left;${s}" onclick="sortPortfolio('name')">Innehav${arrow('name')}</th>
      ${headCells}
      <th></th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>`;
}

// Utveckling över en period ur en 1-årsserie {dates,closes}. Hittar stängningen
// på/före måldatumet och jämför med senaste. ÅTD = från årets första handelsdag.
function pfReturn(series, period){
  if(!series || !series.closes || series.closes.length < 2) return null;
  const { dates, closes } = series;
  const lastC = closes[closes.length - 1], lastD = dates[dates.length - 1];
  let target;
  if(period === 'ytd'){ target = lastD.slice(0,4) + '-01-01'; }
  else { const days = period === '1w' ? 7 : period === '1mo' ? 30 : period === '2y' ? 730 : period === '5y' ? 1825 : 365;
    const d = new Date(lastD + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); target = d.toISOString().slice(0,10); }
  let idx = -1;
  for(let i = 0; i < dates.length; i++){ if(dates[i] <= target) idx = i; else break; }
  if(idx < 0) idx = 0; // måldatum före seriestart → använd första kända kurs
  const baseC = closes[idx];
  return (baseC != null && baseC !== 0) ? (lastC/baseC - 1)*100 : null;
}

// Valbar utvecklingsperiod för portföljtabellen.
let pfPeriod = '1d';
const PF_PERIODS = [['1d','1 dag'],['1w','1 vecka'],['1mo','1 mån'],['ytd','ÅTD'],['1y','1 år'],['2y','2 år'],['5y','5 år']];
const pfPeriodLabel = () => (PF_PERIODS.find(p => p[0] === pfPeriod) || PF_PERIODS[0])[1];
function setPfPeriod(p){ pfPeriod = p; renderPortfolioTable(); }

// Valbara kolumner i portföljtabellen (Innehav visas alltid först, × alltid sist).
// Samma mönster som aktiescreenerns ⚙ Kolumner. label kan vara en funktion (period).
const PF_COL_DEFS = {
  qty:    { label:'Antal', val:r=>r.h.qty, cell:r=>`<td style="text-align:right">${r.h.qty!=null?fmtSekNum(r.h.qty,0):'–'}</td>` },
  gav:    { label:'GAV', val:r=>r.h.gav, cell:r=>`<td style="text-align:right">${r.h.gav!=null?fmtSekNum(r.h.gav,2):'–'} ${escHtml(r.h.currency||'')}</td>` },
  price:  { label:'Kurs', val:r=>r.price, cell:r=>`<td style="text-align:right">${r.price!=null?fmtSekNum(r.price,2):'–'}</td>` },
  change: { label:()=>pfPeriodLabel(), val:r=>r.rets?r.rets[pfPeriod]:null,
    cell:r=>{const c=r.rets?r.rets[pfPeriod]:null;const col=c==null?'var(--text3)':(c>=0?'var(--green)':'var(--red)');return `<td style="text-align:right;color:${col}">${c!=null?fmtSekPct(c):'–'}</td>`;} },
  gain:   { label:'Sedan köp', val:r=>r.gain,
    cell:r=>{const col=r.gain==null?'var(--text3)':(r.gain>=0?'var(--green)':'var(--red)');return `<td style="text-align:right;color:${col}">${r.gain!=null?fmtSekPct(r.gain):'–'}</td>`;} },
  weight: { label:'Andel', val:(r,c)=>c.total?(r.valSek/c.total*100):null,
    cell:(r,c)=>{const w=(c.total&&r.valSek!=null)?(r.valSek/c.total*100):null;return `<td style="text-align:right">${w!=null?w.toFixed(1)+'%':'–'}</td>`;} },
  plkr:   { label:'Vinst/förlust', val:r=>r.plSek,
    cell:r=>{const v=r.plSek;const col=v==null?'var(--text3)':(v>=0?'var(--green)':'var(--red)');return `<td style="text-align:right;color:${col}">${v!=null?(v>=0?'+':'')+fmtSekNum(v,0)+' kr':'–'}</td>`;} },
  rec:    { label:'Analytiker', val:r=>r.recBuy,
    cell:r=>{if(!r.rec)return '<td style="text-align:right"><span style="color:var(--text3)">–</span></td>';const t=r.rec.buy+r.rec.hold+r.rec.sell;return `<td style="text-align:right;white-space:nowrap;font-size:12px"><span style="color:var(--green)">${r.rec.buy} köp</span> · ${r.rec.hold} håll · <span style="color:var(--red)">${r.rec.sell} sälj</span><div style="font-size:10px;color:var(--text3)">${t} analytiker</div></td>`;} },
  pe:     { label:'P/E', val:r=>r.pe, cell:r=>`<td style="text-align:right">${r.pe!=null?r.pe.toFixed(1):'–'}</td>` },
  div:    { label:'Direktavk.', val:r=>r.divy, cell:r=>`<td style="text-align:right">${(r.divy!=null&&r.divy>0)?r.divy.toFixed(1)+'%':'–'}</td>` },
  mcap:   { label:'Börsvärde', val:r=>r.mcap, cell:r=>`<td style="text-align:right;color:var(--text2);font-size:12px">${r.mcap!=null?(r.mcap>=1000?(r.mcap/1000).toFixed(1)+'T':r.mcap+'B'):'–'}</td>` },
  sektor: { label:'Sektor', align:'left', val:r=>r.sektor||'', cell:r=>`<td style="color:var(--text2);font-size:12px">${escHtml(r.sektor||'–')}</td>` },
  valuta: { label:'Valuta', align:'left', val:r=>r.priceCcy||'', cell:r=>`<td style="color:var(--text2);font-size:12px">${escHtml(r.priceCcy||'–')}</td>` },
  avanza: { label:'Avanza-värde', val:r=>r.h.mv, cell:r=>`<td style="text-align:right;color:var(--text2)">${r.h.mv!=null?fmtSekNum(r.h.mv,0)+' kr':'–'}</td>` },
  value:  { label:'Värde', val:r=>r.valSek, cell:r=>{const col=r.off?'var(--red)':'var(--text)';return `<td style="text-align:right;color:${col}">${r.off?'⚠ ':''}${r.valSek!=null?fmtSekNum(r.valSek,0)+' kr':'–'}</td>`;} },
};
const PF_COL_ORDER = ['qty','gav','price','change','gain','weight','plkr','rec','pe','div','mcap','sektor','valuta','avanza','value'];
const PF_DEFAULT_COLS = ['qty','gav','price','change','gain','rec','value'];
const pfColLabel = k => { const l = PF_COL_DEFS[k].label; return typeof l === 'function' ? l() : l; };

function getPfCols(){
  try { const s = JSON.parse(localStorage.getItem('pfCols')); if(Array.isArray(s) && s.length) return PF_COL_ORDER.filter(k => s.includes(k)); } catch(e){}
  return PF_DEFAULT_COLS.slice();
}
let pfVisibleCols = getPfCols();
function savePfCols(){ try { localStorage.setItem('pfCols', JSON.stringify(pfVisibleCols)); } catch(e){} }
function togglePfColMenu(){ const m = document.getElementById('pf-col-menu'); const show = m.style.display === 'none'; m.style.display = show ? 'block' : 'none'; if(show) renderPfColMenu(); }
function renderPfColMenu(){ document.getElementById('pf-col-menu').innerHTML = PF_COL_ORDER.map(k =>
  `<label><input type="checkbox" ${pfVisibleCols.includes(k)?'checked':''} onchange="togglePfCol('${k}')"> ${pfColLabel(k)}</label>`).join(''); }
function togglePfCol(k){
  if(pfVisibleCols.includes(k)){ if(pfVisibleCols.length <= 1) return; pfVisibleCols = pfVisibleCols.filter(x => x !== k); }
  else pfVisibleCols = PF_COL_ORDER.filter(x => pfVisibleCols.includes(x) || x === k);
  savePfCols(); renderPortfolioTable(); renderPfColMenu();
}

async function renderPortfolio(){
  const view = document.getElementById('pf-view');
  if(!view) return;
  if(sb && currentUser){ const cloud = await pullPortfolioCloud(); if(cloud && cloud.length){ portfolio = cloud; savePortfolioLocal(); } }
  if(!portfolio.length){ view.innerHTML = '<div class="info-msg">Ingen portfölj sparad än. Klistra in dina innehav från Avanza ovan och tryck Tolka → Spara.</div>'; return; }
  view.innerHTML = '<div class="info-msg">Hämtar kurser…</div>';
  const tickers = [...new Set(portfolio.map(h => h.ticker))];
  let quotes = await fetchQuotesChunked(tickers);
  // Fundamenta per innehav (analytiker, P/E, direktavk., börsvärde, sektor) – parallellt.
  const infoPromise = fetchHoldingInfo(tickers);
  // 5-årshistorik för utveckling över valbara perioder (1v … 5år) i tabellen.
  const histPromise = fetchSparkSeries(tickers, '5y');
  // Valutakurser baseras på Yahoos EGEN prisvaluta per innehav (inte Avanzas etikett),
  // så pence/cent och felnoteringar hanteras rätt.
  const priceCcys = [...new Set(Object.values(quotes).map(q => normPriceCurrency(q.currency).ccy).filter(c => c && c !== 'SEK'))];
  const avanzaCcys = portfolio.map(h => (h.currency||'SEK').toUpperCase()).filter(c => c && c !== 'SEK');
  const allCcys = [...new Set([...priceCcys, ...avanzaCcys])];
  const fxSyms = [...new Set(allCcys.map(c => FX_SYMBOL[c]).filter(Boolean))];
  let fx = {};
  if(fxSyms.length){ try { const fd = await fetchSparkData(fxSyms); allCcys.forEach(c => { const s = FX_SYMBOL[c]; if(s && fd[s]) fx[c] = fd[s].price; }); } catch(e){} }
  const rateOf = c => { c = (c||'SEK').toUpperCase(); if(c === 'SEK') return 1; return fx[c] != null ? fx[c] : null; };
  const info = await infoPromise;
  const hist = await histPromise;

  const hasMv = portfolio.some(h => h.mv != null);
  let totalSek = 0, totalCostSek = 0, totalMv = 0, partial = false;
  const outliers = [];
  pfEnriched = portfolio.map(h => {
    const q = quotes[h.ticker], day = q ? q.day : null;
    // Normalisera kursen till huvudvaluta (pence→pund) och räkna om med Yahoos valuta.
    const pc = q && q.currency ? normPriceCurrency(q.currency) : null;
    const price = q && q.price != null ? (pc ? q.price / pc.div : q.price) : null;
    const priceCcy = pc ? pc.ccy : (h.currency||'SEK').toUpperCase();
    const rate = rateOf(priceCcy);
    const gavRate = rateOf(h.currency);
    const valSek = (price != null && h.qty != null && rate != null) ? price*h.qty*rate : null;
    const costSek = (h.gav != null && h.qty != null && gavRate != null) ? h.gav*h.qty*gavRate : null;
    if(valSek != null) totalSek += valSek; else partial = true;
    if(costSek != null) totalCostSek += costSek;
    if(h.mv != null) totalMv += h.mv;
    const gain = (price != null && h.gav) ? ((price - h.gav)/h.gav)*100 : null;
    // Jämför vårt live-värde med Avanzas importerade marknadsvärde – stor avvikelse
    // = troligen fel börs/valuta på tickern.
    const diff = (valSek != null && h.mv) ? ((valSek - h.mv)/h.mv)*100 : null;
    const off = diff != null && Math.abs(diff) > 10;
    if(off) outliers.push(`${h.name||h.ticker} (${h.ticker}): vårt ${fmtSekNum(valSek,0)} kr vs Avanza ${fmtSekNum(h.mv,0)} kr`);
    const inf = info[h.ticker] || {};
    const rec = inf.rec || null;
    const plSek = (valSek != null && costSek != null) ? valSek - costSek : null;
    // Utveckling över flera perioder ur 5-årshistoriken (1 dag kommer från kursanropet).
    const s = hist[h.ticker];
    const rets = { '1d': day, '1w': pfReturn(s,'1w'), '1mo': pfReturn(s,'1mo'), 'ytd': pfReturn(s,'ytd'),
                   '1y': pfReturn(s,'1y'), '2y': pfReturn(s,'2y'), '5y': pfReturn(s,'5y') };
    return { h, price, valSek, gain, off, rec, recBuy: rec ? rec.buy : null, plSek, priceCcy,
      pe: inf.pe != null ? inf.pe : null, divy: inf.divy != null ? inf.divy : null,
      mcap: inf.mcap != null ? inf.mcap : null, sektor: inf.sektor || null,
      rets, name: (h.name||h.ticker).toLowerCase() };
  });
  const totalGain = totalCostSek > 0 ? ((totalSek - totalCostSek)/totalCostSek)*100 : null;
  view.innerHTML = `
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Totalt värde${partial ? ' (delvis)' : ''}</div><div class="kpi-value">${fmtSekNum(totalSek + portfolioCash,0)} kr</div>${portfolioCash ? `<div class="kpi-sub muted">varav värdepapper ${fmtSekNum(totalSek,0)} kr</div>` : ''}</div>
      <div class="kpi-card"><div class="kpi-label">Likvida medel</div><input type="text" value="${portfolioCash ? fmtSekNum(portfolioCash,0) : ''}" placeholder="0" onchange="setCash(this.value)" style="width:120px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:6px 8px;font-family:var(--mono);font-size:18px;font-weight:600"></div>
      ${hasMv ? `<div class="kpi-card"><div class="kpi-label">Avanza-värde (import)</div><div class="kpi-value">${fmtSekNum(totalMv,0)} kr</div></div>` : ''}
      ${totalGain != null ? `<div class="kpi-card"><div class="kpi-label">Utveckling vs GAV</div><div class="kpi-value" style="color:${totalGain>=0?'var(--green)':'var(--red)'}">${fmtSekPct(totalGain)}</div></div>` : ''}
      <div class="kpi-card"><div class="kpi-label">Antal innehav</div><div class="kpi-value">${portfolio.length}</div></div>
    </div>
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="action-btn" id="pf-review-btn" onclick="runPortfolioReview('portfolio')" title="Portfolio Manager: stresstestar innehaven mot senaste CIO-analysen och riskbarometern">✦ Kör Portföljgenomlysning</button>
      <button class="ghost-btn" onclick="analyzePortfolioAI()">✦ Analysera min portfölj med AI</button>
    </div>
    <div style="margin:-6px 0 12px">${aiGuideHtml('pm')}</div>
    <div id="pf-review-out" class="memo-box"></div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div class="card-title" style="margin:0">Portföljens utveckling <span id="pf-chart-change" style="font-weight:400;font-size:12px"></span></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div class="filter-row" style="margin:0">
            <div class="filter-chip" data-range="1mo" onclick="setPortfolioChartRange('1mo',this)">1M</div>
            <div class="filter-chip on" data-range="6mo" onclick="setPortfolioChartRange('6mo',this)">6M</div>
            <div class="filter-chip" data-range="ytd" onclick="setPortfolioChartRange('ytd',this)">ÅTD</div>
            <div class="filter-chip" data-range="1y" onclick="setPortfolioChartRange('1y',this)">1Å</div>
            <div class="filter-chip" data-range="2y" onclick="setPortfolioChartRange('2y',this)">2Å</div>
            <div class="filter-chip" data-range="5y" onclick="setPortfolioChartRange('5y',this)">5Å</div>
          </div>
          <div class="filter-row" style="margin:0">
            <div class="filter-chip on" data-mode="sek" onclick="setPortfolioChartMode('sek',this)">kr</div>
            <div class="filter-chip" data-mode="pct" onclick="setPortfolioChartMode('pct',this)">%</div>
          </div>
        </div>
      </div>
      <div style="height:220px"><canvas id="pf-chart"></canvas></div>
      <div id="pf-chart-note" style="font-size:11px;color:var(--text3);margin-top:8px"></div>
    </div>
    <div id="pf-table-wrap"></div>
    <div id="pf-analyses"></div>
    ${outliers.length ? `<div class="info-msg" style="margin-top:8px;background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.25);color:var(--red)">⚠ Dessa innehav avviker mycket mot Avanzas värde (trolig fel börs/valuta – kolla tickern):<br>${outliers.map(escHtml).join('<br>')}</div>` : ''}
    ${partial ? '<div class="info-msg" style="margin-top:8px">Vissa värden saknas (okänd kurs eller valutakurs) och räknas inte in i totalen.</div>' : ''}`;
  renderPortfolioTable();
  renderPortfolioAnalyses();
  renderPortfolioChart();
  setUpdatedStamp('stamp-portfolio');
}

// ══════════ PORTFÖLJGRAF ══════════
let portfolioChartRange = '6mo';
let portfolioChartMode = 'sek';   // 'sek' = kronvärde, 'pct' = rebaserad % från start
let portfolioChartInstance = null;

function setPortfolioChartRange(range, el){
  portfolioChartRange = range;
  document.querySelectorAll('#section-portfolio [data-range]').forEach(c => c.classList.remove('on'));
  if(el) el.classList.add('on');
  renderPortfolioChart();
}
function setPortfolioChartMode(mode, el){
  portfolioChartMode = mode;
  document.querySelectorAll('#section-portfolio [data-mode]').forEach(c => c.classList.remove('on'));
  if(el) el.classList.add('on');
  renderPortfolioChart();
}

// Spark med tidsstämplar (fetchSparkData slänger dem). {sym:{dates:[YYYY-MM-DD],closes:[],currency}}
async function fetchSparkSeries(symbols, range){
  const out = {};
  const CHUNK = 15;
  for(let i = 0; i < symbols.length; i += CHUNK){
    const chunk = symbols.slice(i, i + CHUNK);
    let data;
    try { data = await fetchYahoo(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=${range}&interval=1d`); }
    catch(e){ continue; }
    for(const r of (data && data.spark && data.spark.result) || []){
      const resp = r.response && r.response[0]; if(!resp) continue;
      const ts = resp.timestamp || [];
      const cl = (resp.indicators && resp.indicators.quote[0] && resp.indicators.quote[0].close) || [];
      const dates = [], closes = [];
      ts.forEach((t, k) => { if(cl[k] != null){ dates.push(new Date(t*1000).toISOString().slice(0,10)); closes.push(cl[k]); } });
      if(dates.length) out[r.symbol] = { dates, closes, currency: (resp.meta||{}).currency };
    }
  }
  return out;
}

// Forward-fill en serie till en gemensam datumlista (bär senaste kända värde framåt).
// Seedar startvärdet med senaste kända kurs PÅ/FÖRE första datumet – annars blir
// första punkten null för serier som inte handlade exakt på startdagen (t.ex. en
// FX-serie med annan handelskalender), vilket tappar innehav och snedvrider basen.
function denseFill(dates, series){
  const sd = series.dates || [], sc = series.closes || [];
  const map = {}; sd.forEach((d,i) => map[d] = sc[i]);
  let last = null;
  if(dates.length){ for(let i = 0; i < sd.length && sd[i] <= dates[0]; i++) last = sc[i]; }
  const out = [];
  for(const d of dates){ if(map[d] != null) last = map[d]; out.push(last); }
  return out;
}

// Rekonstruerar portföljvärdet över tid utifrån NUVARANDE innehav (appen känner inte
// till historiska köp/sälj). Summerar per dag: kurs × antal × valutakurs, i SEK.
async function renderPortfolioChart(){
  const canvas = document.getElementById('pf-chart'); if(!canvas) return;
  const note = document.getElementById('pf-chart-note');
  const changeEl = document.getElementById('pf-chart-change');
  if(!portfolio.length){ if(portfolioChartInstance){ portfolioChartInstance.destroy(); portfolioChartInstance = null; } if(note) note.textContent = 'Inga innehav att rita.'; return; }
  if(note) note.textContent = 'Hämtar historik…';

  const tickers = [...new Set(portfolio.map(h => h.ticker).filter(Boolean))];
  // Valutor vi behöver FX-serier för. Priset kan vara i minorenhet (pence) – normalisera.
  const series = await fetchSparkSeries(tickers, portfolioChartRange);
  const ccyOf = t => { const s = series[t]; return s && s.currency ? normPriceCurrency(s.currency) : null; };
  const fxCcys = [...new Set(tickers.map(t => { const p = ccyOf(t); return p ? p.ccy : null; }).filter(c => c && c !== 'SEK'))];
  const fxSyms = [...new Set(fxCcys.map(c => FX_SYMBOL[c]).filter(Boolean))];
  const fxSeries = fxSyms.length ? await fetchSparkSeries(fxSyms, portfolioChartRange) : {};

  // Gemensam datumlista (från aktieserierna) + gemensam start = senaste "första dag"
  // bland innehaven, så att alla bidrar från dag ett (annars hoppar kurvan).
  const withData = tickers.filter(t => series[t]);
  if(!withData.length){ if(note) note.textContent = 'Kunde inte hämta historik för innehaven.'; return; }
  const allDates = [...new Set(withData.flatMap(t => series[t].dates))].sort();
  const start = withData.map(t => series[t].dates[0]).sort().pop(); // max av första-datum
  const dates = allDates.filter(d => d >= start);

  const dense = {}; withData.forEach(t => dense[t] = denseFill(dates, series[t]));
  const fxDense = {}; fxSyms.forEach(s => { if(fxSeries[s]) fxDense[s] = denseFill(dates, fxSeries[s]); });

  const values = dates.map((d, i) => {
    let sum = 0;
    for(const h of portfolio){
      const s = series[h.ticker]; if(!s) continue;
      const close = dense[h.ticker][i]; if(close == null || h.qty == null) continue;
      const pc = normPriceCurrency(s.currency); const price = close / pc.div;
      let rate = 1;
      if(pc.ccy !== 'SEK'){ const fs = FX_SYMBOL[pc.ccy]; rate = fs && fxDense[fs] ? fxDense[fs][i] : null; }
      if(rate == null) continue;
      sum += price * h.qty * rate;
    }
    return sum + (portfolioCash || 0);
  });

  const base = values.find(v => v != null), last = values[values.length - 1];
  if(changeEl && base && last){
    const pct = ((last - base) / base) * 100;
    changeEl.innerHTML = `<span style="color:${pct>=0?'var(--green)':'var(--red)'}">${fmtSekPct(pct)}</span> <span class="muted">i perioden</span>`;
  }
  const dropped = tickers.length - withData.length;
  if(note) note.textContent = `Rekonstruerat utifrån dina nuvarande innehav (${withData.length} bolag${dropped?`, ${dropped} utan historik`:''})${portfolioCash?' + likvida medel':''} – historiska köp/sälj ingår inte. Källa: Yahoo Finance.`;

  // Procent-läge: rebasera mot första punkten (= 0 %). Annars kronvärde.
  const pctMode = portfolioChartMode === 'pct';
  const plotted = values.map(v => v == null ? null : (pctMode ? (base ? (v/base - 1)*100 : null) : Math.round(v)));
  const fmtY = pctMode ? (v => fmtSekPct(v)) : (v => fmtSekNum(v, 0) + ' kr');

  if(portfolioChartInstance) portfolioChartInstance.destroy();
  portfolioChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: dates.map(d => d.slice(5)), datasets: [{
      data: plotted,
      borderColor: 'var(--accent)', borderWidth: 2, pointRadius: 0, tension: 0.15,
      fill: true, backgroundColor: 'rgba(79,142,247,0.08)'
    }]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: items => dates[items[0].dataIndex],
        label: c => pctMode ? fmtSekPct(c.raw) : fmtSekNum(c.raw, 0) + ' kr'
      }}},
      scales: {
        x: { ticks: { color: '#6b7280', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: '#6b7280', callback: fmtY }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// Tidigare portföljanalyser, direkt i portföljvyn (samma data som "Sparade
// analyser", filtrerat på titeln "Portföljanalys"). Klick fäller ut hela texten.
async function renderPortfolioAnalyses(){
  const el = document.getElementById('pf-analyses'); if(!el) return;
  let list = aiAnalyses.filter(a => PF_ANALYSIS_TITLES.includes(a.title||''));
  if(sb && currentUser){
    try {
      const { data } = await sb.from('analyses').select('id,created_at,title,model,answer')
        .in('title', PF_ANALYSIS_TITLES).order('created_at', { ascending: false }).limit(50);
      if(data) list = data.map(r => ({ id:r.id, ts:new Date(r.created_at).getTime(), title:r.title, model:r.model, answer:r.answer, cloud:true }));
    } catch(e){}
  }
  if(!list.length){ el.innerHTML = ''; return; }
  const items = list.slice(0, 20).map(a => {
    const d = new Date(a.ts).toLocaleString('sv-SE', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const key = 'pf' + (a.cloud ? ('c'+a.id) : ('l'+a.ts));
    return `<div class="pf-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer" onclick="toggleAnalysis('${key}')">
        <div><div style="font-weight:600">✦ ${escHtml(a.title||'Portföljanalys')}</div><div style="font-size:11px;color:var(--text3)">${d} · ${escHtml((a.model||'').replace('claude-',''))}</div></div>
        <span style="font-size:11px;color:var(--accent)">Visa ▾</span>
      </div>
      <div id="an-${key}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:13px;line-height:1.55"><div class="memo">${formatMemo(a.answer||'')}</div>${screenerPanelHtml(a.answer||'', key)}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<div style="font-weight:600;margin:18px 0 8px">Tidigare AI-analyser av portföljen <span class="muted" style="font-weight:400">· sparas automatiskt</span></div>${items}`;
}

async function analyzePortfolioAI(){
  if(!portfolio.length) return;
  openAI();
  const tickers = [...new Set(portfolio.map(h => h.ticker))];
  let quotes = await fetchQuotesChunked(tickers);
  // Räkna om till SEK i appen (samma logik som portföljvyn) och ge AI:n de
  // färdiga SEK-värdena – annars gissar den valutakurser och får helt fel total.
  const priceCcys = [...new Set(Object.values(quotes).map(q => normPriceCurrency(q.currency).ccy).filter(c => c && c !== 'SEK'))];
  const avanzaCcys = portfolio.map(h => (h.currency||'SEK').toUpperCase()).filter(c => c && c !== 'SEK');
  const allCcys = [...new Set([...priceCcys, ...avanzaCcys])];
  const fxSyms = [...new Set(allCcys.map(c => FX_SYMBOL[c]).filter(Boolean))];
  let fx = {};
  if(fxSyms.length){ try { const fd = await fetchSparkData(fxSyms); allCcys.forEach(c => { const s = FX_SYMBOL[c]; if(s && fd[s]) fx[c] = fd[s].price; }); } catch(e){} }
  const rateOf = c => { c = (c||'SEK').toUpperCase(); if(c === 'SEK') return 1; return fx[c] != null ? fx[c] : null; };
  let totalSek = 0;
  const rows = portfolio.map(h => {
    const q = quotes[h.ticker];
    const pc = q && q.currency ? normPriceCurrency(q.currency) : null;
    const price = q && q.price != null ? (pc ? q.price / pc.div : q.price) : null;
    const rate = rateOf(pc ? pc.ccy : h.currency);
    const valSek = (price != null && h.qty != null && rate != null) ? price*h.qty*rate : null;
    if(valSek != null) totalSek += valSek;
    const gain = (price != null && h.gav) ? (((price - h.gav)/h.gav)*100).toFixed(1)+'%' : '?';
    return { h, valSek, gain };
  });
  const total = totalSek + portfolioCash;
  const lines = rows.map(r => {
    const w = (r.valSek != null && total) ? ((r.valSek/total)*100).toFixed(1)+'%' : '?';
    return `- ${r.h.name||r.h.ticker} (${r.h.ticker}): ${r.h.qty != null ? r.h.qty : '?'} st, värde ${r.valSek != null ? fmtSekNum(r.valSek,0)+' kr' : 'okänt'} (${w} av portföljen), GAV ${r.h.gav != null ? r.h.gav : '?'} ${r.h.currency||''}, sedan köp ${r.gain}`;
  }).join('\n');
  const cashLine = portfolioCash ? `\nLikvida medel (kontanter): ${fmtSekNum(portfolioCash,0)} kr.` : '';
  stageAnalysis(`Här är min aktieportfölj (importerad från Avanza). Alla värden är redan omräknade till SEK av appen – använd dem rakt av, räkna INTE om valutor själv:\n${lines}${cashLine}\n\nTotalt portföljvärde: ${fmtSekNum(total,0)} kr (varav värdepapper ${fmtSekNum(totalSek,0)} kr).\n\nGör en genomlysning: fördelning och koncentration (sektorer, regioner, valutaexponering), de största riskerna, hur väl diversifierad den är, samt konkreta förslag på förbättringar. Lyft fram vilka innehav som ser starka respektive svaga ut just nu.${webSearchOn ? ' Sök gärna på nätet om du behöver aktuell information om enskilda bolag.' : ''}`, 'Portföljanalys');
}

// ══════════ PORTFÖLJGENOMLYSNING (Min portfölj + AI-fond) ══════════
// Sista steget i tratten: en Portfolio Manager som inte tar in rådata själv utan
// bygger på slutsatserna från de tidigare stegen – senaste CIO-analysen och
// riskbarometern – och ställer dem mot innehaven (vikt, sektor, valuta, utveckling).
const PM_MODEL = 'claude-sonnet-5';
const PM_TITLE_PORTFOLIO = 'Portföljgenomlysning · Min portfölj';
const PF_ANALYSIS_TITLES = ['Portföljanalys', PM_TITLE_PORTFOLIO]; // visas även i portföljvyn
const PM_SYSTEM_PROMPT = `Du är Lead Portfolio Manager för en global, absolutavkastande fond. Din uppgift är att
skydda kapitalet i nedgång och maximera riskjusterad avkastning i uppgång. Du är helt
befriad från emotionell anknytning till enskilda aktier; om ett bolag inte passar i
den aktuella makroregimen ska det säljas, oavsett historisk avkastning.

TEKNISKA REGLER:
Du har tillgång till en inskickad portföljstruktur, aktuell riskbarometer och fondens
senaste makro-direktiv (CIO-analysen).

REGEL 1: DU SKALL ALLTID GE SVARET FÖRST OCH SEDAN ANALYSEN.
Börja alltid med skarpa, exekverbara handelsbeslut (Köp/Sälj/Öka/Minska).

Strukturera analysen strikt enligt följande rubriker:

### 1. Portföljåtgärder & Transaktioner (SVARET FÖRST)
- Lista exakta åtgärder i punktform:
  * SÄLJ: [Ticker] - [Kort motivering]
  * MINSKA EXPONERING: [Ticker] från [X]% till [Y]% vikt.
  * KÖP/ÖKA: [Sektor eller Ticker om cash finns]
  * BEHÅLL: (och låt vinsterna löpa)
- Ange målnivå för kassa (Cash-position) i rådande marknadsklimat.

### 2. Makro-Alignment (Stresstest mot CIO-vyn)
- Utvärdera portföljen mot den bifogade CIO-analysen.
- Om CIO-analysen skriker "Risk-av och inflation" men portföljen består av 80% räntekänslig
  förhoppningstech, måste du peka ut denna diskrepans med brutal tydlighet.
- Linjerar den nuvarande sektorallokeringen med de strukturella megatrenderna?

### 3. Koncentrationsrisk & Sårbarhet
- Sektorexponering: Är portföljen för tungt viktad mot en enskild faktor (t.ex. för svag krona,
  Kina-export eller enbart halvledare)?
- Riskbarometern: Givet nuvarande VIX och SKEW, hur stor drawdown (värdetapp) riskerar denna
  portfölj vid en plötslig marknadschock?

### 4. Slakten av "Value Traps" (Döda darlings)
- Identifiera eventuella "losers" i portföljen (innehav med negativ avkastning över tid som
  saknar strukturell medvind).
- Investerare lider av "sunk cost fallacy" och vill ogärna sälja med förlust. Ge det
  rationella argumentet för varför kapitalet ska frigöras och allokeras till bättre risk/reward.

### 5. Strategisk Vägledning (För Screenern)
- Vilka exakta parametrar bör investeraren ställa in i plattformens 'Aktiescreener' idag
  för att hitta bolag som balanserar upp portföljens nuvarande brister?
  (Ge konkreta förslag: t.ex. "Sök efter: Hälsovård, EV/EBITDA < 12, FCF-marginal > 10%, USA-baserat").

### 6. Maskinläsbar Screener-konfiguration
Du MÅSTE avsluta hela ditt svar med ett strikt JSON-objekt omgivet av taggarna
<screener_config> och </screener_config>. Denna JSON ska översätta din strategiska
vägledning i punkt 5 till exakta filter för appens aktiescreener.

Använd ENDAST följande nycklar i din JSON (sätt null om filtret inte ska användas):
- "sectors": [array av strängar, t.ex. "Försvar", "Industri", "Hälsovård"]
- "regions": [array av strängar, t.ex. "USA", "Sverige", "Norden"]
- "max_pe": nummer eller null
- "max_ev_ebitda": nummer eller null
- "min_roe": nummer (i procent, t.ex. 15) eller null
- "require_positive_fcf": boolean (true/false)

Exempel på output i slutet av din text:
<screener_config>
{
  "sectors": ["Hälsovård", "Försvar"],
  "regions": ["USA", "Sverige"],
  "max_pe": 20,
  "max_ev_ebitda": 12,
  "min_roe": 15,
  "require_positive_fcf": true
}
</screener_config>

Ton och format:
- Extremt krasst, institutionellt och handlingsorienterat.
- Inget beröm för tidigare vinster; marknaden bryr sig bara om morgondagen.`;

const pmR = (v, dec = 1) => (v == null || !isFinite(v)) ? null : Math.round(v * 10 ** dec) / 10 ** dec;

// Slutsatserna ur en CIO-analys: 1 (allokering & regim), 4 (megatrender & geopolitik),
// 5 (sektorallokering), 6 (svart svan). 2–3 är resonemanget bakom och skickas inte med.
function cioConclusions(text) {
  const parts = (text || '').replace(/\r/g, '').split(/\n(?=#{1,3}\s)/);
  const keep = parts.filter(p => /^#{1,3}\s*[1456][.)]?\s/.test(p.trim()));
  return (keep.length ? keep.join('\n\n') : text || '').trim();
}

// Senaste CIO-analysen – motorns dagliga eller din egen knappkörning, den nyaste vinner.
async function latestCioDirective() {
  const cands = [];
  if(cloudEnabled && sb) {
    try {
      const { data } = await sb.from('cio_analysis').select('date,analysis,created_at').order('date', { ascending: false }).limit(1);
      if(data && data[0]) cands.push({ source: 'motorns dagliga CIO-analys', ts: new Date(data[0].created_at || data[0].date).getTime(), text: data[0].analysis });
    } catch(e) {}
    if(currentUser) {
      try {
        const { data } = await sb.from('analyses').select('created_at,answer').like('title', 'CIO-analys%').order('created_at', { ascending: false }).limit(1);
        if(data && data[0]) cands.push({ source: 'din senaste CIO-körning', ts: new Date(data[0].created_at).getTime(), text: data[0].answer });
      } catch(e) {}
    }
  }
  const local = aiAnalyses.find(a => (a.title || '').startsWith('CIO-analys'));
  if(local) cands.push({ source: 'din senaste CIO-körning', ts: local.ts, text: local.answer });
  const best = cands.filter(c => c.text).sort((a, b) => b.ts - a.ts)[0];
  if(!best) return null;
  return { source: best.source, date: new Date(best.ts).toISOString().slice(0, 10),
    age_days: Math.floor((Date.now() - best.ts) / 86400000), conclusions: cioConclusions(best.text) };
}

// Riskbarometern: VIX, SKEW och guldets trend (samma uträkning som CIO-underlaget).
async function pmRiskBarometer() {
  let s = {};
  try { s = await fetchSparkData(['^VIX', '^SKEW', 'GC=F'], '6mo', '1d'); } catch(e) {}
  const withBand = (d, band) => { const t = cioTrend(d); return t && band ? { ...t, regime: band(d.price).text } : t; };
  return { vix: withBand(s['^VIX'], vixBand), skew: withBand(s['^SKEW'], skewBand), gold_usd_oz: withBand(s['GC=F'], null) };
}

// Vad plattformens Aktiescreener faktiskt kan – läst ur sidan, så att förslagen i
// avsnitt 5 går att ställa in.
function screenerCapabilities() {
  const labels = sel => [...document.querySelectorAll(sel)]
    .map(e => e.textContent.replace(/[^\p{L}\s-]/gu, '').trim()).filter(t => t && !/^Alla/.test(t));
  return {
    countries: labels('#section-screener [data-r]'),
    sectors: labels('#section-screener [data-s]'),
    sortable_columns: Object.values(COL_DEFS).map(d => d.label).filter(l => !['Marknad', 'Sektor', 'Kurs', 'Valuta'].includes(l)),
    numeric_filters: ['max_pe', 'max_ev_ebitda', 'min_roe', 'require_positive_fcf'],
    how_it_works: 'Filtrerar på land och sektor (flera kan kombineras) samt P/E-tak, EV/EBITDA-tak, lägsta ROE och positivt fritt kassaflöde. Sorterar på en kolumn i taget.'
  };
}

// Innehav → portföljstruktur med vikter (inkl. kassa) samt sektor- och valutafördelning.
function pmStructure(holdings, cashSek) {
  const secSek = holdings.reduce((s, h) => s + (h.value_sek || 0), 0);
  const total = secSek + (cashSek || 0);
  const pct = v => total ? pmR(v / total * 100) : null;
  const sumBy = key => {
    const m = {};
    for(const h of holdings) if(h.value_sek != null) { const k = h[key] || 'okänd'; m[k] = (m[k] || 0) + h.value_sek; }
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v)]));
  };
  return {
    total_value_sek: Math.round(total), securities_value_sek: Math.round(secSek),
    cash_sek: Math.round(cashSek || 0), cash_pct: pct(cashSek || 0),
    sector_weights_pct: sumBy('sector'), currency_weights_pct: sumBy('currency'),
    holdings: holdings.map(h => ({ ...h, weight_pct: h.value_sek != null ? pct(h.value_sek) : null,
      value_sek: h.value_sek != null ? Math.round(h.value_sek) : null }))
      .sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0))
  };
}

// Min portfölj: bygger på pfEnriched (redan prissatt och SEK-omräknat av portföljvyn).
function pmPortfolioStructure() {
  const holdings = pfEnriched.map(e => ({
    ticker: e.h.ticker, name: e.h.name || e.h.ticker, sector: e.sektor || null, currency: e.priceCcy || null,
    value_sek: e.valSek, gav: e.h.gav != null ? e.h.gav : null, price: pmR(e.price, 2),
    return_vs_gav_pct: pmR(e.gain), return_1y_pct: pmR(e.rets && e.rets['1y'])
  }));
  const cost = pfEnriched.reduce((s, e) => s + (e.plSek != null ? e.valSek - e.plSek : 0), 0);
  const pl = pfEnriched.reduce((s, e) => s + (e.plSek != null ? e.plSek : 0), 0);
  return { name: 'Min portfölj (Avanza)', ...pmStructure(holdings, portfolioCash),
    total_return_vs_cost_pct: cost > 0 ? pmR(pl / cost * 100) : null };
}

// AI-fond: prissätter innehaven nu och hämtar sektor per ticker. Fonden är fullinvesterad.
async function pmFundStructure(f) {
  const tickers = f.holdings.map(h => h.ticker);
  const [q, fx, info] = await Promise.all([
    fetchQuotesChunked(tickers), getFxRates([...new Set(f.holdings.map(h => h.currency))]), fetchHoldingInfo(tickers)
  ]);
  const holdings = f.holdings.map(h => {
    const d = q[h.ticker], pc = d && d.currency ? normPriceCurrency(d.currency) : null;
    const price = d && d.price != null ? (pc ? d.price / pc.div : d.price) : null;
    const rate = fx[(h.currency || 'SEK').toUpperCase()];
    return { ticker: h.ticker, name: h.name || h.ticker, sector: (info[h.ticker] || {}).sektor || null, currency: h.currency || null,
      value_sek: (price != null && rate != null) ? price * h.shares * rate : null,
      purchase_price: h.buyPrice, price: pmR(price, 2),
      return_since_purchase_pct: (price != null && h.buyPrice) ? pmR((price - h.buyPrice) / h.buyPrice * 100) : null,
      rationale: h.rationale || null };
  });
  const s = pmStructure(holdings, 0);
  return { name: `AI-fond: ${f.name}`, ...s,
    mandate: { instructions: f.instructions || null, strategy: f.strategy || null },
    start_value_sek: f.startValueSek || null, started: (f.createdAt || '').slice(0, 10) || null,
    return_since_start_pct: f.startValueSek ? pmR((s.securities_value_sek - f.startValueSek) / f.startValueSek * 100) : null };
}

function pmUserMessage(ctx) {
  const today = new Date().toLocaleDateString('sv-SE', { year:'numeric', month:'long', day:'numeric' });
  return `Dagens datum: ${today}. Genomlys portföljen nedan mot fondens senaste makro-direktiv och riskbarometern.

Om underlaget:
- Alla belopp är i SEK, redan omräknade av plattformen. weight_pct är andel av portföljens totala värde inklusive kassa; sector_weights_pct och currency_weights_pct summerar innehaven på samma sätt.
- return_vs_gav_pct / return_since_purchase_pct = kursutveckling mot anskaffningskursen i aktiens egen valuta (valutaeffekten ingår inte). return_1y_pct = kursutveckling senaste året.
- cio_directive är slutsatserna ur den senaste CIO-analysen (allokering & regim, megatrender & geopolitik, sektorallokering, systemisk risk); age_days = hur gammal den är. Är den null finns ingen CIO-analys – säg det och utgå från riskbarometern.
- risk_barometer: värde, förändring 1/3/6 månader och läge mot 50-dagarssnitt.${ctx.portfolio.mandate ? '\n- mandate är fondens förvaltningsmandat (ägarens instruktioner). Håll åtgärderna inom mandatet eller motivera uttryckligen varför det bör ändras.' : ''}
- screener_capabilities beskriver vad plattformens Aktiescreener faktiskt kan. Använd i screener_config bara sektor- och landnamn som står i dess listor (stavade exakt så). Filter den saknar, t.ex. FCF-marginal, kan du nämna i avsnitt 5 som något att kontrollera per bolag i Aktiedetalj (Institutionell djupanalys).
- null eller saknade fält betyder att datan inte gick att hämta. Hitta inte på siffror för dem.

<underlag>
${JSON.stringify(ctx, null, 1)}
</underlag>`;
}

let pmRunId = 0;
async function runPortfolioReview(kind, fundId) {
  const outId = kind === 'fund' ? 'aif-review-out' : 'pf-review-out';
  const btnId = kind === 'fund' ? 'aif-review-btn' : 'pf-review-btn';
  const getOut = () => document.getElementById(outId);
  if(!getApiKey()) {
    const out = getOut();
    if(out) out.innerHTML = '<div class="error-msg" style="margin:0">Ingen API-nyckel. Klistra in din Anthropic-nyckel i AI-panelen (✦ AI-analys) först.</div>';
    return;
  }
  const fund = kind === 'fund' ? aiFunds.find(f => f.id === fundId) : null;
  if(kind === 'fund' ? !fund : !pfEnriched.length) return;
  const id = ++pmRunId, live = () => id === pmRunId;
  const setBtn = (disabled, label) => { const b = document.getElementById(btnId); if(b && live()) { b.disabled = disabled; b.textContent = label; } };
  const status = txt => { if(live()) memoStatus(getOut(), txt); };
  setBtn(true, '✦ Genomlyser…');

  status('Samlar underlag: innehav och vikter, senaste CIO-direktivet och riskbarometern…');
  let ctx;
  try {
    const [portfolio, cio, risk] = await Promise.all([
      kind === 'fund' ? pmFundStructure(fund) : pmPortfolioStructure(), latestCioDirective(), pmRiskBarometer()
    ]);
    ctx = { as_of: new Date().toISOString().slice(0, 10), portfolio, cio_directive: cio, risk_barometer: risk,
            screener_capabilities: screenerCapabilities() };
  } catch(e) {
    const out = getOut();
    if(live() && out) out.innerHTML = `<div class="error-msg" style="margin:0">Kunde inte samla underlaget: ${escHtml(e.message)}</div>`;
    return setBtn(false, '↻ Försök igen');
  }
  status(ctx.cio_directive
    ? `Portföljförvaltaren stresstestar portföljen mot CIO-direktivet (${escHtml(ctx.cio_directive.source)}, ${ctx.cio_directive.date}) – modellen tänker innan den skriver…`
    : 'Ingen CIO-analys hittades – genomlysningen körs mot riskbarometern. Kör CIO-analysen på Översikt först för ett skarpare direktiv. Modellen tänker…');

  const body = { model: PM_MODEL, max_tokens: 32000, system: PM_SYSTEM_PROMPT,
    output_config: { effort: 'high' }, messages: [{ role: 'user', content: pmUserMessage(ctx) }] };
  const result = await streamMemo(body, { getOut, live });
  if(result.error) return setBtn(false, '↻ Försök igen');

  const costMeta = estimateCostText(PM_MODEL, result.usage);
  recordAiUsage('portfolio_review', PM_MODEL, result.usage);
  const title = kind === 'fund' ? `Portföljgenomlysning · AI-fond: ${fund.name}` : PM_TITLE_PORTFOLIO;
  saveAnalysis({ ts: Date.now(), title, model: PM_MODEL, answer: result.text, cost: costMeta });
  const out = getOut();
  if(live() && out) {
    const cio = ctx.cio_directive ? `CIO-direktiv: ${ctx.cio_directive.source} (${ctx.cio_directive.date})` : 'utan CIO-direktiv';
    out.innerHTML = `<div class="memo">${formatMemo(result.text)}</div>
      ${screenerPanelHtml(result.text, 'pm-live') || '<div class="deep-meta" style="border:none">Modellen skickade ingen giltig screener-konfiguration.</div>'}
      <div class="deep-meta">Sparad i Sparade analyser · ${escHtml(cio)} · ${escHtml(costMeta)}${currentUser ? '' : ' · logga in för att kostnaden ska synas i AI-kostnader'}</div>`;
  }
  setBtn(false, '↻ Kör ny genomlysning');
}

// ── <screener_config> → Aktiescreenern ──
// Genomlysningen avslutar med ett JSON-block (avsnitt 6). Vi tolkar det, matchar
// sektor- och landnamnen mot screenerns egna chips och fyller i filtren på knapptryck.
function parseScreenerConfig(text) {
  const m = (text || '').match(/<screener_config>\s*([\s\S]*?)\s*<\/screener_config>/);
  if(!m) return null;
  try {
    const j = JSON.parse(m[1].replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : null;
  } catch(e) { return null; }
}

// Engelska/alternativa namn som modellen kan tänkas använda → screenerns sektorchips.
const SCREENER_SECTOR_ALIAS = { technology: 'Teknik', tech: 'Teknik', semiconductors: 'Halvledare', healthcare: 'Hälsovård',
  financials: 'Finans', financialservices: 'Finans', industrials: 'Industri', energy: 'Energi',
  consumer: 'Konsument', consumercyclical: 'Konsument', defense: 'Försvar', aerospacedefense: 'Försvar' };

function resolveScreenerConfig(cfg) {
  const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}]/gu, '');
  const chipMap = (sel, key) => {
    const m = {};
    document.querySelectorAll(sel).forEach(c => { const v = c.dataset[key]; if(v && v !== 'alla') { m[norm(c.textContent)] = v; m[norm(v)] = v; } });
    return m;
  };
  const regionMap = chipMap('#region-filters [data-r]', 'r');
  const sectorMap = chipMap('#sector-filters [data-s]', 's');
  const regionLabel = code => { const c = document.querySelector(`#region-filters [data-r="${code}"]`); return c ? c.textContent.replace(/[^\p{L}\s-]/gu, '').trim() : code; };
  const unknown = [];
  const pick = (list, map, alias) => [...new Set((Array.isArray(list) ? list : []).map(x => {
    const hit = map[norm(x)] || (alias && alias[norm(x)]);
    if(!hit) unknown.push(String(x));
    return hit;
  }).filter(Boolean))];
  const regions = pick(cfg.regions, regionMap);
  const posNum = v => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  return {
    regions, regionLabels: regions.map(regionLabel), sectors: pick(cfg.sectors, sectorMap, SCREENER_SECTOR_ALIAS),
    num: { maxPe: posNum(cfg.max_pe), maxEvEbitda: posNum(cfg.max_ev_ebitda),
           minRoe: (typeof cfg.min_roe === 'number' && isFinite(cfg.min_roe)) ? cfg.min_roe : null,
           posFcf: cfg.require_positive_fcf === true },
    unknown
  };
}

// Knapp-panel under en genomlysning (live eller i en sparad lista). `key` skiljer
// panelerna åt när flera visas samtidigt.
const screenerCfgs = {};
function screenerPanelHtml(text, key) {
  const cfg = parseScreenerConfig(text);
  if(!cfg) return '';
  const r = resolveScreenerConfig(cfg);
  screenerCfgs[key] = r;
  const parts = [
    'Sektorer: ' + (r.sectors.length ? r.sectors.join(', ') : 'alla'),
    'Marknader: ' + (r.regionLabels.length ? r.regionLabels.join(', ') : 'alla')
  ];
  if(r.num.maxPe != null) parts.push('P/E ≤ ' + r.num.maxPe);
  if(r.num.maxEvEbitda != null) parts.push('EV/EBITDA ≤ ' + r.num.maxEvEbitda);
  if(r.num.minRoe != null) parts.push('ROE ≥ ' + r.num.minRoe + ' %');
  if(r.num.posFcf) parts.push('positivt fritt kassaflöde');
  return `<div class="info-msg" style="margin:14px 0 0;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <span><b>Screener-filter från genomlysningen:</b> ${escHtml(parts.join(' · '))}${r.unknown.length ? `<br><span style="color:var(--text3)">Finns inte i screenern, hoppas över: ${escHtml(r.unknown.join(', '))}</span>` : ''}</span>
    <button class="action-btn" onclick="event.stopPropagation();applyScreenerCfg('${escQuote(key)}')">⚡ Applicera AI:ns filter i Screenern</button>
  </div>`;
}

function applyScreenerCfg(key) {
  const r = screenerCfgs[key];
  if(!r) return;
  activeRegions = new Set(r.regions);
  activeSectors = new Set(r.sectors);
  numFilters = { ...r.num };
  screenerPage = 0;
  paintFilterChips();
  paintNumFilters();
  const o = document.getElementById('screener-origin');
  if(o) o.innerHTML = `<div class="info-msg" style="display:flex;justify-content:space-between;gap:10px">
    <span>✦ Filtren är ifyllda från Portföljgenomlysningen. Djupanalysera kandidaterna i Aktiedetalj innan du agerar.</span>
    <span style="cursor:pointer" onclick="document.getElementById('screener-origin').innerHTML=''">×</span></div>`;
  showSection('screener'); // → loadScreener() med de nya filtren
}

async function avanzaGet(path) {
  const r = await fetch(`/api/avanza?path=${encodeURIComponent(path)}`);
  return await r.json();
}

async function avanzaSearchFunds(query) {
  const r = await fetch(`/api/avanza?path=${encodeURIComponent('/_api/search/filtered-search')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, searchFilter: { types: ['FUND'] }, pagination: { from: 0, size: 6 } })
  });
  return await r.json();
}

function renderSearchResults(local, remote, funds) {
  const localHtml = local.map(s=>`
    <div class="sr-item" onclick="selectSearch('${escQuote(s.ticker)}','${escQuote(s.name)}')">
      <div><div class="sr-name">${s.flag} ${s.name}</div><div class="sr-meta">${s.ticker} · ${s.sektor}</div></div>
      <div style="text-align:right"><div style="font-size:12px;font-family:var(--mono)">${s.kurs}</div><div class="sr-meta ${s.ytd>=0?'green':'red'}">${s.ytd>=0?'+':''}${s.ytd.toFixed(1)}%</div></div>
    </div>`).join('');
  const fundHtml = (funds||[]).map(f=>`
    <div class="sr-item" onclick="selectFund('${escQuote(f.id)}','${escQuote(f.name)}')">
      <div><div class="sr-name">${f.name}</div><div class="sr-meta">Avanza fond</div></div>
      <div style="text-align:right"><div style="font-size:12px;font-family:var(--mono)">${f.price||''} ${f.currency||''}</div><div class="sr-meta">Fond</div></div>
    </div>`).join('');
  const remoteHtml = remote.map(r=>`
    <div class="sr-item" onclick="selectSearch('${escQuote(r.symbol)}','${escQuote(r.name)}')">
      <div><div class="sr-name">${r.name}</div><div class="sr-meta">${r.symbol} · ${r.exchange||'Yahoo'}</div></div>
      <div style="text-align:right"><div class="sr-meta">Live-data</div></div>
    </div>`).join('');
  if(!localHtml && !fundHtml && !remoteHtml) { searchResults.style.display = 'none'; return; }
  searchResults.innerHTML = localHtml + fundHtml + remoteHtml;
  searchResults.style.display = 'block';
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  if(q.length < 1) { searchResults.style.display = 'none'; return; }

  // Inbyggda träffar visas direkt
  const local = stocks.filter(s=>s.name.toLowerCase().includes(q)||s.ticker.toLowerCase().includes(q)).slice(0,6);
  renderSearchResults(local, [], []);

  // Yahoo + Avanza (debounce 300ms så vi inte spammar vid varje tangenttryck)
  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
    const [yh, av] = await Promise.allSettled([ fetchYahoo(yahooUrl), avanzaSearchFunds(q) ]);
    if(seq !== searchSeq) return; // en nyare sökning har redan startat

    const localTickers = new Set(local.map(s=>s.ticker.toUpperCase()));
    let remote = [];
    if(yh.status === 'fulfilled' && yh.value) {
      remote = (yh.value.quotes||[])
        .filter(r=>r.symbol && (r.quoteType==='EQUITY' || r.quoteType==='ETF' || r.quoteType==='MUTUALFUND'))
        .filter(r=>!localTickers.has(r.symbol.toUpperCase()))
        .map(r=>({ symbol: r.symbol, name: r.shortname || r.longname || r.symbol, exchange: r.exchDisp }))
        .slice(0,8);
    }

    let funds = [];
    if(av.status === 'fulfilled' && av.value && av.value.hits) {
      funds = av.value.hits
        .filter(h=>h.type==='FUND' && h.orderBookId)
        .map(h=>({ id: h.orderBookId, name: h.title, price: h.price && h.price.last, currency: h.price && h.price.currency }))
        .slice(0,6);
    }

    renderSearchResults(local, remote, funds);
  }, 300);
});

function selectSearch(ticker, name) {
  searchInput.value = '';
  searchResults.style.display = 'none';
  loadStock(ticker, name);
}

function selectFund(orderBookId, name) {
  searchInput.value = '';
  searchResults.style.display = 'none';
  loadFund(orderBookId, name);
}

document.addEventListener('click', e => { if(!e.target.closest('#search-wrap')) searchResults.style.display = 'none'; });
document.addEventListener('click', e => { if(!e.target.closest('#col-btn') && !e.target.closest('#col-menu')) { const m=document.getElementById('col-menu'); if(m) m.style.display='none'; } });
