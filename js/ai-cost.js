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

// ── Anthropic-krediter ──
// Anthropic har inget API för kontots saldo, så du anger saldot som står i Billing; appen
// drar sedan av allt som loggats i ai_usage sedan dess (din + motorns kostnad) och varnar
// när det uppskattade saldot understiger varningsgränsen eller räcker mindre än en vecka.
// Tar krediterna slut på riktigt märks det på två sätt: ett anrop här får felet (sparas som
// 'ai_credits_out_at') eller motorn lämnar en rad med context 'engine-credits-out'.
const ANTHROPIC_BILLING_URL = 'https://console.anthropic.com/settings/billing';
const CREDITS_OUT_CTX = 'engine-credits-out';
const AI_CREDIT_KEY = 'ai_credit_balance';      // { usd, at } – saldot du angav och när
const AI_CREDIT_WARN_KEY = 'ai_credit_warn_usd'; // varningsgräns i USD
const AI_CREDITS_OUT_KEY = 'ai_credits_out_at';  // när ett anrop här senast stoppades av krediterna
const AI_CREDIT_WARN_DEFAULT = 5;
const AI_CREDIT_WARN_DAYS = 7;
const AI_CREDITS_OUT_MSG = 'Krediterna på Anthropic-kontot är slut. Fyll på under console.anthropic.com → Billing (länk finns under AI-kostnader).';
let aiCreditCache = null; // { at, ...status } – max 60 s gammal

