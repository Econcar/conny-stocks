// conny-stocks · AI-panelen (chatten och dess Claude-anrop, modellval, webbsök) och sparade analyser.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ AI PANEL ══════════
function toggleAI() { aiOpen = !aiOpen; document.getElementById('ai-panel').classList.toggle('open', aiOpen); }
function openAI() { aiOpen = true; document.getElementById('ai-panel').classList.add('open'); }

function setAIContext(text) {
  aiContext = text;
  const bar = document.getElementById('context-bar');
  const label = document.getElementById('context-label');
  if(text) { bar.style.display = 'block'; label.textContent = text; }
  else { bar.style.display = 'none'; }
}

function sendSuggestion(el) { sendAIWithText(el.textContent); }

function handleAIKey(e) { if(e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendAIMessage(); } }

function sendAIMessage() {
  const input = document.getElementById('ai-input');
  const text = input.value.trim();
  if(!text) return;
  input.value = '';
  sendAIWithText(text);
}

function sendAIWithText(text, title) {
  openAI();
  appendMsg('user', text);
  aiHistory.push({role:'user', content: text});
  const typingId = appendTyping();
  document.getElementById('send-btn').disabled = true;
  document.getElementById('ai-suggestions').style.display = 'none';
  callClaudeAPI(text, typingId, title);
}

// "Analysera"-knapparna förbereder analysen och väntar på "Kör", så användaren
// hinner välja modell/webbsök innan det (kostsamma) anropet går.
let pendingAnalysis = null;
function stageAnalysis(prompt, title) {
  openAI();
  pendingAnalysis = { prompt, title };
  const existing = document.getElementById('stage-analysis'); if(existing) existing.remove();
  document.getElementById('ai-suggestions').style.display = 'none';
  const msgs = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = 'msg ai'; div.id = 'stage-analysis';
  div.innerHTML = `<div class="msg-label">AI-analytiker</div><div class="msg-bubble">Analysen är förberedd. Välj <strong>modell</strong> längst ner och slå på <strong>Webbsök</strong> om du vill ha färska nätfakta – tryck sedan Kör.<div style="margin-top:10px"><button class="action-btn" onclick="runPendingAnalysis()">▸ Kör analys</button></div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}
function runPendingAnalysis() {
  if(!pendingAnalysis) return;
  const p = pendingAnalysis; pendingAnalysis = null;
  const stage = document.getElementById('stage-analysis'); if(stage) stage.remove();
  sendAIWithText(p.prompt, p.title);
}

function appendMsg(role, text, meta) {
  const msgs = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = `<div class="msg-label">${role==='user'?'Du':'AI-analytiker'}</div><div class="msg-bubble">${formatAIText(text)}${meta ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border);font-size:10px;color:var(--text3);font-family:var(--mono)">${escHtml(meta)}</div>` : ''}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

// Ungefärlig kostnad per anrop utifrån API:ets usage (tokens) + ev. webbsökningar.
// Priser i USD per 1M tokens (in/ut) – samma som Anthropics prislista. Uppdatera BÅDE
// denna och PRICES i engine/lib/anthropic.js om Anthropic ändrar pris. Modeller utanför
// listan räknas med reservpriset ($3/$15) och flaggas som "uppskattat pris".
// (claude-sonnet-5 har intropris $2/$10 t.o.m. 2026-08-31; vi kör standard $3/$15.)
const AI_PRICES = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-fable-5': { in: 10, out: 50 }
};
const aiPriceKnown = model => !!AI_PRICES[model];

// Läsbara modellnamn för prislistan.
const AI_MODEL_NAMES = {
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-fable-5': 'Fable 5'
};

