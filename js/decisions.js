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
function saveDecisionsLocal() { try { localStorage.setItem('ai_decisions', JSON.stringify(aiDecisionsLocal.slice(0, 2000))); } catch(e) {} }

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
    if(Date.now() < due) { out.h[k] = { pending: Math.ceil((due - Date.now()) / 86400000) }; continue; }
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

async function renderTrack() {
  const body = document.getElementById('track-body'), filters = document.getElementById('track-filters');
  if(!body) return;
  filters.innerHTML = [['alla', 'Alla'], ...Object.entries(DECISION_SOURCES)]
    .map(([k, l]) => `<div class="filter-chip${trackFilter === k ? ' on' : ''}" onclick="setTrackFilter('${k}')">${l}</div>`).join('');
  body.innerHTML = '<div class="info-msg">Hämtar beslut och kurshistorik…</div>';
  const all = await loadDecisions();
  const list = trackFilter === 'alla' ? all : all.filter(d => d.source === trackFilter);
  const cloudNote = decisionsCloudMissing
    ? '<div class="info-msg" style="background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.25)">Tabellen <b>ai_decisions</b> saknas i Supabase – loggen sparas bara i den här webbläsaren. Kör <b>supabase-ai-decisions.sql</b> i Supabase → SQL Editor.</div>' : '';
  if(!list.length) {
    body.innerHTML = cloudNote + `<div class="info-msg">Inga beslut loggade${trackFilter === 'alla' ? '' : ' för ' + DECISION_SOURCES[trackFilter]} än. Kör <b>AI-triage</b> i Aktiescreenern, <b>Portföljgenomlysning</b> eller <b>Institutionell djupanalys</b> – rekommendationerna hamnar här automatiskt.</div>`;
    return;
  }
  const since = Math.min(...list.map(d => new Date(d.created_at).getTime()));
  const hist = await trackHistories([...new Set([...list.map(d => d.ticker), ...list.map(d => d.benchmark)])], since);
  const rows = list.map(d => ({ d, o: decisionOutcome(d, hist) }));

  // Sammanfattning per källa: träffprocent per horisont + snittets "AI-alfa" (överavkastning i AI:ns riktning).
  const pct = v => v == null ? '–' : (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1).replace('.', ',') + ' %';
  const summary = (label, rs) => {
    const directed = rs.filter(r => r.d.direction && r.o.sinceExcess != null);
    const alpha = directed.length ? directed.reduce((s, r) => s + r.d.direction * r.o.sinceExcess, 0) / directed.length : null;
    const hits = TRACK_HORIZONS.map(([k, , lbl]) => {
      const done = rs.filter(r => r.o.h[k] && r.o.h[k].hit != null);
      const n = done.filter(r => r.o.h[k].hit).length;
      return `<div class="kpi-sub">${lbl}: ${done.length ? `<b style="color:${n / done.length >= 0.5 ? 'var(--green)' : 'var(--red)'}">${Math.round(n / done.length * 100)} %</b> <span class="muted">(${n}/${done.length})</span>` : '<span class="muted">väntar</span>'}</div>`;
    }).join('');
    return `<div class="kpi-card"><div class="kpi-label">${label} · ${rs.length} beslut</div>
      <div class="kpi-value" style="color:${alpha == null ? 'var(--text)' : alpha >= 0 ? 'var(--green)' : 'var(--red)'}" title="Snittlig överavkastning mot index sedan beslutet, i AI:ns riktning (för Sälj räknas en sämre aktie som plus)">${pct(alpha)}</div>
      <div class="kpi-sub muted">AI-alfa sedan beslut</div>${hits}</div>`;
  };
  const groups = trackFilter === 'alla'
    ? [summary('Alla', rows), ...Object.entries(DECISION_SOURCES).map(([k, l]) => { const rs = rows.filter(r => r.d.source === k); return rs.length ? summary(l, rs) : ''; })]
    : [summary(DECISION_SOURCES[trackFilter], rows)];

  const cell = v => `<td style="text-align:right;color:${v == null ? 'var(--text3)' : v >= 0 ? 'var(--green)' : 'var(--red)'}">${pct(v)}</td>`;
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

  body.innerHTML = cloudNote + `<div class="kpi-grid" style="margin-bottom:14px">${groups.join('')}</div>
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
