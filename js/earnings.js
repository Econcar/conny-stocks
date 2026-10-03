// conny-stocks · Rapportkalendern.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ RAPPORTKALENDER ══════════
let earnPeriodDays = 7;
let earnRows = [];
let earnNote = '';   // varning när kalendern kapades eller egna bolag inte kunde hämtas
let earnPast = false; // vald period ligger bakåt i tiden (Senaste veckan)
let earnFromDb = 0;   // hur många rader som kom från motorns kalender
const EARN_REACTION_MAX = 150; // tak för hur många bolag vi hämtar kursreaktion för

function marketFromTicker(t){
  const s = (t || '').toUpperCase();
  const dot = s.lastIndexOf('.');
  if(dot < 0) return 'USA';
  const suf = s.slice(dot);
  if(['.ST','.OL','.CO','.HE','.IC'].includes(suf)) return 'Norden';
  if(['.DE','.F','.PA','.AS','.L','.IL','.MI','.MC','.SW','.VX','.BR','.LS','.VI','.MU','.SG','.MA','.IR'].includes(suf)) return 'Europa';
  return 'Övrigt';
}
function earnWhen(type){ return type === 'BMO' ? 'Före öppning' : type === 'AMC' ? 'Efter stängning' : ''; }

// Poäng för "primärnotering" – väljer bästa tickern när samma bolag är korsnoterat.
function earnTickerScore(t){
  const s = (t || '').toUpperCase(); let sc = 0;
  if(/^[0-9]/.test(s)) sc -= 10;                 // exotiska korsnoteringar (0Q16.IL, 1GOOGL.MI)
  const dot = s.lastIndexOf('.'); const suf = dot >= 0 ? s.slice(dot) : '';
  if(!suf) sc += 2;                              // USA-primär
  else if(['.ST','.OL','.CO','.HE','.IC'].includes(suf)) sc += 2; // nordisk primär
  else if(['.DE','.PA','.AS','.L','.MI','.MC','.SW','.BR','.LS','.VI','.IR'].includes(suf)) sc += 1;
  sc -= s.length * 0.01;                          // föredra kortare ticker
  return sc;
}
// Tickerstam utan börssuffix och aktieslag: ERIC-B.ST och ERIC (ADR) → ERIC.
function earnTickerBase(t){ return (t || '').toUpperCase().split(/[-.]/)[0]; }

// Slår ihop dubletter (samma bolag + datum) och behåller primärnoteringen.
// Två rader räknas som samma bolag om tickerstammen ELLER namnet matchar, eftersom
// korsnoteringar ibland skiljer sig i det ena men inte det andra (ERIC vs ERIC-B.ST).
// Egna innehav vinner alltid, annars högst tickerpoäng — så "Endast mina" hittar rätt rad.
function dedupeEarnings(rows){
  const sorted = [...rows].sort((a, b) =>
    (b.mine === true) - (a.mine === true) || earnTickerScore(b.ticker) - earnTickerScore(a.ticker));
  const seen = new Map(), out = [];
  for(const r of sorted){
    const day = r.date.toISOString().slice(0, 10);
    const kT = 'T|' + earnTickerBase(r.ticker) + '|' + day;
    const kN = 'N|' + (r.name || r.ticker).toLowerCase().trim() + '|' + day;
    const kept = seen.get(kT) || seen.get(kN);
    if(kept){
      // Egna rader saknar EPS-data (kommer från kursanropet) – ärv den från kalenderraden.
      for(const f of ['eps', 'epsActual', 'surprise', 'when']){
        if((kept[f] == null || kept[f] === '') && r[f] != null && r[f] !== '') kept[f] = r[f];
      }
      continue;
    }
    seen.set(kT, r); seen.set(kN, r);
    out.push(r);
  }
  return out;
}

// Tickers jag faktiskt bryr mig om (bevakningslista + portfölj), med källa per ticker
// så att ★ går att härleda – annars är det omöjligt att se varför ett bolag markerats.
function ownEarnTickers(){
  const src = new Map();
  const add = (t, from) => {
    const k = (t || '').trim();
    if(!k) return;
    const key = k.toUpperCase();
    src.set(key, src.has(key) && src.get(key).from !== from ? { ticker: k, from: 'bevakning + portfölj' } : { ticker: k, from });
  };
  getWatchlist().forEach(w => add(w.id, 'bevakning'));
  portfolio.forEach(h => add(h.ticker, 'portfölj'));
  return [...src.values()];
}