// Referens-prislista över alla modeller (USD + SEK per 1M tokens).
function aiPriceTableHtml(){
  const rows = Object.entries(AI_PRICES)
    .sort((a,b) => a[1].in - b[1].in)
    .map(([id,p]) => `<tr>
      <td>${escHtml(AI_MODEL_NAMES[id] || id)}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">${escHtml(id)}</td>
      <td style="text-align:right">$${p.in.toFixed(2)}</td>
      <td style="text-align:right">$${p.out.toFixed(2)}</td>
      <td style="text-align:right">${fmtSekNum(p.in*SEK_PER_USD,0)} / ${fmtSekNum(p.out*SEK_PER_USD,0)} kr</td>
    </tr>`).join('');
  return `<div class="card" style="padding:0;margin-bottom:14px">
    <div style="padding:12px 14px;font-weight:600">Prislista <span class="muted" style="font-weight:400">· per 1M tokens (in / ut)</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Modell</th><th>ID</th><th style="text-align:right">In (USD)</th><th style="text-align:right">Ut (USD)</th><th style="text-align:right">In / Ut (SEK)</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="padding:10px 14px;font-size:11px;color:var(--text3)">
      Cache-läsning debiteras ~0,1× in-priset, cache-skapande ~1,25×. Webbsök ~$0,01 per sökning.
      SEK ≈ USD × ${SEK_PER_USD}. Anthropics prislista; uppdateras för hand i koden om den ändras.
    </div>
  </div>`;
}
let aiSessionCostUsd = 0;
function estimateCostText(model, usage){
  if(!usage) return '';
  const p = AI_PRICES[model] || { in: 3, out: 15 };
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cRead = usage.cache_read_input_tokens || 0;
  const cCreate = usage.cache_creation_input_tokens || 0;
  const searches = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  const usd = (inTok*p.in + cCreate*p.in*1.25 + cRead*p.in*0.1 + outTok*p.out)/1e6 + searches*0.01;
  aiSessionCostUsd += usd;
  const parts = [
    `≈ $${usd.toFixed(4)}`,
    `${(inTok+cRead+cCreate).toLocaleString('sv-SE')} in / ${outTok.toLocaleString('sv-SE')} ut`,
    model.replace('claude-', '')
  ];
  if(searches) parts.push(`${searches} webbsök`);
  parts.push(`session $${aiSessionCostUsd.toFixed(3)}`);
  return parts.join('  ·  ');
}

// ══════════ SPARADE ANALYSER ══════════
let aiAnalyses = (function(){ try { const s = localStorage.getItem('ai_analyses'); if(s) return JSON.parse(s); } catch(e){} return []; })();
function saveAnalysesLocal(){ try { localStorage.setItem('ai_analyses', JSON.stringify(aiAnalyses.slice(0,100))); } catch(e){} }

async function saveAnalysis(entry){
  aiAnalyses.unshift(entry);
  if(aiAnalyses.length > 100) aiAnalyses = aiAnalyses.slice(0,100);
  saveAnalysesLocal();
  if(sb && currentUser){
    try { await sb.from('analyses').insert({ user_id: currentUser.id, created_at: new Date(entry.ts).toISOString(), title: entry.title, model: entry.model, answer: entry.answer }); }
    catch(e){ console.warn('analys molnspar:', e.message); }
  }
  if(currentSection === 'analyses') renderAnalyses();
  // Portföljanalyser visas även i portföljvyn – uppdatera den om man står där.
  if(currentSection === 'portfolio' && PF_ANALYSIS_TITLES.includes(entry.title||'')) renderPortfolioAnalyses();
}

