// conny-stocks · Nyheter/signaler från motorn.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ SIGNALER / NYHETER ══════════
// Läser färdiga signaler som motorn (schemalagt jobb) skrivit till Supabase.
// Publik läsning via RLS – funkar även utloggad. Se engine/ och docs/signal-pipeline-spec.md.
let signalsCache = null;
let signalsCacheAt = 0;
const signalFilter = { sent: 'alla', imp: 0, source: 'alla' };

// Läsbara källnamn – rådata i signals.source är adapter-id (reddit, sec_edgar …).
const SOURCE_LABELS = {
  rss: '📰 Nyhetsflöde', sec_edgar: '🏛️ SEC 8-K', sec_insider: '👤 Insider (Form 4)',
  reddit: '💬 Reddit-forum', gdelt: '🌐 GDELT'
};
const sourceLabel = s => SOURCE_LABELS[s] || (s || 'Okänd källa');

function timeAgo(iso) {
  if(!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if(s < 60) return 'nyss';
  if(s < 3600) return 'för ' + Math.floor(s/60) + ' min sedan';
  if(s < 86400) return 'för ' + Math.floor(s/3600) + ' tim sedan';
  const d = Math.floor(s/86400);
  if(d === 1) return 'igår';
  if(d < 7) return 'för ' + d + ' dgr sedan';
  return new Date(iso).toLocaleDateString('sv-SE');
}

// Slå ihop rader (en per ticker) till en post per artikel.
function groupSignals(rows) {
  const map = new Map();
  for(const r of rows) {
    const key = r.external_id || r.url || r.summary;
    let g = map.get(key);
    if(!g) {
      g = { key, url:r.url, published_at:r.published_at, source:r.source,
            sentiment:r.sentiment, summary:r.summary, impact_score:r.impact_score,
            analysis:r.analysis || null, model:r.model || null, tickers:new Set() };
      map.set(key, g);
    }
    if(!g.analysis && r.analysis) { g.analysis = r.analysis; g.model = r.model; }
    if(r.ticker) g.tickers.add(r.ticker);
    if(r.impact_score != null && (g.impact_score == null || r.impact_score > g.impact_score)) g.impact_score = r.impact_score;
  }
  return [...map.values()].map(g => ({ ...g, tickers:[...g.tickers] }));
}

// Delad, cachad laddning av signaler (3 min) – både Nyheter-vyn och Översikt
// använder denna, så vi inte dubbel-hämtar när man växlar flik.
async function loadSignals(force) {
  if(!cloudEnabled || !sb) return null;
  if(!force && signalsCache && Date.now() - signalsCacheAt < 180000) return signalsCache;
  const { data, error } = await sb.from('signals')
    .select('external_id,url,published_at,source,ticker,sentiment,impact_score,summary,analysis,model')
    .neq('source', 'demo')
    .order('published_at', { ascending: false })
    .limit(300);
  if(error) throw new Error(error.message);
  signalsCache = groupSignals(data || []);
  signalsCacheAt = Date.now();
  return signalsCache;
}

async function renderSignals() {
  const list = document.getElementById('signals-list');
  if(!cloudEnabled || !sb) {
    list.innerHTML = `<div class="info-msg">Molnet är inte konfigurerat, så nyhetssignaler kan inte hämtas.</div>`;
    return;
  }
  list.innerHTML = `<div class="muted" style="padding:20px 4px">Laddar signaler…</div>`;
  try {
    await loadSignals(false);
  } catch(e) {
    list.innerHTML = `<div class="error-msg">Kunde inte hämta signaler: ${escHtml(e.message)}</div>`;
    return;
  }
  setUpdatedStamp('stamp-signals');
  applySignalFilters();
}

// Kompakt topplista på Översikt: de mest kurspåverkande nyheterna.
async function renderDashboardNews() {
  const el = document.getElementById('dashboard-news-list');
  if(!el) return;
  if(!cloudEnabled || !sb) {
    el.innerHTML = `<div class="muted" style="font-size:12px">Molnet är inte konfigurerat.</div>`;
    return;
  }
  let all;
  try {
    all = await loadSignals(false);
  } catch(e) {
    el.innerHTML = `<div class="muted" style="font-size:12px">Kunde inte hämta nyheter.</div>`;
    return;
  }
  const top = (all || [])
    .slice()
    .sort((a,b) => (b.impact_score||0) - (a.impact_score||0)
                || new Date(b.published_at||0) - new Date(a.published_at||0))
    .slice(0, 4);
  if(!top.length) {
    el.innerHTML = `<div class="muted" style="font-size:12px">Inga nyheter ännu – motorn skördar dagligen.</div>`;
    return;
  }
  el.innerHTML = top.map(dashNewsItem).join('');
}

function dashNewsItem(g) {
  const col = g.sentiment === 'positiv' ? 'var(--green)' : g.sentiment === 'negativ' ? 'var(--red)' : 'var(--text2)';
  const imp = g.impact_score == null ? 0 : g.impact_score;
  const real = g.tickers.filter(Boolean).slice(0, 3);
  const chips = real.length
    ? real.map(t => `<span class="ticker-chip" onclick="event.stopPropagation();loadStock('${escQuote(t)}','${escQuote(t)}')">${escHtml(t)}</span>`).join('')
    : `<span class="ticker-chip macro">Makro</span>`;
  return `<div class="dash-news" onclick="showSection('signals')">
    <div class="dash-news-imp" style="color:${col}">${imp.toFixed(2)}</div>
    <div class="dash-news-body">
      <div class="dash-news-sum">${escHtml(g.summary || '')}</div>
      <div class="dash-news-meta">${chips}<span class="signal-dot">·</span><span>${timeAgo(g.published_at)}</span></div>
    </div>
  </div>`;
}

function applySignalFilters() {
  const list = document.getElementById('signals-list');
  const countEl = document.getElementById('signals-count');
  if(!signalsCache) return;
  if(!signalsCache.length) {
    list.innerHTML = `<div class="muted" style="padding:20px 4px">Inga signaler ännu. Motorn skördar och analyserar nyheter dagligen 06:00 UTC.</div>`;
    if(countEl) countEl.textContent = '·';
    return;
  }
  renderSignalSourceChips();
  const filtered = signalsCache
    .filter(g => (signalFilter.sent === 'alla' || g.sentiment === signalFilter.sent)
              && (signalFilter.source === 'alla' || g.source === signalFilter.source)
              && ((g.impact_score || 0) >= signalFilter.imp))
    .sort((a,b) => (b.impact_score||0) - (a.impact_score||0)
                || new Date(b.published_at||0) - new Date(a.published_at||0));

  if(countEl) countEl.textContent = '· ' + filtered.length + ' nyheter';
  if(!filtered.length) {
    list.innerHTML = `<div class="muted" style="padding:20px 4px">Inga signaler matchar filtret.</div>`;
    return;
  }
  list.innerHTML = filtered.map(signalCard).join('');
}

function signalCard(g) {
  const cls = g.sentiment === 'positiv' ? 'pos' : g.sentiment === 'negativ' ? 'neg' : 'neu';
  const col = g.sentiment === 'positiv' ? 'var(--green)' : g.sentiment === 'negativ' ? 'var(--red)' : 'var(--text2)';
  const imp = g.impact_score == null ? 0 : g.impact_score;
  const sent = g.sentiment ? g.sentiment.charAt(0).toUpperCase() + g.sentiment.slice(1) : '–';
  const chips = g.tickers.length
    ? g.tickers.map(t => `<span class="ticker-chip" onclick="loadStock('${escQuote(t)}','${escQuote(t)}')">${escHtml(t)}</span>`).join('')
    : `<span class="ticker-chip macro">Makro</span>`;
  const link = g.url ? `<span class="signal-dot">·</span><a href="${escHtml(g.url)}" target="_blank" rel="noopener">Läs mer ↗</a>` : '';
  const modelShort = g.model ? g.model.replace('claude-', '').replace(/-\d.*$/, '').replace(/^\w/, c => c.toUpperCase()) : '';
  const badge = g.analysis ? `<span class="deep-badge">✦ Djupanalys${modelShort ? ' · ' + escHtml(modelShort) : ''}</span>` : '';
  const deepBlock = g.analysis
    ? `<div class="signal-deep"><b>Fördjupad analys</b>${escHtml(g.analysis)}</div>`
    : '';
  return `<div class="signal-item ${cls}">
    <div class="signal-impact">
      <div class="signal-impact-val" style="color:${col}">${imp.toFixed(2)}</div>
      <div class="signal-impact-bar"><i style="width:${Math.round(imp*100)}%;background:${col}"></i></div>
      <div class="signal-impact-lbl">Påverkan</div>
    </div>
    <div class="signal-body">
      <div class="signal-summary">${escHtml(g.summary || '')}</div>
      ${deepBlock}
      <div class="signal-meta">
        ${chips}
        ${badge}
        <span class="signal-sent" style="color:${col}">${escHtml(sent)}</span>
        <span class="signal-dot">·</span><span>${escHtml(sourceLabel(g.source))}</span>
        <span class="signal-dot">·</span><span>${timeAgo(g.published_at)}</span>
        ${link}
      </div>
    </div>
  </div>`;
}

function setSignalFilter(el, kind) {
  const attr = kind === 'sent' ? 'data-sent' : kind === 'source' ? 'data-src' : 'data-imp';
  document.querySelectorAll('#section-signals [' + attr + ']').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  if(kind === 'sent') signalFilter.sent = el.getAttribute('data-sent');
  else if(kind === 'source') signalFilter.source = el.getAttribute('data-src');
  else signalFilter.imp = parseFloat(el.getAttribute('data-imp'));
  applySignalFilters();
}

// Källfiltret byggs av de källor som faktiskt finns i datan – ett chip per källa,
// så forumsignaler går att plocka fram (och en tom Reddit-natt inte lämnar ett dött val).
function renderSignalSourceChips() {
  const row = document.getElementById('signals-source-filters');
  if(!row || !signalsCache) return;
  const counts = {};
  for(const g of signalsCache) counts[g.source] = (counts[g.source] || 0) + 1;
  const sources = Object.keys(counts).sort((a,b) => counts[b] - counts[a]);
  if(!sources.includes(signalFilter.source)) signalFilter.source = 'alla';
  row.innerHTML = [`<div class="filter-chip${signalFilter.source==='alla'?' on':''}" data-src="alla" onclick="setSignalFilter(this,'source')">Alla källor</div>`]
    .concat(sources.map(s =>
      `<div class="filter-chip${signalFilter.source===s?' on':''}" data-src="${escHtml(s)}" onclick="setSignalFilter(this,'source')">${escHtml(sourceLabel(s))} <span style="color:var(--text3)">${counts[s]}</span></div>`
    )).join('');
}