// Yahoos kalender-API saknar i praktiken nordiska bolag (region=se ger 0 träffar), så
// egna innehav hämtas separat per ticker och vävs in i listan.
async function fetchOwnEarnings(fromMs, toMs){
  const own = ownEarnTickers();
  const srcByTicker = new Map(own.map(o => [o.ticker.toUpperCase(), o.from]));
  const syms = own.map(o => o.ticker);
  const out = [];
  for(let i = 0; i < syms.length; i += 50){
    const chunk = syms.slice(i, i + 50);
    const r = await fetch('/api/earnings?symbols=' + encodeURIComponent(chunk.join(',')));
    const j = await r.json();
    if(!j || !j.rows) continue;
    for(const row of j.rows){
      const dt = new Date(row.date);
      if(isNaN(dt) || dt < fromMs || dt >= toMs) continue;
      // Yahoo kan svara med en annan symbol än den vi frågade om (t.ex. omdirigerade
      // eller avnoterade tickers). Utan träff i mina egna listor får raden ingen ★.
      const from = srcByTicker.get((row.ticker || '').toUpperCase());
      if(!from) continue;
      out.push({ ticker: row.ticker, name: row.name, date: dt, when: '', eps: null, epsActual: null,
                 surprise: null, market: marketFromTicker(row.ticker), mine: true, mineSrc: from,
                 estimate: row.estimate === true });
    }
  }
  return out;
}

// Kursreaktionen på en rapport: stängning efter rapporten mot stängningen före.
// Rapporttiden avgör vilka dagar som jämförs – före öppning slår på samma dag,
// efter stängning på nästa. Är tiden okänd spänner vi över hela rapportdagen.
function earnReaction(series, r){
  if(!series || series.length < 2) return null;
  const day = r.date.toISOString().slice(0, 10);
  let iOn = -1, iPrev = -1, iNext = -1;
  for(let i = 0; i < series.length; i++){
    if(series[i][0] === day) iOn = i;
    else if(series[i][0] < day) iPrev = i;
    else if(iNext < 0) iNext = i;
  }
  let a = null, b = null, span = '';
  if(r.when === 'Före öppning' && iOn >= 0 && iPrev >= 0){ a = series[iPrev][1]; b = series[iOn][1]; span = 'rapportdagen'; }
  else if(r.when === 'Efter stängning' && iOn >= 0 && iNext >= 0){ a = series[iOn][1]; b = series[iNext][1]; span = 'dagen efter'; }
  else if(iPrev >= 0 && iNext >= 0){ a = series[iPrev][1]; b = series[iNext][1]; span = 'runt rapporten'; }
  if(!a || !b) return null;
  return { pct: (b / a - 1) * 100, span };
}

// Hämtar dagskurser för raderna och fyller på med reaktionen. Egna innehav först,
// så att taket träffar bolag du inte följer om listan är lång.
async function addEarnReactions(rows){
  const order = [...rows].sort((x, y) => (y.mine === true) - (x.mine === true));
  const syms = [...new Set(order.map(r => r.ticker))].slice(0, EARN_REACTION_MAX);
  const series = {};
  for(let i = 0; i < syms.length; i += 50){
    try {
      const r = await fetch('/api/earnings?prices=' + encodeURIComponent(syms.slice(i, i + 50).join(',')));
      const j = await r.json();
      Object.assign(series, (j && j.series) || {});
    } catch(e){ /* delvis data är bättre än ingen */ }
  }
  for(const row of rows) row.reaction = earnReaction(series[row.ticker], row);
}