async function renderAnalyses(){
  const el = document.getElementById('analyses-list');
  if(!el) return;
  let list = aiAnalyses;
  if(sb && currentUser){
    try {
      const { data } = await sb.from('analyses').select('id,created_at,title,model,answer').order('created_at', { ascending: false }).limit(100);
      if(data) list = data.map(r => ({ id: r.id, ts: new Date(r.created_at).getTime(), title: r.title, model: r.model, answer: r.answer, cloud: true }));
    } catch(e){}
  }
  if(!list.length){ el.innerHTML = '<div class="info-msg">Inga sparade analyser än. Kör en AI-analys så dyker den upp här.</div>'; return; }
  el.innerHTML = list.map(a => {
    const d = new Date(a.ts).toLocaleString('sv-SE', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const key = a.cloud ? ('c' + a.id) : ('l' + a.ts);
    return `<div class="pf-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;cursor:pointer" onclick="toggleAnalysis('${key}')">
        <div><div style="font-weight:600">${escHtml(a.title||'Analys')}</div><div style="font-size:11px;color:var(--text3)">${d} · ${escHtml((a.model||'').replace('claude-',''))}</div></div>
        <button class="wl-remove" title="Ta bort" onclick="event.stopPropagation();deleteAnalysis('${key}')" style="opacity:.6">×</button>
      </div>
      <div id="an-${key}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><div class="memo">${formatMemo(a.answer||'')}</div>${screenerPanelHtml(a.answer||'', key)}</div>
    </div>`;
  }).join('');
}
function toggleAnalysis(key){ const el = document.getElementById('an-' + key); if(el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
async function deleteAnalysis(key){
  if(key[0] === 'c'){ const id = key.slice(1); if(sb && currentUser){ try { await sb.from('analyses').delete().eq('id', id); } catch(e){} } }
  else { const ts = Number(key.slice(1)); aiAnalyses = aiAnalyses.filter(a => a.ts !== ts); saveAnalysesLocal(); }
  renderAnalyses();
}

// ── Chatten: anrop och modellval (låg tidigare efter AI-fonden i index.html) ──
function appendTyping() {
  const msgs = document.getElementById('ai-messages');
  const id = 'typing-' + Date.now();
  msgs.innerHTML += `<div class="msg ai" id="${id}"><div class="msg-label">AI-analytiker</div><div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>`;
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

// Webbsök av som standard (kostar extra). Sparas lokalt.
let webSearchOn = localStorage.getItem('ai_websearch') === '1';
function setWebSearch(v){ webSearchOn = !!v; try { localStorage.setItem('ai_websearch', v ? '1' : '0'); } catch(e){} }

async function callClaudeAPI(userMsg, typingId, title) {
  const today = new Date().toLocaleDateString('sv-SE', { year:'numeric', month:'long', day:'numeric' });

  // Bifoga appens aktiedata så AI:n kan svara utifrån verklig data, inte minnet
  const stockData = stocks
    .map(s=>`${s.name} (${s.ticker}): ÅTD ${s.ytd>=0?'+':''}${s.ytd}%, P/E ${s.pe||'–'}, utd ${s.div||0}%, mkt cap ${s.mcap}B USD, sektor ${s.sektor}, region ${s.r.toUpperCase()}`)
    .join('\n');

  const systemPrompt = `Du är en professionell aktieanalytiker och investeringsrådgivare som hjälper svenska investerare. Du analyserar aktier, nyckeltal, sektorer och makroekonomiska faktorer med ett pedagogiskt och nyanserat tillvägagångssätt.

Dagens datum är ${today}. Använd detta som "idag" och innevarande år – gissa inte ett annat år.

Svara alltid på svenska. Var konkret och faktabaserad. Använd nyckeltal som P/E, EV/EBITDA, direktavkastning, omsättningstillväxt etc. när det är relevant. Presentera alltid både styrkor och risker. Avsluta analyser med en kort sammanfattning.

Du har tillgång till följande aktiedata från plattformen (ÅTD = utveckling hittills i år). När användaren frågar om utveckling, vilka som stigit/sjunkit mest, nyckeltal eller jämförelser – använd DENNA data i första hand istället för din träningskunskap. Om en fråga gäller en aktie eller fond som inte finns i listan, säg det och svara så gott du kan på allmän nivå:

${stockData}

${aiContext ? 'Nuvarande kontext: ' + aiContext : ''}
${aiStockDetail ? '\nLIVE-DATA för aktien användaren tittar på (kurser, nyckeltal och nyheter från Yahoo – använd i första hand för frågor om just denna aktie):\n' + aiStockDetail : ''}

${webSearchOn ? 'Du har ett webbsök-verktyg. Om du saknar tillförlitlig eller aktuell information – t.ex. färska nyheter, senaste kurser/rapporter, händelser efter din träningsdata – sök på nätet istället för att gissa. Undvik onödiga sökningar när du redan har svaret (t.ex. från live-datan ovan). Ange gärna källa när du använder webbfakta.' : 'Du saknar live-webbåtkomst i detta läge – svara utifrån din kunskap och plattformens data ovan. Är du osäker på färska uppgifter, säg det istället för att gissa.'}

Format: Använd **fetstil** för viktiga punkter. Använd - för punktlistor. Håll svaren strukturerade men lättlästa. OBS: Detta är inte personlig finansiell rådgivning.`;

  const messages = [
    ...aiHistory.slice(-4).slice(0,-1),
    {role:'user', content: userMsg}
  ];

  try {
    const selectedModel = document.getElementById('model-select')?.value || 'claude-haiku-4-5';
    const body = { model: selectedModel, max_tokens: 8000, system: systemPrompt, messages };
    // Bifoga webbsök-verktyget bara när användaren slagit på det (kostar extra).
    // Dynamisk filtrering (_20260209) stöds av Fable 5 / Opus 4.8 / Sonnet 4.6; Haiku
    // 4.5 använder grundvarianten.
    if(webSearchOn){
      const searchType = /haiku/.test(selectedModel) ? 'web_search_20250305' : 'web_search_20260209';
      body.tools = [{ type: searchType, name: 'web_search', max_uses: 5 }];
    }
    // Strömmande anrop – texten kommer löpande och uppdaterar "skriver…"-bubblan,
    // vilket också håller anslutningen vid liv förbi Cloudflares 100 s-tak.
    const typingBubble = () => { const el = document.getElementById(typingId); return el ? el.querySelector('.msg-bubble') : null; };
    const result = await callClaudeStream(body, partial => { const b = typingBubble(); if(b) b.innerHTML = formatAIText(partial); });
    const data = result.error ? { error: result.error } : { usage: result.usage };
    let reply;
    if(result.error){
      reply = '**API-fel:** ' + (result.error.message || result.error.type || 'okänt fel');
    } else {
      reply = (result.text || '').trim() || 'Kunde inte hämta svar (tomt svar från API:t).';
      if(result.stop_reason === 'max_tokens') reply += '\n\n_…(svaret nådde längdgränsen och kapades. Ställ en följdfråga för resten, eller be om en kortare sammanfattning.)_';
    }
    aiHistory.push({role:'assistant', content: reply});
    const typingEl = document.getElementById(typingId);
    if(typingEl) typingEl.remove();
    const costMeta = (data && !data.error) ? estimateCostText(selectedModel, data.usage) : '';
    if(data && !data.error) recordAiUsage(title ? 'analysis' : 'chat', selectedModel, data.usage);
    appendMsg('ai', reply, costMeta);
    // Spara analysen (hoppa över felsvar). Titel från knappen eller frågans början.
    if(data && !data.error && reply){
      const t = title || (userMsg.split('\n')[0].slice(0,70) + (userMsg.length > 70 ? '…' : ''));
      saveAnalysis({ ts: Date.now(), title: t, model: selectedModel, answer: reply, cost: costMeta });
    }
  } catch(e) {
    const typingEl = document.getElementById(typingId);
    if(typingEl) typingEl.remove();
    const noKey = !getApiKey();
    appendMsg('ai', noKey
      ? '**Ingen API-nyckel:** Klistra in din nyckel i fältet längst upp i AI-panelen för att aktivera AI-analysen.'
      : '**Anslutningsfel:** Kontrollera att nyckeln är korrekt och försök igen.');
  }
  document.getElementById('send-btn').disabled = false;
}

// Hämta tillåtna modeller från servern och fyll select
async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    const sel = document.getElementById('model-select');
    sel.innerHTML = '';
    (data.allowed || []).forEach(m => {
      const opt = document.createElement('option'); opt.value = m; opt.textContent = m; sel.appendChild(opt);
    });
    if(data.default) sel.value = data.default;
    document.getElementById('model-status').textContent = '';
  } catch (e) {
    document.getElementById('model-status').textContent = 'Kunde inte hämta modeller';
  }
}

// Kör vid laddning
window.addEventListener('load', () => {
  loadModels();
  const wt = document.getElementById('websearch-toggle'); if(wt) wt.checked = webSearchOn;
});
