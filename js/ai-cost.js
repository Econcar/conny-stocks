// conny-stocks · AI-kostnader.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ AI-KOSTNADER ══════════
const SEK_PER_USD = 10.5;                 // grov omräkning för visning
let aiCostRangeDays = 7;
let aiCostChart = null;
// Läsbara etiketter + om raden är motorn (bakgrund) eller din (on-demand).
const AICOST_CONTEXTS = {
  'engine-triage':     { label: 'Motor · nyhetstriage', bg: true },
  'engine-deep':       { label: 'Motor · djupanalys', bg: true },
  'engine-risk':       { label: 'Motor · riskbarometer', bg: true },
  'engine-megatrends': { label: 'Motor · megatrender', bg: true },
  'engine-discovery':  { label: 'Motor · trendspaning', bg: true },
  'engine-aifund':     { label: 'Motor · AI-fond', bg: true },
  'engine-synthesize': { label: 'Motor · syntes', bg: true },
  'engine-extract':    { label: 'Motor · extraktion', bg: true },
  'chat':              { label: 'Du · AI-chatt', bg: false },
  'analysis':          { label: 'Du · aktieanalys', bg: false },
  'deep_analysis':     { label: 'Du · institutionell djupanalys', bg: false },
  'cio':               { label: 'Du · CIO-analys', bg: false },
  'portfolio_review':  { label: 'Du · portföljgenomlysning', bg: false },
  'screener_triage':   { label: 'Du · AI-triage (screener)', bg: false },
  'engine-cio':        { label: 'Motor · CIO-analys', bg: true },
  'aifund':            { label: 'Du · AI-fond', bg: false }
};
const aiCtxLabel = c => (AICOST_CONTEXTS[c] && AICOST_CONTEXTS[c].label) || c;
const aiCtxIsEngine = c => AICOST_CONTEXTS[c] ? AICOST_CONTEXTS[c].bg : /^engine-/.test(c);

// ── Månadsbudget ──
// Ett tak för AI-kostnaden per kalendermånad (USD, sparas i den här webbläsaren). Före varje
// AI-körning (callClaudeStream och AI-fondens aiToolCall) jämförs månadens kostnad – din och
// motorns, som delar Anthropic-konto – mot taket; är det nått frågar appen innan den kör.
// Månadens kostnad läses ur ai_usage och kräver inloggning (RLS) – utloggad kontrolleras inget.
const AI_BUDGET_KEY = 'ai_budget_usd';
let aiMonthCache = null; // { at, usd, mine, engine } – max 60 s gammal
function getAiBudget(){ try { const v = parseFloat(localStorage.getItem(AI_BUDGET_KEY)); return isFinite(v) && v > 0 ? v : null; } catch(e){ return null; } }
function setAiBudget(v){
  const n = pfNum(v);
  try { if(n > 0) localStorage.setItem(AI_BUDGET_KEY, String(n)); else localStorage.removeItem(AI_BUDGET_KEY); } catch(e){}
  renderAiBudget();
}
async function aiMonthSpend(force){
  if(!cloudEnabled || !sb || !currentUser) return null;
  if(!force && aiMonthCache && Date.now() - aiMonthCache.at < 60000) return aiMonthCache;
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('ai_usage').select('context,cost_usd').gte('created_at', start.toISOString()).limit(20000);
  if(error) return null;
  let mine = 0, engine = 0;
  for(const r of data || []) { if(aiCtxIsEngine(r.context)) engine += +r.cost_usd || 0; else mine += +r.cost_usd || 0; }
  aiMonthCache = { at: Date.now(), usd: mine + engine, mine, engine };
  return aiMonthCache;
}
// Anropas av recordAiUsage, så att nästa kontroll ser körningen utan att vänta på Supabase.
function noteAiSpend(usd){ if(aiMonthCache && usd > 0) { aiMonthCache.usd += usd; aiMonthCache.mine += usd; } }

// true = kör. Frågar bara när taket är nått.
async function aiBudgetGate(){
  const budget = getAiBudget();
  if(!budget) return true;
  let s = null;
  try { s = await aiMonthSpend(false); } catch(e){}
  if(!s || s.usd < budget) return true;
  return confirm(`Månadsbudgeten för AI är förbrukad: $${s.usd.toFixed(2)} av $${budget.toFixed(2)} ` +
    `(du $${s.mine.toFixed(2)}, motorn $${s.engine.toFixed(2)}).\n\nVill du köra ändå?`);
}
const AI_BUDGET_STOP = 'Avbrutet – månadsbudgeten för AI är förbrukad. Höj taket under AI-kostnader om du vill fortsätta.';