async function renderEarnings(){
  document.querySelectorAll('#section-earnings .filter-chip').forEach(c => {
    const on = Number(c.dataset.period) === earnPeriodDays;
    c.style.background = on ? 'rgba(79,142,247,0.15)' : '';
    c.style.color = on ? 'var(--accent)' : '';
  });
  const el = document.getElementById('earnings-list');
  el.innerHTML = '<div class="info-msg">Hämtar rapportkalender…</div>';
  // Negativ period = bakåt i tiden (Senaste veckan). Dagens datum ingår i båda fallen.
  const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  earnPast = earnPeriodDays < 0;
  const fromMs = earnPast ? todayMs + earnPeriodDays * 86400000 : todayMs;
  const toMs = earnPast ? todayMs + 86400000 : todayMs + earnPeriodDays * 86400000;
  const from = new Date(fromMs).toISOString().slice(0, 10);
  const to = new Date(toMs).toISOString().slice(0, 10);
  try {
    earnNote = '';
    // Tre källor, oberoende av varandra: motorns kalender (bred), Yahoos egen
    // kalender (ger EPS-estimat och rapporttid) och dina innehav (alltid med).
    const [db, cal, own] = await Promise.all([
      fetchEarningsFromDb(fromMs, toMs).catch(e => { console.warn('earnings_calendar:', e.message); return null; }),
      fetchEarnings(from, to),
      fetchOwnEarnings(fromMs, toMs).catch(e => { earnNote = 'Kunde inte hämta rapportdatum för dina egna innehav: ' + e.message; return []; })
    ]);
    earnRows = dedupeEarnings([...own, ...(db || []), ...cal.rows]).sort((a, b) => earnPast ? b.date - a.date : a.date - b.date);
    earnFromDb = db ? db.length : 0;
    if(cal.truncated) earnNote = 'Kalendern kapades vid ' + cal.rows.length + ' rader – välj en kortare period för att se allt.';
    else if(db === null) earnNote = 'Motorns kalender kunde inte läsas (inte inloggad eller Supabase nere) – visar bara Yahoos glesa kalender och dina egna innehav.';
    setUpdatedStamp('stamp-earnings');
    renderEarningsList();
    if(earnPast){ await addEarnReactions(earnRows); renderEarningsList(); }
  } catch(e){
    el.innerHTML = '<div class="info-msg" style="background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.25);color:var(--red)">Kunde inte hämta rapportkalendern: ' + escHtml(e.message) + '</div>';
  }
}

// Motorns kalender (earnings_calendar i Supabase): ~1 800 bolag som går att handla
// via Avanza, uppdaterad varje natt. Detta är huvudkällan – Yahoos egen kalender är
// för gles. Se docs/beslutslogg.md.
async function fetchEarningsFromDb(fromMs, toMs){
  if(!cloudEnabled || !sb) return null;
  const { data, error } = await sb.from('earnings_calendar')
    .select('ticker,name,market,report_date,report_at,estimate')
    .gte('report_date', new Date(fromMs).toISOString().slice(0, 10))
    .lt('report_date', new Date(toMs).toISOString().slice(0, 10))
    .order('report_date', { ascending: true })
    .limit(2000);
  if(error) throw new Error(error.message);
  return (data || []).map(r => ({
    ticker: r.ticker, name: r.name || r.ticker,
    date: new Date(r.report_at || (r.report_date + 'T12:00:00Z')),
    when: '', eps: null, epsActual: null, surprise: null,
    market: marketFromTicker(r.ticker), estimate: r.estimate === true
  }));
}

// Hämtar hela kalenderintervallet sidvis. Yahoo ger ~250 rader per anrop; taket finns
// bara som skydd mot rundgång och rapporteras uppåt så att kapningen syns i UI:t.
async function fetchEarnings(from, to){
  const MAX_PAGES = 20;
  const out = [];
  let truncated = false;
  for(let page = 0; page < MAX_PAGES; page++){
    const r = await fetch(`/api/earnings?from=${from}&to=${to}&size=250&offset=${page*250}`);
    const j = await r.json();
    const doc = j && j.finance && j.finance.result && j.finance.result[0] && j.finance.result[0].documents && j.finance.result[0].documents[0];
    if(!doc || !doc.rows || !doc.rows.length) break;
    const cols = (doc.columns || []).map(c => c.id);
    for(const row of doc.rows){
      const o = {};
      cols.forEach((id, i) => { o[id] = Array.isArray(row) ? row[i] : row[id]; });
      const dt = o.startdatetime ? new Date(o.startdatetime) : null;
      if(!o.ticker || !dt || isNaN(dt)) continue;
      out.push({ ticker: o.ticker, name: o.companyshortname || o.ticker, date: dt, when: earnWhen(o.startdatetimetype), eps: o.epsestimate, epsActual: o.epsactual, surprise: o.epssurprisepct, market: marketFromTicker(o.ticker) });
    }
    if(doc.rows.length < 250) break;
    if(page === MAX_PAGES - 1) truncated = true;  // full sida kvar när taket nåddes
  }
  return { rows: out, truncated };
}