function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){ try { if(v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch(e){} }
function getAiCreditBalance(){ try { const o = JSON.parse(lsGet(AI_CREDIT_KEY)); return o && isFinite(o.usd) && o.at ? o : null; } catch(e){ return null; } }
function getAiCreditWarn(){ const v = parseFloat(lsGet(AI_CREDIT_WARN_KEY)); return isFinite(v) && v >= 0 ? v : AI_CREDIT_WARN_DEFAULT; }

// Nytt saldo från Billing = du har (troligen) fyllt på → nollställ stoppmarkeringen.
function setAiCreditBalance(v){
  const n = pfNum(v);
  lsSet(AI_CREDIT_KEY, n != null && n >= 0 ? JSON.stringify({ usd: n, at: new Date().toISOString() }) : null);
  lsSet(AI_CREDITS_OUT_KEY, null);
  aiCreditCache = null;
  renderAiCredits(); renderAiCreditBanner();
}
function setAiCreditWarn(v){ const n = pfNum(v); lsSet(AI_CREDIT_WARN_KEY, n != null && n >= 0 ? String(n) : null); aiCreditCache = null; renderAiCredits(); renderAiCreditBanner(); }

// Översätter ett API-fel till text; känner igen slut på krediter och tänder varningen.
function aiErrorMessage(err){
  const m = typeof err === 'string' ? err : (err && (err.message || err.type)) || 'API-fel'; // proxyn svarar t.ex. { error: 'Ingen API-nyckel angiven' }
  if(!/credit balance is too low/i.test(m)) return m;
  lsSet(AI_CREDITS_OUT_KEY, new Date().toISOString());
  aiCreditCache = null;
  renderAiCreditBanner();
  return AI_CREDITS_OUT_MSG;
}

// Läget just nu: { out, outAt, outBy, balance, spent, left, perDay, daysLeft, low }.
async function aiCreditStatus(force){
  if(!force && aiCreditCache && Date.now() - aiCreditCache.at < 60000) return aiCreditCache;
  const bal = getAiCreditBalance();
  const balAt = bal ? Date.parse(bal.at) : 0;
  const st = { balance: bal, out: false, outAt: null, outBy: null, spent: null, left: null, perDay: null, daysLeft: null, low: false };

  const localOut = lsGet(AI_CREDITS_OUT_KEY);
  if(localOut && Date.parse(localOut) > balAt) { st.out = true; st.outAt = localOut; st.outBy = 'du'; }

  if(cloudEnabled && sb && currentUser){
    const weekAgo = Date.now() - 7 * 86400000;
    const from = new Date(bal ? Math.min(balAt, weekAgo) : weekAgo).toISOString();
    const { data, error } = await sb.from('ai_usage').select('created_at,context,cost_usd').gte('created_at', from).order('created_at', { ascending: false }).limit(20000);
    if(!error){
      let spent = 0, week = 0;
      for(const r of data || []){
        const t = Date.parse(r.created_at);
        if(r.context === CREDITS_OUT_CTX){
          // Motorns stopp räknas bara om det är nyare än saldot du angav (annars har du fyllt på sedan dess).
          if(t > balAt && (!st.outAt || t > Date.parse(st.outAt))) { st.out = true; st.outAt = r.created_at; st.outBy = 'motorn'; }
          continue;
        }
        if(bal && t >= balAt) spent += +r.cost_usd || 0;
        if(t >= weekAgo) week += +r.cost_usd || 0;
      }
      st.perDay = week / 7;
      if(bal){
        st.spent = spent;
        st.left = bal.usd - spent;
        st.daysLeft = st.perDay > 0 ? st.left / st.perDay : null;
        st.low = st.left < getAiCreditWarn() || (st.daysLeft != null && st.daysLeft < AI_CREDIT_WARN_DAYS);
      }
    }
  }
  aiCreditCache = { at: Date.now(), ...st };
  return aiCreditCache;
}

const fmtUsd = v => '$' + v.toFixed(2);
const fmtDays = d => { const n = Math.max(0, Math.floor(d)); return n + (n === 1 ? ' dag' : ' dagar'); };
const fmtWhen = iso => new Date(iso).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const billingLink = (txt) => `<a href="${ANTHROPIC_BILLING_URL}" target="_blank" rel="noopener" style="color:inherit;font-weight:600;text-decoration:underline">${txt}</a>`;

// Varningsrad överst på alla sidor (ovanför sektionerna). Kan stängas för den här visningen.
let aiCreditBannerClosed = false;
async function renderAiCreditBanner(){
  const el = document.getElementById('ai-credit-banner');
  if(!el) return;
  let s = null;
  try { s = await aiCreditStatus(false); } catch(e){}
  if(!s || aiCreditBannerClosed || !(s.out || s.low)) { el.innerHTML = ''; return; }
  const red = s.out;
  const text = red
    ? `<b>Anthropic-krediterna är slut</b> – ${s.outBy === 'motorn' ? 'motorn stoppades' : 'en AI-körning stoppades'} ${fmtWhen(s.outAt)}. Inga AI-analyser körs förrän du fyllt på.`
    : `<b>Anthropic-krediterna börjar ta slut</b> – uppskattningsvis ${fmtUsd(Math.max(0, s.left))} kvar${s.daysLeft != null ? `, räcker ca ${fmtDays(s.daysLeft)}` : ''}.`;
  el.innerHTML = `<div class="info-msg" style="margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:${red ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)'};border-color:${red ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'};color:var(--text)">
    <span style="flex:1;min-width:220px">⚠ ${text}</span>
    ${billingLink('Fyll på hos Anthropic ↗')}
    <span class="card-link" style="float:none" onclick="showSection('aicost')">AI-kostnader</span>
    <span style="cursor:pointer;color:var(--text3);font-size:16px;line-height:1" title="Dölj" onclick="aiCreditBannerClosed=true;renderAiCreditBanner()">×</span>
  </div>`;
}

async function renderAiCredits(){
  const el = document.getElementById('aicost-credits');
  if(!el) return;
  let s = null;
  try { s = await aiCreditStatus(true); } catch(e){}
  const bal = getAiCreditBalance();
  const warn = getAiCreditWarn();
  let status;
  if(!currentUser) status = '<span class="muted">Logga in för att följa saldot – kostnaderna läses ur kostnadsloggen.</span>';
  else if(s && s.out) status = `<span style="color:var(--red)"><b>Slut</b> – ${s.outBy === 'motorn' ? 'motorn stoppades' : 'en AI-körning stoppades'} ${fmtWhen(s.outAt)}.</span> Fyll på och skriv in det nya saldot här.`;
  else if(s && bal && s.left != null) status = `Uppskattat kvar: <b style="color:${s.low ? 'var(--amber)' : 'var(--green)'}">${fmtUsd(s.left)}</b>`
    + ` <span class="muted">· ${fmtUsd(bal.usd)} angivet ${fmtWhen(bal.at)} − ${fmtUsd(s.spent)} förbrukat sedan dess`
    + (s.perDay ? ` · senaste veckan ${fmtUsd(s.perDay)}/dag${s.daysLeft != null ? ` → räcker ca ${fmtDays(s.daysLeft)}` : ''}` : '') + '</span>';
  else status = '<span class="muted">Skriv in saldot från Billing så varnar appen innan det tar slut.</span>';
  const pct = (s && bal && bal.usd > 0 && s.left != null) ? Math.max(0, Math.min(100, s.left / bal.usd * 100)) : null;
  el.innerHTML = `<div class="card" style="margin:14px 0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px"><div class="card-title" style="margin-bottom:4px">Anthropic-krediter</div><div style="font-size:13px">${status}</div></div>
      <a class="ghost-btn" href="${ANTHROPIC_BILLING_URL}" target="_blank" rel="noopener" style="text-decoration:none;white-space:nowrap">Anthropic Billing ↗</a>
    </div>
    ${pct != null ? `<div style="height:8px;background:var(--surface2);border-radius:4px;margin-top:12px;overflow:hidden"><div style="height:100%;width:${pct.toFixed(1)}%;background:${s.low ? 'var(--amber)' : 'var(--green)'}"></div></div>` : ''}
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px">
      <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px">Saldo i Billing nu (USD)
        <input class="filter-input" type="number" min="0" step="0.01" style="width:90px" placeholder="t.ex. 20" onchange="setAiCreditBalance(this.value)"></label>
      <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px">Varna under (USD)
        <input class="filter-input" type="number" min="0" step="1" style="width:70px" value="${warn}" onchange="setAiCreditWarn(this.value)"></label>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px">Anthropic visar inte saldot för appen, så skriv in det som står i Billing (gärna efter varje påfyllning). Appen drar av loggade kostnader – dina och motorns – och varnar överst på alla sidor när saldot understiger gränsen eller räcker mindre än ${AI_CREDIT_WARN_DAYS} dagar. Det är en uppskattning: körningar när du är utloggad loggas inte. Säkrast är att slå på <b>auto-reload</b> i Billing så fylls kontot på automatiskt. Sparas i den här webbläsaren.</div>
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
  renderAiCredits();
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
    renderAiCostBody((data || []).filter(r => r.context !== CREDITS_OUT_CTX)); // stoppmarkeringen är inget anrop
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