async function renderAiBudget(){
  const el = document.getElementById('aicost-budget');
  if(!el) return;
  const budget = getAiBudget();
  let s = null;
  try { s = await aiMonthSpend(true); } catch(e){}
  const month = new Date().toLocaleDateString('sv-SE', { month: 'long' });
  const pct = (budget && s) ? Math.min(100, s.usd / budget * 100) : null;
  const col = pct == null ? 'var(--accent)' : pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)';
  const used = s
    ? `<b>$${s.usd.toFixed(2)}</b> använt i ${month}${budget ? ` av <b>$${budget.toFixed(2)}</b>` : ''} <span class="muted">· du $${s.mine.toFixed(2)} · motorn $${s.engine.toFixed(2)} · ≈ ${fmtSekNum(s.usd * SEK_PER_USD, 0)} kr</span>`
    : '<span class="muted">Logga in för att se månadens kostnad – taket kontrolleras bara när du är inloggad.</span>';
  el.innerHTML = `<div class="card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><div class="card-title" style="margin-bottom:4px">Månadsbudget</div><div style="font-size:13px">${used}</div></div>
      <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px">Tak (USD/månad)
        <input class="filter-input" id="ai-budget-input" type="number" min="0" step="1" style="width:90px" value="${budget != null ? budget : ''}" placeholder="inget" onchange="setAiBudget(this.value)"></label>
    </div>
    ${pct != null ? `<div style="height:8px;background:var(--surface2);border-radius:4px;margin-top:12px;overflow:hidden"><div style="height:100%;width:${pct.toFixed(1)}%;background:${col}"></div></div>` : ''}
    <div style="font-size:11px;color:var(--text3);margin-top:8px">När taket är nått frågar appen innan varje AI-körning. Räknar både dina körningar och motorns (samma Anthropic-konto). Taket sparas i den här webbläsaren.</div>
  </div>`;
}

function setAiCostRange(days, el){
  aiCostRangeDays = days;
  document.querySelectorAll('#section-aicost .filter-chip').forEach(c => c.classList.remove('on'));
  if(el) el.classList.add('on');
  renderAiCost();
}

async function renderAiCost(){
  const el = document.getElementById('aicost-body');
  renderAiBudget();
  if(!cloudEnabled || !sb){ el.innerHTML = '<div class="info-msg">Molnet är inte konfigurerat, så kostnadsloggen kan inte läsas.</div>'; return; }
  el.innerHTML = '<div class="info-msg">Hämtar kostnadslogg…</div>';
  try {
    let q = sb.from('ai_usage')
      .select('created_at,user_id,context,model,input_tokens,output_tokens,cache_read_tokens,cache_create_tokens,web_searches,cost_usd')
      .order('created_at', { ascending: false }).limit(5000);
    if(aiCostRangeDays > 0) q = q.gte('created_at', new Date(Date.now() - aiCostRangeDays*86400000).toISOString());
    const { data, error } = await q;
    if(error) throw new Error(error.message);
    setUpdatedStamp('stamp-aicost');
    renderAiCostBody(data || []);
  } catch(e){
    el.innerHTML = '<div class="info-msg" style="background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.25);color:var(--red)">Kunde inte läsa kostnadsloggen: ' + escHtml(e.message) + '. Har du kört <b>supabase-ai-usage.sql</b> i Supabase?</div>';
  }
}