function renderEarningsList(){
  const el = document.getElementById('earnings-list'); if(!el) return;
  const q = (document.getElementById('earn-search').value || '').trim().toLowerCase();
  const market = document.getElementById('earn-market').value;
  const mineOnly = document.getElementById('earn-mine').checked;
  const mine = mineOnly ? new Set([...getWatchlist().map(w => w.id), ...portfolio.map(h => h.ticker)].map(t => (t || '').toUpperCase())) : null;
  const rows = earnRows.filter(r => {
    if(q && !(r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))) return false;
    if(market && r.market !== market) return false;
    if(mine && !mine.has(r.ticker.toUpperCase())) return false;
    return true;
  });
  const note = earnNote ? `<div class="info-msg" style="background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.25);margin-bottom:10px">${escHtml(earnNote)}</div>` : '';
  if(!rows.length){ el.innerHTML = note + '<div class="info-msg">Inga rapporter matchar filtren i vald period.</div>'; return; }
  let html = note, lastKey = '';
  for(const r of rows){
    const key = r.date.toISOString().slice(0, 10);
    if(key !== lastKey){
      lastKey = key;
      const dstr = r.date.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
      html += `<div style="font-weight:600;margin:16px 0 6px;text-transform:capitalize">${dstr}</div>`;
    }
    const surprise = (r.surprise != null && isFinite(r.surprise)) ? `<span style="color:${r.surprise>=0?'var(--green)':'var(--red)'}">${r.surprise>=0?'+':''}${(+r.surprise).toFixed(1)}%</span>` : '';
    const reaction = r.reaction
      ? `<div title="Stängning efter rapporten mot stängningen före (${r.reaction.span})" style="font-weight:600;color:${r.reaction.pct>=0?'var(--green)':'var(--red)'}">${r.reaction.pct>=0?'+':''}${r.reaction.pct.toFixed(1)}% <span style="font-weight:400;color:var(--text3);font-size:10px">${r.reaction.span}</span></div>`
      : (earnPast ? '<div style="font-size:10px;color:var(--text3)">reaktion saknas</div>' : '');
    html += `<div onclick="loadStock('${escQuote(r.ticker)}','${escQuote(r.name)}')" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid var(--border);cursor:pointer" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background=''">
      <div><div style="font-weight:500">${r.mine ? `<span title="Stjärnmärkt för att ${escHtml(r.ticker)} finns i din ${escHtml(r.mineSrc || 'bevakning/portfölj')}" style="color:var(--accent)">★ </span>` : ''}${escHtml(r.name)}</div><div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${escHtml(r.ticker)} · ${r.market}${r.when ? ' · ' + r.when : ''}${r.estimate ? ' · preliminärt datum' : ''}</div></div>
      <div style="text-align:right;font-size:12px">
        ${reaction}
        ${r.eps != null && isFinite(r.eps) ? `<div style="color:var(--text2)">Est. EPS ${(+r.eps).toFixed(2)}</div>` : ''}
        ${r.epsActual != null && isFinite(r.epsActual) ? `<div>Utfall ${(+r.epsActual).toFixed(2)} ${surprise}</div>` : (surprise ? `<div>${surprise}</div>` : '')}
      </div>
    </div>`;
  }
  const mineCount = rows.filter(r => r.mine).length;
  html += `<div style="font-size:11px;color:var(--text3);margin-top:12px">${rows.length} rapporter${mineCount ? ` · varav ${mineCount} ★ = i din bevakning/portfölj` : ''} · källa: Yahoo Finance
    ${earnPast ? '<br>Reaktionen är stängningskursen efter rapporten mot stängningen före — inte hela periodens utveckling.' : ''}<br>
    ${earnFromDb ? `Kalendern byggs av motorn varje natt ur ~1 800 bolag du kan handla via Avanza (${earnFromDb} i den här perioden) och kompletteras med Yahoos egen kalender och dina innehav.` : 'Motorns kalender saknas just nu – visar Yahoos glesa kalender och dina egna innehav.'}
    Bara <b>nästa</b> bekräftade rapportdatum finns per bolag: kommande kvartal längre fram är sällan satta ännu, så långa perioder visar oftast en rapport per bolag.</div>`;
  el.innerHTML = html;
}

function setEarnPeriod(days){ earnPeriodDays = days; renderEarnings(); }
