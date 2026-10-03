// conny-stocks · AI-fonder.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ AI-FOND (AI-förvaltad fiktiv portfölj) ══════════
let aiFunds = (function(){ try { const s = localStorage.getItem('ai_funds'); if(s) return JSON.parse(s); } catch(e){} return []; })();
let currentFundView = null;
let aifChartInstance = null;
const AIF_INDICES = [
  { label: 'S&P 500', sym: '^GSPC' },
  { label: 'OMXS30', sym: '^OMX' },
  { label: 'Nasdaq', sym: '^IXIC' },
  { label: 'MSCI World', sym: 'URTH' }
];
const AIF_CREATE_TOOL = {
  name: 'create_portfolio',
  description: 'Skapa en fiktiv aktieportfölj.',
  input_schema: { type: 'object', properties: {
    fund_name: { type: 'string', description: 'kort namn på fonden' },
    strategy: { type: 'string', description: 'kort strategi/tes på svenska (1–3 meningar)' },
    holdings: { type: 'array', description: '5–15 innehav som summerar till ~100% vikt', items: { type: 'object', properties: {
      name: { type: 'string', description: 'bolagets/fondens namn' },
      ticker: { type: 'string', description: 'Yahoo Finance-symbol om känd (AAPL, VOLV-B.ST, ASML.AS), annars tom' },
      weight: { type: 'number', description: 'vikt i procent (0–100)' },
      rationale: { type: 'string', description: 'kort motivering (max ~12 ord)' }
    }, required: ['name', 'weight'] } }
  }, required: ['strategy', 'holdings'] }
};
const AIF_REBALANCE_TOOL = {
  name: 'rebalance_portfolio',
  description: 'Returnera den nya (omviktade) portföljen efter omvärdering.',
  input_schema: { type: 'object', properties: {
    commentary: { type: 'string', description: 'kort kommentar på svenska om vad som ändras och varför' },
    strategy: { type: 'string', description: 'uppdaterad kort strategi (valfri)' },
    holdings: { type: 'array', description: 'hela den nya portföljen, vikter summerar ~100%', items: { type: 'object', properties: {
      name: { type: 'string' }, ticker: { type: 'string' }, weight: { type: 'number' }, rationale: { type: 'string' }
    }, required: ['name', 'weight'] } }
  }, required: ['commentary', 'holdings'] }
};

function saveAIFundsLocal(){ try { localStorage.setItem('ai_funds', JSON.stringify(aiFunds)); } catch(e){} }
async function pushAIFundCloud(f){ if(!sb || !currentUser) return; try { await sb.from('ai_funds').upsert({ id: f.id, user_id: currentUser.id, data: f, created_at: f.createdAt }, { onConflict: 'id' }); } catch(e){ console.warn('ai_funds push:', e.message); } }
async function pullAIFundsCloud(){ if(!sb || !currentUser) return null; try { const { data } = await sb.from('ai_funds').select('data').order('created_at', { ascending: false }); if(data) return data.map(r => r.data); } catch(e){} return null; }