function renderAiCostBody(rows){
  const el = document.getElementById('aicost-body');
  if(!rows.length){ el.innerHTML = '<div class="info-msg" style="margin-bottom:14px">Inga AI-kostnader loggade i perioden ännu. Motorn loggar varje natt; on-demand-analyser loggas när du är inloggad.</div>' + aiPriceTableHtml(); return; }

  // Modeller utan känt pris – kostnaden för dem är en uppskattning (reservpris).
  const unknownModels = [...new Set(rows.map(r => r.model).filter(m => m && !aiPriceKnown(m)))];
  const priceNote = unknownModels.length
    ? `<div class="info-msg" style="background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.25);margin-bottom:14px">⚠ Okänd prissättning för <b>${unknownModels.map(escHtml).join(', ')}</b> – kostnaden räknas med reservpriset ($3/$15 per 1M tokens) och kan vara fel. Lägg till modellen i pristabellen (AI_PRICES i js/ai-panel.js och PRICES i engine/lib/anthropic.js).</div>`
    : '';

  const inTok = r => (r.input_tokens||0) + (r.cache_read_tokens||0) + (r.cache_create_tokens||0);
  const sum = (arr, f) => arr.reduce((s,r)=>s+f(r),0);
  const engine = rows.filter(r => aiCtxIsEngine(r.context));
  const mine = rows.filter(r => !aiCtxIsEngine(r.context));
  const totCost = sum(rows, r=>+r.cost_usd||0);
  const totIn = sum(rows, inTok), totOut = sum(rows, r=>r.output_tokens||0);
  const searches = sum(rows, r=>r.web_searches||0);

  const tile = (label, val, sub) => `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${val}</div>${sub?`<div class="kpi-sub muted">${sub}</div>`:''}</div>`;
  const kpis = `<div class="kpi-grid" style="margin-bottom:14px">
    ${tile('Total kostnad', '$'+totCost.toFixed(3), '≈ ' + fmtSekNum(totCost*SEK_PER_USD,0) + ' kr')}
    ${tile('Anrop', rows.length.toLocaleString('sv-SE'), (searches?searches+' webbsök · ':'') + engine.length + ' motor / ' + mine.length + ' du')}
    ${tile('Tokens in', (totIn/1e6).toFixed(2)+' M', 'inkl. cache')}
    ${tile('Tokens ut', (totOut/1e6).toFixed(2)+' M', '')}
    ${tile('Motorn (bakgrund)', '$'+sum(engine,r=>+r.cost_usd||0).toFixed(3), 'nattjobbet, din nyckel')}
    ${tile('On-demand (du)', '$'+sum(mine,r=>+r.cost_usd||0).toFixed(3), 'analys, chatt, fond')}
  </div>`;

  // Fördelning per kontext
  const byCtx = {};
  for(const r of rows){ const k=r.context; (byCtx[k] ||= {n:0,cost:0,in:0,out:0}); const b=byCtx[k]; b.n++; b.cost+=+r.cost_usd||0; b.in+=inTok(r); b.out+=r.output_tokens||0; }
  const ctxRows = Object.entries(byCtx).sort((a,b)=>b[1].cost-a[1].cost).map(([c,b])=>`<tr>
    <td>${escHtml(aiCtxLabel(c))}</td><td style="text-align:right">${b.n}</td>
    <td style="text-align:right">${(b.in/1e3).toFixed(0)}k / ${(b.out/1e3).toFixed(0)}k</td>
    <td style="text-align:right">$${b.cost.toFixed(3)}</td>
    <td style="text-align:right">${fmtSekNum(b.cost*SEK_PER_USD,2)} kr</td></tr>`).join('');
  const breakdown = `<div class="card" style="padding:0;margin-bottom:14px"><div class="table-wrap"><table>
    <thead><tr><th>Vad kostar</th><th style="text-align:right">Anrop</th><th style="text-align:right">Tokens in/ut</th><th style="text-align:right">USD</th><th style="text-align:right">SEK</th></tr></thead>
    <tbody>${ctxRows}</tbody></table></div></div>`;

  // Tidslogg (senaste anropen)
  const logRows = rows.slice(0, 200).map(r=>`<tr>
    <td style="white-space:nowrap;font-size:11px;color:var(--text3)">${new Date(r.created_at).toLocaleString('sv-SE')}</td>
    <td>${escHtml(aiCtxLabel(r.context))}</td>
    <td style="font-family:var(--mono);font-size:11px">${escHtml((r.model||'').replace('claude-',''))}${r.model && !aiPriceKnown(r.model) ? ' <span title="Okänt pris – uppskattat" style="color:var(--amber,#f59e0b)">⚠</span>' : ''}</td>
    <td style="text-align:right;font-size:11px">${(inTok(r)/1e3).toFixed(1)}k / ${((r.output_tokens||0)/1e3).toFixed(1)}k</td>
    <td style="text-align:right">$${(+r.cost_usd||0).toFixed(4)}</td></tr>`).join('');
  const log = `<div class="card" style="padding:0"><div style="padding:12px 14px;font-weight:600">Tidslogg · när kostnaderna sker <span class="muted" style="font-weight:400">(senaste ${Math.min(rows.length,200)} anropen, nyast först)</span></div><div class="table-wrap"><table>
    <thead><tr><th>Tidpunkt</th><th>Vad</th><th>Modell</th><th style="text-align:right">In/ut</th><th style="text-align:right">Kostnad</th></tr></thead>
    <tbody>${logRows}</tbody></table></div></div>`;

  el.innerHTML = priceNote + kpis
    + '<div class="card" style="margin-bottom:14px"><div class="card-title">Kostnad per dag (USD)</div><div style="height:180px"><canvas id="aicostChart"></canvas></div></div>'
    + breakdown + aiPriceTableHtml() + log;

  drawAiCostChart(rows);
}

// Staplad dygnsgraf: motor vs on-demand.
function drawAiCostChart(rows){
  const ctx = document.getElementById('aicostChart'); if(!ctx || typeof Chart==='undefined') return;
  const days = {};
  for(const r of rows){ const d=(r.created_at||'').slice(0,10); if(!d) continue; (days[d] ||= {eng:0,mine:0}); if(aiCtxIsEngine(r.context)) days[d].eng+=+r.cost_usd||0; else days[d].mine+=+r.cost_usd||0; }
  const labels = Object.keys(days).sort();
  if(aiCostChart) aiCostChart.destroy();
  aiCostChart = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: { labels: labels.map(d=>d.slice(5)), datasets: [
      { label:'Motor', data: labels.map(d=>+days[d].eng.toFixed(4)), backgroundColor:'rgba(79,142,247,0.7)' },
      { label:'On-demand', data: labels.map(d=>+days[d].mine.toFixed(4)), backgroundColor:'rgba(52,211,153,0.7)' }
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:'#9aa4b2', boxWidth:12 } }, tooltip:{ callbacks:{ label:c=>c.dataset.label+': $'+(+c.raw).toFixed(4) } } },
      scales:{ x:{ stacked:true, ticks:{ color:'#6b7280', maxRotation:0, autoSkip:true } , grid:{display:false}},
               y:{ stacked:true, ticks:{ color:'#6b7280', callback:v=>'$'+v }, grid:{ color:'rgba(255,255,255,0.05)' } } } }
  });
}