async function aiToolCall(model, system, userText, tool, web){
  if(!getApiKey()) throw new Error('Ingen API-nyckel angiven.');
  if(!(await aiBudgetGate())) throw new Error(AI_BUDGET_STOP);
  const body = { model, max_tokens: 3000, system, messages: [{ role: 'user', content: userText }], tools: [tool] };
  if(web){
    const st = /haiku/.test(model) ? 'web_search_20250305' : 'web_search_20260209';
    body.tools.push({ type: st, name: 'web_search', max_uses: 3 });
    body.tool_choice = { type: 'auto' };
  } else body.tool_choice = { type: 'tool', name: tool.name };
  const r = await fetch('/api/claude', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': getApiKey() }, body: JSON.stringify(body) });
  const rawText = await r.text();
  let data;
  try { data = JSON.parse(rawText); }
  catch(_){ throw new Error((r.status === 524 || /error code: 5\d\d/i.test(rawText)) ? 'Servern hann inte svara i tid (timeout, ~100 s). Detta händer oftast med webbsök på. Prova igen, stäng av webbsök för fonden, eller låt serverns dagliga jobb sköta omvärderingen (Auto-omvärdera).' : ('Ogiltigt svar från servern (' + r.status + ').')); }
  if(data && data.error) throw new Error(data.error.message || data.error.type || 'API-fel');
  const tu = (data.content||[]).find(b => b.type === 'tool_use' && b.name === tool.name);
  if(!tu) throw new Error('AI:n returnerade ingen portfölj – prova igen eller en annan modell.');
  aiSessionCostUsd += costUsdOf(model, data.usage);
  recordAiUsage('aifund', model, data.usage);
  return { input: tu.input, usage: data.usage };
}

async function getFxRates(ccys){
  const norm = ccys.map(c => (c||'SEK').toUpperCase());
  const syms = [...new Set(norm.map(c => FX_SYMBOL[c]).filter(Boolean))];
  const fx = { SEK: 1 };
  if(syms.length){ try { const fd = await fetchSparkData(syms); norm.forEach(c => { if(c === 'SEK') fx[c] = 1; else { const s = FX_SYMBOL[c]; if(s && fd[s]) fx[c] = fd[s].price; } }); } catch(e){} }
  return fx;
}

// AI-innehav → prissatta innehav (löser tickers, hämtar kurser, fördelar budgeten).
async function buildFundHoldings(rawHoldings, budget){
  const items = (rawHoldings||[]).map(h => ({ name: (h.name||'').trim() || (h.ticker||'').trim(), ticker: (h.ticker||'').trim(), weight: Number(h.weight)||0, rationale: (h.rationale||'').trim() }));
  // Lös ticker via namn för de som saknar/är ogiltiga.
  let q = {}; const provided = items.map(i => i.ticker).filter(Boolean);
  if(provided.length){ try { q = await fetchQuotesChunked([...new Set(provided)]); } catch(e){} }
  for(const it of items){
    if(!it.ticker || !q[it.ticker] || q[it.ticker].price == null){
      try { const cand = await resolveBestTicker({ isin: '', namn: it.name }); if(cand) it.ticker = cand; } catch(e){}
    }
  }
  const all = [...new Set(items.map(i => i.ticker).filter(Boolean))];
  q = all.length ? await fetchQuotesChunked(all) : {};
  const ccys = all.map(t => { const d = q[t]; return d && d.currency ? normPriceCurrency(d.currency).ccy : 'SEK'; });
  const fx = await getFxRates(ccys.length ? ccys : ['SEK']);
  // Behåll bara innehav vi kan prissätta (kurs + valutakurs), och normalisera
  // vikterna över DESSA – annars investeras inte hela budgeten (om en ticker inte
  // gick att prissätta blev resten < startbeloppet).
  const ok = items.filter(it => { const d = q[it.ticker]; if(!d || d.price == null) return false; const pc = normPriceCurrency(d.currency); return fx[(pc.ccy||'SEK').toUpperCase()] != null; });
  const tot = ok.reduce((s, i) => s + i.weight, 0) || 1;
  const holdings = [];
  for(const it of ok){
    const d = q[it.ticker]; const pc = normPriceCurrency(d.currency); const price = d.price / pc.div; const ccy = pc.ccy;
    const rate = fx[(ccy||'SEK').toUpperCase()];
    const amount = budget * (it.weight / tot);
    const shares = amount / (price * rate);
    if(!isFinite(shares) || shares <= 0) continue;
    holdings.push({ ticker: it.ticker, name: it.name, weight: +((it.weight/tot)*100).toFixed(1), shares: +shares.toFixed(6), buyPrice: +price.toFixed(4), currency: ccy, rationale: it.rationale });
  }
  return holdings;
}

// Vad ändrades mellan gammal och ny portfölj (köpt/sålt/ökat/minskat per ticker).
function diffHoldings(oldH, newH){
  const om = new Map((oldH||[]).map(h => [h.ticker, h]));
  const nm = new Map((newH||[]).map(h => [h.ticker, h]));
  const changes = [];
  for(const [t, h] of nm){ if(!om.has(t)) changes.push({ type: 'köpt', ticker: t, name: h.name, to: h.weight }); }
  for(const [t, h] of om){ if(!nm.has(t)) changes.push({ type: 'sålt', ticker: t, name: h.name, from: h.weight }); }
  for(const [t, h] of nm){ const o = om.get(t); if(o){ const d = (h.weight||0) - (o.weight||0); if(Math.abs(d) >= 1) changes.push({ type: d > 0 ? 'ökat' : 'minskat', ticker: t, name: h.name, from: o.weight, to: h.weight }); } }
  return changes;
}
function changeLabel(c){
  if(c.type === 'köpt') return `🟢 Köpt <b>${escHtml(c.name||c.ticker)}</b> (${c.to}%)`;
  if(c.type === 'sålt') return `🔴 Sålt <b>${escHtml(c.name||c.ticker)}</b>`;
  return `${c.type === 'ökat' ? '▲' : '▼'} <b>${escHtml(c.name||c.ticker)}</b> ${c.from}%→${c.to}%`;
}

// Sparar/uppdaterar dagens NAV-punkt (verkligt uppmätt värde) i fondens historik.
// Skrivs både av klienten (vid visning) och av bakgrundsmotorn (dagligen) – vem som
// helst som redan har räknat ut ett verkligt `total` för idag kan logga det.
function recordFundNav(f, valueSek){
  if(valueSek == null || !isFinite(valueSek)) return;
  const day = new Date().toISOString().slice(0,10);
  f.navHistory = f.navHistory || [];
  const i = f.navHistory.findIndex(p => p.date === day);
  if(i >= 0) f.navHistory[i].valueSek = Math.round(valueSek);
  else f.navHistory.push({ date: day, valueSek: Math.round(valueSek) });
  if(f.navHistory.length > 3650) f.navHistory = f.navHistory.slice(-3650);
}

function fundValue(f, quotes, fx){
  let total = 0, partial = false;
  for(const h of f.holdings){
    const q = quotes[h.ticker];
    const pc = q && q.currency ? normPriceCurrency(q.currency) : null;
    const price = q && q.price != null ? (pc ? q.price/pc.div : q.price) : null;
    const ccy = pc ? pc.ccy : h.currency;
    const rate = fx[(ccy||'SEK').toUpperCase()];
    const v = (price != null && rate != null) ? price*h.shares*rate : null;
    if(v != null) total += v; else partial = true;
  }
  return { total, partial };
}

async function indexReturnSince(sym, sinceMs){
  const days = (Date.now() - sinceMs) / 86400000;
  const range = days <= 25 ? '1mo' : days <= 80 ? '3mo' : days <= 180 ? '6mo' : days <= 350 ? '1y' : '2y';
  let s; try { s = await fetchChartSeries(sym, range, '1d'); } catch(e){ return null; }
  if(!s || !s.closes.length) return null;
  let base = null;
  for(let i = 0; i < s.ts.length; i++){ if(s.ts[i]*1000 >= sinceMs && s.closes[i] != null){ base = s.closes[i]; break; } }
  if(base == null) base = s.closes.find(c => c != null);
  const last = [...s.closes].reverse().find(c => c != null);
  if(base == null || last == null) return null;
  return ((last - base) / base) * 100;
}

function modelOptionsHtml(sel){
  let vals = []; const el = document.getElementById('model-select');
  if(el && el.options.length) vals = [...el.options].map(o => o.value);
  if(!vals.length) vals = ['claude-haiku-4-5','claude-sonnet-4-6','claude-sonnet-5','claude-opus-4-8','claude-fable-5'];
  return vals.map(v => `<option value="${v}"${v===sel?' selected':''}>${v.replace('claude-','')}</option>`).join('');
}

function openFund(id){ currentFundView = id; renderAIFund(); }
function backToFundList(){ currentFundView = null; renderAIFund(); }

async function renderAIFund(){
  const view = document.getElementById('aifund-view'); if(!view) return;
  if(sb && currentUser){ const cloud = await pullAIFundsCloud(); if(cloud){ aiFunds = cloud; saveAIFundsLocal(); } }
  if(currentFundView){ const f = aiFunds.find(x => x.id === currentFundView); if(f) return renderFundDetail(f, view); currentFundView = null; }
  renderFundList(view);
}

function renderFundList(view){
  const cards = aiFunds.map(f => `
    <div class="pf-card" style="cursor:pointer;margin-bottom:10px" onclick="openFund('${escQuote(f.id)}')">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><div style="font-weight:600">${escHtml(f.name)}</div><div style="font-size:11px;color:var(--text3)">${escHtml(f.model.replace('claude-',''))} · ${f.holdings.length} innehav · start ${fmtSekNum(f.startValueSek,0)} kr · ${new Date(f.createdAt).toLocaleDateString('sv-SE')}</div></div>
        <div style="color:var(--text3);font-size:18px">›</div>
      </div>
    </div>`).join('');
  view.innerHTML = `
    <div class="pf-card">
      <div style="font-weight:600;margin-bottom:10px">Skapa ny AI-fond</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:10px">
        <label style="font-size:12px;color:var(--text2)">Namn (valfritt)<input id="aif-name" placeholder="t.ex. Global Tillväxt" style="width:100%;margin-top:4px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:7px 9px"></label>
        <label style="font-size:12px;color:var(--text2)">Startbelopp (SEK)<input id="aif-budget" value="100000" style="width:100%;margin-top:4px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:7px 9px;font-family:var(--mono)"></label>
        <label style="font-size:12px;color:var(--text2)">Modell<select id="aif-model" style="width:100%;margin-top:4px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:7px 9px">${modelOptionsHtml('claude-sonnet-5')}</select></label>
        <label style="font-size:12px;color:var(--text2)">Omvärdering<select id="aif-interval" style="width:100%;margin-top:4px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:7px 9px">${intervalOptionsHtml(7)}</select></label>
        <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px;align-self:end;padding-bottom:8px"><input type="checkbox" id="aif-web"> Låt AI söka på nätet (dyrare)</label>
        <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px;align-self:end;padding-bottom:8px" title="Motorn omvärderar fonden automatiskt enligt intervallet – även när appen är stängd (körs dagligen på servern)."><input type="checkbox" id="aif-auto"> Auto-omvärdera enligt intervallet (körs på servern)</label>
      </div>
      <label style="font-size:12px;color:var(--text2)">Instruktioner (strategi, risknivå, hur ofta omvärdering, begränsningar…)</label>
      <textarea id="aif-instr" placeholder="t.ex. Offensiv global tillväxt med fokus på AI och grön energi. Max 10 innehav. Omvärdera varje vecka. Undvik tobak och fossilt." style="width:100%;min-height:80px;margin-top:4px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:9px;font-size:13px;resize:vertical"></textarea>
      <div style="margin-top:10px"><button class="action-btn" id="aif-create-btn" onclick="createAIFund()">✦ Skapa AI-fond</button></div>
    </div>
    ${aiFunds.length ? `<div style="margin-top:16px;margin-bottom:8px;font-weight:600">Dina AI-fonder</div>${cards}` : '<div class="info-msg" style="margin-top:14px">Inga AI-fonder än. Fyll i instruktioner ovan och skapa din första.</div>'}`;
}

async function createAIFund(){
  if(!getApiKey()){ alert('Ingen API-nyckel. Klistra in din nyckel i AI-panelen först.'); return; }
  const name = (document.getElementById('aif-name').value||'').trim();
  const model = document.getElementById('aif-model').value;
  const web = document.getElementById('aif-web').checked;
  const budget = pfNum(document.getElementById('aif-budget').value) || 0;
  const instr = (document.getElementById('aif-instr').value||'').trim();
  const reevalIntervalDays = Number(document.getElementById('aif-interval').value) || 0;
  const autoReeval = document.getElementById('aif-auto').checked;
  if(budget <= 0){ alert('Ange ett startbelopp i SEK.'); return; }
  const btn = document.getElementById('aif-create-btn'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'AI bygger portföljen…';
  try {
    const today = new Date().toLocaleDateString('sv-SE');
    const sys = `Du är en erfaren portföljförvaltare. Skapa en fiktiv aktieportfölj enligt användarens instruktioner och budget. Använd riktiga börstickers i Yahoo Finance-format (t.ex. AAPL, MSFT, VOLV-B.ST, ASML.AS, EQNR.OL). Vikterna (weight, procent) ska summera till ungefär 100. Diversifiera rimligt om inget annat anges. Returnera ALLTID via verktyget create_portfolio.${web ? ' Du kan söka på nätet för aktuell information.' : ''}`;
    const user = `Dagens datum: ${today}. Startbelopp: ${fmtSekNum(budget,0)} SEK.\n\nInstruktioner från användaren:\n${instr || '(inga särskilda – bygg en väldiversifierad global aktieportfölj med 8–12 innehav)'}\n\nSkapa portföljen nu.`;
    const { input, usage } = await aiToolCall(model, sys, user, AIF_CREATE_TOOL, web);
    const holdings = await buildFundHoldings(input.holdings || [], budget);
    if(!holdings.length) throw new Error('Kunde inte prissätta några innehav. Prova igen eller en annan modell.');
    const q = await fetchQuotesChunked(holdings.map(h => h.ticker));
    const fx = await getFxRates([...new Set(holdings.map(h => h.currency))]);
    const startValueSek = fundValue({ holdings }, q, fx).total || budget;
    const f = {
      id: 'aif_' + Date.now().toString(36), name: name || input.fund_name || 'AI-fond',
      model, web, budget, instructions: instr, strategy: input.strategy || '',
      holdings, createdAt: new Date().toISOString(), lastReevalAt: null,
      startValueSek: +startValueSek.toFixed(0),
      reevalLog: [{ date: new Date().toISOString(), commentary: 'Fond skapad. ' + (input.strategy || ''), valueSek: +startValueSek.toFixed(0), costUsd: costUsdOf(model, usage), changes: holdings.map(h => ({ type: 'köpt', ticker: h.ticker, name: h.name, to: h.weight })), holdings: holdings.map(h => ({ ...h })) }],
      reevalIntervalDays, autoReeval
    };
    aiFunds.unshift(f); saveAIFundsLocal(); await pushAIFundCloud(f);
    currentFundView = f.id; renderAIFund();
  } catch(e){ alert('Kunde inte skapa fonden: ' + e.message); btn.disabled = false; btn.textContent = old; }
}

async function deleteAIFund(id){
  if(!confirm('Ta bort denna AI-fond?')) return;
  aiFunds = aiFunds.filter(f => f.id !== id); saveAIFundsLocal();
  if(sb && currentUser){ try { await sb.from('ai_funds').delete().eq('id', id); } catch(e){} }
  currentFundView = null; renderAIFund();
}

async function renderFundDetail(f, view){
  view.innerHTML = '<div class="info-msg">Hämtar kurser…</div>';
  const q = await fetchQuotesChunked(f.holdings.map(h => h.ticker));
  const fx = await getFxRates([...new Set(f.holdings.map(h => h.currency))]);
  const { total, partial } = fundValue(f, q, fx);
  const ret = f.startValueSek ? ((total - f.startValueSek) / f.startValueSek) * 100 : null;
  if(!partial){ recordFundNav(f, total); saveAIFundsLocal(); pushAIFundCloud(f).catch(()=>{}); }
  const created = new Date(f.createdAt).toLocaleDateString('sv-SE');
  const due = fundDueSince(f);
  const totalCost = (f.reevalLog || []).reduce((s, l) => s + (l.costUsd || 0), 0);
  const nReeval = (f.reevalLog || []).length;
  const rows = f.holdings.map(h => {
    const d = q[h.ticker]; const pc = d && d.currency ? normPriceCurrency(d.currency) : null;
    const price = d && d.price != null ? (pc ? d.price/pc.div : d.price) : null;
    const rate = fx[(h.currency||'SEK').toUpperCase()];
    const val = (price != null && rate != null) ? price*h.shares*rate : null;
    const g = (price != null) ? ((price - h.buyPrice)/h.buyPrice)*100 : null;
    const w = (val != null && total) ? (val/total*100) : null;
    return `<tr onclick="loadStock('${escQuote(h.ticker)}','${escQuote(h.name||h.ticker)}')" style="cursor:pointer">
      <td>${escHtml(h.name||h.ticker)}<div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${escHtml(h.ticker)}</div>${h.rationale ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${escHtml(h.rationale)}</div>` : ''}</td>
      <td style="text-align:right">${w != null ? w.toFixed(1)+'%' : '–'}</td>
      <td style="text-align:right">${fmtSekNum(h.buyPrice,2)} ${escHtml(h.currency)}</td>
      <td style="text-align:right">${price != null ? fmtSekNum(price,2) : '–'}</td>
      <td style="text-align:right;color:${g==null?'var(--text3)':(g>=0?'var(--green)':'var(--red)')}">${g != null ? fmtSekPct(g) : '–'}</td>
      <td style="text-align:right">${val != null ? fmtSekNum(val,0)+' kr' : '–'}</td>
    </tr>`;
  }).join('');
  view.innerHTML = `
    <div style="margin-bottom:12px"><button class="ghost-btn" onclick="backToFundList()">← Alla AI-fonder</button></div>
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div><div style="font-size:18px;font-weight:600">${escHtml(f.name)}</div><div style="font-size:12px;color:var(--text3)">${escHtml(f.model.replace('claude-',''))} · ${f.web?'webbsök på':'utan webbsök'} · skapad ${created}${f.lastReevalAt ? ' · omvärderad ' + new Date(f.lastReevalAt).toLocaleDateString('sv-SE') : ''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="action-btn" id="aif-review-btn" onclick="runPortfolioReview('fund','${escQuote(f.id)}')" title="Portfolio Manager: stresstestar fonden mot senaste CIO-analysen och riskbarometern">✦ Kör Portföljgenomlysning</button><button class="action-btn" id="aif-reeval-btn" onclick="reevalAIFund('${escQuote(f.id)}')">↻ Låt AI omvärdera</button><button class="ghost-btn" onclick="deleteAIFund('${escQuote(f.id)}')">Ta bort</button></div>
    </div>
    <div class="pf-card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">
      <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px">Omvärdering:
        <select onchange="setFundInterval('${escQuote(f.id)}', this.value)" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:5px 8px">${intervalOptionsHtml(f.reevalIntervalDays||0)}</select>
      </label>
      <label style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:6px;cursor:pointer" title="Motorn omvärderar automatiskt enligt intervallet – även när appen är stängd (dagligt serverjobb).">
        <input type="checkbox" ${f.autoReeval?'checked':''} onchange="setFundAuto('${escQuote(f.id)}', this.checked)"> Auto-omvärdera (körs på servern)
      </label>
      ${due ? `<span style="font-size:12px;color:var(--amber,#f59e0b)">⏰ Dags att omvärdera (${intervalLabel(f.reevalIntervalDays||0).toLowerCase()})</span>` : (f.reevalIntervalDays ? `<span style="font-size:12px;color:var(--text3)">Nästa: ${new Date((f.lastReevalAt?new Date(f.lastReevalAt).getTime():new Date(f.createdAt).getTime()) + (f.reevalIntervalDays||0)*86400000).toLocaleDateString('sv-SE')}</span>` : '')}
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Värde nu${partial?' (delvis)':''}</div><div class="kpi-value">${fmtSekNum(total,0)} kr</div></div>
      <div class="kpi-card"><div class="kpi-label">Avkastning sedan start</div><div class="kpi-value" style="color:${ret==null?'var(--text)':(ret>=0?'var(--green)':'var(--red)')}">${ret != null ? fmtSekPct(ret) : '–'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Startbelopp</div><div class="kpi-value">${fmtSekNum(f.startValueSek,0)} kr</div></div>
      ${totalCost ? `<div class="kpi-card"><div class="kpi-label">AI-kostnad hittills</div><div class="kpi-value">$${totalCost.toFixed(3)}</div><div class="kpi-sub muted">≈ ${fmtSekNum(totalCost*10.5,0)} kr · ${nReeval} körning${nReeval===1?'':'ar'}</div></div>` : ''}
    </div>
    <div style="margin:-6px 0 12px">${aiGuideHtml('pm')}</div>
    <div id="aif-review-out" class="memo-box"></div>
    ${f.lastReevalError ? `<div class="info-msg" style="margin-bottom:14px;background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.25);color:var(--red)">⚠ Senaste omvärdering misslyckades (${new Date(f.lastReevalError.date).toLocaleString('sv-SE')}): ${escHtml(f.lastReevalError.message)}</div>` : ''}
    ${f.strategy ? `<div class="info-msg" style="margin-bottom:14px"><b>Strategi:</b> ${escHtml(f.strategy)}</div>` : ''}
    <div class="pf-card"><div style="font-weight:600;margin-bottom:8px">Utveckling vs index (sedan ${created})</div><div style="height:260px"><canvas id="aifundChart"></canvas></div></div>
    <div style="overflow-x:auto;margin-top:14px"><table class="pf-table">
      <thead><tr><th style="text-align:left">Innehav</th><th style="text-align:right">Vikt</th><th style="text-align:right">Inköp</th><th style="text-align:right">Kurs</th><th style="text-align:right">Sedan köp</th><th style="text-align:right">Värde</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${(f.reevalLog && f.reevalLog.length) ? `<div class="pf-card" style="margin-top:14px"><div style="font-weight:600;margin-bottom:6px">Historik – ändringar och motiveringar</div>${f.reevalLog.map(l => `
      <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px">
        <div style="font-size:11px;color:var(--text3)">${new Date(l.date).toLocaleString('sv-SE')}${l.valueSek ? ' · värde ' + fmtSekNum(l.valueSek,0) + ' kr' : ''}${l.costUsd ? ' · kostnad $' + l.costUsd.toFixed(4) : ''}</div>
        ${l.commentary ? `<div style="font-size:13px;margin:4px 0">${escHtml(l.commentary)}</div>` : ''}
        ${(l.changes && l.changes.length) ? `<div style="font-size:12px;color:var(--text2);line-height:1.7">${l.changes.map(changeLabel).join('<br>')}</div>` : ''}
      </div>`).join('')}</div>` : ''}`;
  drawFundLine(await buildFundSeries(f, total));
  // Auto-omvärdering när intervallet passerat och användaren aktiverat det (endast medan appen är öppen).
  if(f.reevalIntervalDays && f.autoReeval && due && !aifAutoTriggered.has(f.id)){
    aifAutoTriggered.add(f.id);
    reevalAIFund(f.id, true);
  }
}

// Bär framåt sista kända värdet till varje måldatum (fyller helger/luckor).
function carryForwardValues(dateKeys, entries){
  const out = []; let j = 0, last = null;
  for(const dk of dateKeys){
    while(j < entries.length && entries[j][0] <= dk){ last = entries[j][1]; j++; }
    out.push(last);
  }
  return out;
}
function toPct(vals){
  const base = vals.find(v => v != null);
  return vals.map(v => (v != null && base) ? +(((v - base) / base) * 100).toFixed(2) : null);
}

// Rekonstruerar fondens dagliga värde (i SEK, %-rebaserat mot startbeloppet – samma
// bas som KPI:t "Avkastning sedan start") samt indexens utveckling, sedan fondens start.
//
// Tre källor, från minst till mest exakt (senare skriver över tidigare för samma dag):
//  1) Segmentvis rekonstruktion: varje period använder de innehav som FAKTISKT gällde
//     då (sparade i f.reevalLog[].holdings vid varje ombalansering), inte dagens.
//     Fonder/loggar från innan detta fanns saknar snapshot och faller tillbaka på
//     dagens innehav för den perioden (samma approximation som tidigare).
//  2) f.navHistory: verkliga, uppmätta NAV-punkter loggade dagligen (server + klient).
//  3) liveTotal: dagens verkliga värde – exakt samma tal som visas i KPI:t ovanför.
async function buildFundSeries(f, liveTotal){
  const created = new Date(f.createdAt).getTime();
  const days = (Date.now() - created) / 86400000;
  const range = days <= 25 ? '1mo' : days <= 80 ? '3mo' : days <= 180 ? '6mo' : days <= 350 ? '1y' : '2y';
  const createdKey = new Date(created).toISOString().slice(0,10);

  const log = [...(f.reevalLog||[])].sort((a,b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  const segments = [];
  for(let i = 0; i < log.length; i++){
    const from = new Date(log[i].date).toISOString().slice(0,10);
    const to = (i+1 < log.length) ? new Date(log[i+1].date).toISOString().slice(0,10) : null;
    segments.push({ from, to, holdings: log[i].holdings || f.holdings });
  }
  if(!segments.length) segments.push({ from: createdKey, to: null, holdings: f.holdings });

  const allCcys = [...new Set(segments.flatMap(s => s.holdings.map(h => h.currency)))];
  const fx = await getFxRates(allCcys.length ? allCcys : ['SEK']);
  const valueByDate = new Map();
  const priceCache = new Map();
  for(const seg of segments){
    for(const h of seg.holdings){
      let s = priceCache.get(h.ticker);
      if(s === undefined){ try { s = await fetchChartSeries(h.ticker, range, '1d'); } catch(e){ s = null; } priceCache.set(h.ticker, s); }
      if(!s || !s.ts.length) continue;
      const pc = normPriceCurrency(s.cur || h.currency);
      const rate = fx[(pc.ccy||'SEK').toUpperCase()] != null ? fx[(pc.ccy||'SEK').toUpperCase()] : (fx[(h.currency||'SEK').toUpperCase()] != null ? fx[(h.currency||'SEK').toUpperCase()] : 1);
      s.ts.forEach((t,i) => {
        const c = s.closes[i]; if(c == null) return;
        const key = new Date((t + (s.off||0))*1000).toISOString().slice(0,10);
        if(key < createdKey || key < seg.from || (seg.to && key >= seg.to)) return;
        valueByDate.set(key, (valueByDate.get(key)||0) + (c/pc.div)*h.shares*rate);
      });
    }
  }
  for(const p of (f.navHistory||[])){ if(p.date >= createdKey && p.valueSek != null) valueByDate.set(p.date, p.valueSek); }
  const todayKey = new Date().toISOString().slice(0,10);
  if(liveTotal != null && isFinite(liveTotal)) valueByDate.set(todayKey, liveTotal);

  const dates = [...valueByDate.keys()].sort();
  if(dates.length < 2) return null;
  const base = f.startValueSek || valueByDate.get(dates[0]);
  const fundPct = dates.map(d => base ? +(((valueByDate.get(d) - base) / base) * 100).toFixed(2) : null);
  const indices = [];
  for(const ix of AIF_INDICES){
    let s; try { s = await fetchChartSeries(ix.sym, range, '1d'); } catch(e){ s = null; }
    if(!s || !s.ts.length){ indices.push({ label: ix.label, pct: dates.map(() => null) }); continue; }
    const entries = [];
    s.ts.forEach((t,i) => { const c = s.closes[i]; if(c != null){ const key = new Date((t + (s.off||0))*1000).toISOString().slice(0,10); entries.push([key, c]); } });
    entries.sort((a,b) => a[0] < b[0] ? -1 : 1);
    indices.push({ label: ix.label, pct: toPct(carryForwardValues(dates, entries)) });
  }
  return { dates, fundPct, indices };
}

function drawFundLine(series){
  const ctx = document.getElementById('aifundChart'); if(!ctx) return;
  if(aifChartInstance) aifChartInstance.destroy();
  if(!series){ const c = ctx.getContext('2d'); c.clearRect(0,0,ctx.width,ctx.height); c.fillStyle = '#8b91a8'; c.font = '13px sans-serif'; c.fillText('För lite historik ännu – grafen fylls på efter hand.', 10, 24); return; }
  const idxColors = ['#4f8ef7', '#a78bfa', '#f59e0b', '#22d3ee', '#f472b6'];
  const datasets = [{ label: 'AI-fond', data: series.fundPct, borderColor: '#22c55e', backgroundColor: 'transparent', borderWidth: 2.4, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, spanGaps: true }];
  series.indices.forEach((ix,i) => datasets.push({ label: ix.label, data: ix.pct, borderColor: idxColors[i % idxColors.length], backgroundColor: 'transparent', borderWidth: 1.4, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, spanGaps: true }));
  const labels = series.dates.map(d => new Date(d).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }));
  aifChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'line', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#8b91a8', font: { size: 11 }, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y>=0?'+':''}${c.parsed.y}%` } } },
      scales: { x: { ticks: { color: '#8b91a8', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#8b91a8', font: { size: 10 }, callback: v => (v>=0?'+':'')+v+'%' }, grid: { color: 'rgba(255,255,255,0.04)' } } } }
  });
}

// Omvärderingsintervall
const aifAutoTriggered = new Set();
const INTERVAL_LABELS = { 0:'Manuell', 1:'Varje dag', 7:'Varje vecka', 14:'Varannan vecka', 21:'Var tredje vecka', 30:'Varje månad', 60:'Varannan månad', 90:'Varje kvartal' };
function intervalLabel(days){ return INTERVAL_LABELS[days] || (days + ' dagar'); }
function intervalOptionsHtml(sel){ return [0,1,7,14,21,30,60,90].map(d => `<option value="${d}"${d===sel?' selected':''}>${intervalLabel(d)}</option>`).join(''); }
function fundDueSince(f){ const days = f.reevalIntervalDays||0; if(!days) return false; const base = f.lastReevalAt ? new Date(f.lastReevalAt).getTime() : new Date(f.createdAt).getTime(); return Date.now() >= base + days*86400000; }
async function setFundInterval(id, v){ const f = aiFunds.find(x => x.id === id); if(!f) return; f.reevalIntervalDays = Number(v)||0; saveAIFundsLocal(); await pushAIFundCloud(f); renderAIFund(); }
async function setFundAuto(id, on){ const f = aiFunds.find(x => x.id === id); if(!f) return; f.autoReeval = !!on; saveAIFundsLocal(); await pushAIFundCloud(f); if(on && fundDueSince(f) && !aifAutoTriggered.has(id)){ aifAutoTriggered.add(id); reevalAIFund(id, true); } else renderAIFund(); }

async function reevalAIFund(id, auto){
  const f = aiFunds.find(x => x.id === id); if(!f) return;
  if(!getApiKey()){ if(!auto) alert('Ingen API-nyckel.'); return; }
  if(!auto && !confirm('Låt AI omvärdera och eventuellt ombalansera fonden? Nuvarande innehav ersätts av AI:ns nya förslag (till aktuellt värde).')) return;
  const btn = document.getElementById('aif-reeval-btn'); if(btn){ btn.disabled = true; btn.textContent = 'AI omvärderar…'; }
  try {
    const q = await fetchQuotesChunked(f.holdings.map(h => h.ticker));
    const fx = await getFxRates([...new Set(f.holdings.map(h => h.currency))]);
    const { total } = fundValue(f, q, fx);
    const lines = f.holdings.map(h => {
      const d = q[h.ticker]; const pc = d && d.currency ? normPriceCurrency(d.currency) : null;
      const price = d && d.price != null ? (pc ? d.price/pc.div : d.price) : null;
      const g = (price != null) ? (((price - h.buyPrice)/h.buyPrice)*100).toFixed(1)+'%' : '?';
      return `- ${h.name} (${h.ticker}): vikt ${h.weight}%, sedan köp ${g}`;
    }).join('\n');
    const today = new Date().toLocaleDateString('sv-SE');
    const sys = `Du är portföljförvaltare och omvärderar en befintlig fiktiv fond. Behåll det som fungerar, ombalansera vid behov enligt strategin. Returnera HELA den nya portföljen via verktyget rebalance_portfolio (vikter summerar ~100, Yahoo-tickers) samt en kort kommentar om vad du ändrar och varför.${f.web ? ' Du kan söka på nätet.' : ''}`;
    const user = `Dagens datum: ${today}. Fondens strategi/instruktioner:\n${f.instructions || f.strategy || '(ingen)'}\n\nNuvarande värde: ${fmtSekNum(total,0)} SEK. Nuvarande innehav:\n${lines}\n\nOmvärdera nu.`;
    const { input, usage } = await aiToolCall(f.model, sys, user, AIF_REBALANCE_TOOL, f.web);
    const built = await buildFundHoldings(input.holdings || [], total || f.startValueSek);
    if(!built.length) throw new Error('Kunde inte prissätta de nya innehaven.');
    const changes = diffHoldings(f.holdings, built);
    f.holdings = built;
    if(input.strategy) f.strategy = input.strategy;
    f.lastReevalAt = new Date().toISOString();
    f.reevalLog = f.reevalLog || [];
    f.reevalLog.unshift({ date: f.lastReevalAt, commentary: input.commentary || '', valueSek: Math.round(total), costUsd: costUsdOf(f.model, usage), changes, holdings: built.map(h => ({ ...h })) });
    f.lastReevalError = null;
    recordFundNav(f, total);
    saveAIFundsLocal(); await pushAIFundCloud(f);
    renderAIFund();
  } catch(e){
    // Gör felet synligt och kvarstående i fonden (inte bara en flyktig alert).
    f.lastReevalError = { date: new Date().toISOString(), message: e.message };
    saveAIFundsLocal(); try { await pushAIFundCloud(f); } catch(_){}
    alert('Omvärdering misslyckades: ' + e.message);
    renderAIFund();
  }
}
