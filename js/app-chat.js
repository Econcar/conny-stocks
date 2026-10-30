// conny-stocks · Chatten på Översikt: frågor om appens egen information, besvarade av
// Google Gemini med din Gemini-nyckel (via /api/gemini). Underlaget – CIO-analys,
// riskbarometer, megatrender, nyhetssignaler, portfölj, AI-fonder/modellportföljer,
// beslutslogg, bevakningslista, rapportdatum och AI-kostnad – byggs vid första frågan
// och återanvänds i 10 minuter. Det ligger först (systemInstruction) och är likadant
// mellan frågorna, så Gemini cachar det automatiskt och följdfrågor blir billigare.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

const GEMINI_KEY_STORE = 'gemini_api_key';
const CHAT_MODEL_STORE = 'chat_model';
const CHAT_MODELS = [['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite · billigast']];
const CHAT_CTX_TTL = 10 * 60 * 1000;
const CHAT_HISTORY_TURNS = 10; // så många tidigare frågor + svar skickas med som minne
let chatHistory = [];          // [{ role: 'user' | 'model', text }]
let chatCtx = null, chatCtxAt = 0;
let chatBusy = false;

function getGeminiKey() { return lsGet(GEMINI_KEY_STORE) || ''; }
function chatModel() { const m = lsGet(CHAT_MODEL_STORE); return CHAT_MODELS.some(c => c[0] === m) ? m : CHAT_MODELS[0][0]; }
function setChatModel(m) { lsSet(CHAT_MODEL_STORE, m); }

function saveGeminiKey() {
  const input = document.getElementById('chat-key-input');
  const key = (input.value || '').trim();
  const status = document.getElementById('chat-key-status');
  if(!/^AIza[\w-]{20,}$/.test(key)) {
    status.textContent = '⚠ Nyckeln verkar inte stämma – en Gemini-nyckel börjar med AIza';
    status.style.color = 'var(--red)';
    return;
  }
  lsSet(GEMINI_KEY_STORE, key);
  renderChatCard();
}
function forgetGeminiKey() { lsSet(GEMINI_KEY_STORE, null); renderChatCard(); }

// ── Underlaget ──
const chatCut = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + ' …' : s; };
const chatDay = t => t ? new Date(t).toISOString().slice(0, 10) : null;

async function chatBuildContext(force) {
  if(!force && chatCtx && Date.now() - chatCtxAt < CHAT_CTX_TTL) return chatCtx;
  const safe = fn => Promise.resolve().then(fn).catch(() => null);
  const query = (table, sel, mod) => (cloudEnabled && sb) ? safe(async () => {
    const { data, error } = await mod(sb.from(table).select(sel));
    if(error) throw error;
    return data;
  }) : null;

  const watch = getWatchlist();
  const tickers = [...new Set([...portfolio.map(h => h.ticker), ...watch.map(w => w.id),
    ...aiFunds.flatMap(f => (f.holdings || []).map(h => h.ticker))].filter(Boolean))];
  const today = chatDay(Date.now()), in30 = chatDay(Date.now() + 30 * 86400000);

  const [cio, risk, trends, signals, earnings, decisions, analyses, month, credits] = await Promise.all([
    safe(latestCioDirective),
    query('risk_analysis', 'date,analysis', q => q.order('date', { ascending: false }).limit(1)),
    safe(cioLoadMegatrends),
    safe(() => loadSignals(false)),
    tickers.length ? query('earnings_calendar', 'ticker,name,report_date', q => q.in('ticker', tickers).gte('report_date', today).lt('report_date', in30).order('report_date').limit(200)) : null,
    safe(loadDecisions),
    (sb && currentUser) ? query('analyses', 'created_at,title', q => q.order('created_at', { ascending: false }).limit(20)) : null,
    safe(() => aiMonthSpend(false)),
    safe(() => aiCreditStatus(false))
  ]);

  const weekAgo = Date.now() - 7 * 86400000;
  const kpis = [...document.querySelectorAll('#market-kpis .kpi-card')].map(c => ({
    index: (c.querySelector('.kpi-label') || {}).textContent, value: (c.querySelector('.kpi-value') || {}).textContent,
    change: (c.querySelector('.kpi-sub') || {}).textContent }));

  const ctx = {
    market_now: kpis,
    cio_analysis: cio ? { source: cio.source, date: cio.date, age_days: cio.age_days, conclusions: chatCut(cio.conclusions, 9000) } : null,
    my_latest_cio_run: cioMine ? new Date(cioMine.ts).toLocaleString('sv-SE') : null,
    risk_barometer_analysis: risk && risk[0] ? { date: risk[0].date, analysis: chatCut(risk[0].analysis, 4000) } : null,
    megatrends: (trends || []).map(t => ({ date: t.date, theme: t.name, analysis: chatCut(t.analysis, 1200) })),
    news_signals_last_7_days: (signals || []).filter(s => Date.parse(s.published_at) >= weekAgo)
      .sort((a, b) => (b.impact_score || 0) - (a.impact_score || 0)).slice(0, 40)
      .map(s => ({ date: chatDay(s.published_at), tickers: s.tickers, sentiment: s.sentiment, impact: s.impact_score, summary: chatCut(s.summary, 300) })),
    my_portfolio: pfEnriched.length ? pmPortfolioStructure()
      : { name: 'Min portfölj (Avanza)', note: 'ej prissatt – öppna Min portfölj för aktuella värden', cash_sek: portfolioCash,
          holdings: portfolio.map(h => ({ ticker: h.ticker, name: h.name || h.ticker, shares: h.qty, gav: h.gav })) },
    ai_funds_and_model_portfolios: aiFunds.map(f => {
      const nav = (f.navHistory || []).slice(-1)[0];
      return { type: isModelFund(f) ? 'Modellportfölj' : 'AI-fond', name: f.name, started: chatDay(f.createdAt),
        strategy: chatCut(f.strategy, 300) || null, instructions: chatCut(f.instructions, 300) || null,
        start_value_sek: f.startValueSek || null, cash_sek: f.cashSek || null,
        latest_nav: nav ? { date: nav.date, value_sek: nav.valueSek, return_since_start_pct: f.startValueSek ? pmR((nav.valueSek - f.startValueSek) / f.startValueSek * 100) : null } : null,
        holdings: (f.holdings || []).map(h => ({ ticker: h.ticker, name: h.name, shares: h.shares, buy_price: h.buyPrice, currency: h.currency })) };
    }),
    ai_decision_log: (decisions || []).slice(0, 60).map(d => ({ date: chatDay(d.created_at), by: DECISION_SOURCES[d.source] || d.source,
      ticker: d.ticker, name: d.name, action: d.action, price_then: d.price, note: chatCut(d.note, 160) || null })),
    watchlist: watch.map(w => ({ ticker: w.id, name: w.name })),
    upcoming_reports_30_days: (earnings || []).map(e => ({ date: e.report_date, ticker: e.ticker, name: e.name })),
    my_saved_ai_analyses: (analyses || aiAnalyses.slice(0, 20).map(a => ({ created_at: a.ts, title: a.title })))
      .map(a => ({ date: new Date(a.created_at).toLocaleString('sv-SE'), title: a.title })),
    ai_cost_this_month_usd: month ? { total: pmR(month.usd, 2), mine: pmR(month.mine, 2), engine: pmR(month.engine, 2) } : null,
    anthropic_credits: credits && credits.balance ? { estimated_left_usd: pmR(credits.left, 2), out: credits.out } : (credits && credits.out ? { out: true } : null)
  };
  chatCtx = ctx; chatCtxAt = Date.now();
  return ctx;
}

function chatSystemPrompt(ctx) {
  const today = new Date().toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `Du är assistenten i conny-stocks, en privat plattform för aktieanalys. Användaren är en svensk privatinvesterare som räknar i SEK.
Dagens datum: ${today}.

Svara på svenska och i första hand utifrån <underlag> nedan – plattformens egen information: CIO-analysen (taktisk allokering), riskbarometern, megatrender, nyhetssignaler från de senaste 7 dagarna, användarens portfölj, AI-fonder och modellportföljer, AI:ns beslutslogg (rekommendationer med kursen då), bevakningslistan, kommande rapportdatum, sparade analyser och AI-kostnader.
- Säg varifrån svaret kommer, t.ex. "enligt CIO-analysen från 28 okt" eller "nyhetssignal 29 okt".
- Finns svaret inte i underlaget: säg det tydligt och svara bara på allmän nivå. Hitta aldrig på siffror, kurser eller datum.
- null eller saknade fält betyder att informationen inte gick att hämta.
- Skriv bolagsnamn i klartext tillsammans med tickern, t.ex. "Saab (SAAB-B.ST)".
- Var koncis. Använd **fetstil** för det viktigaste och - för listor.
- Det här är beslutsunderlag, inte personlig finansiell rådgivning.

<underlag>
${JSON.stringify(ctx)}
</underlag>`;
}

// ── Anropet (strömmande, SSE) → { text, usage, finish } eller { error } ──
async function callGeminiStream(model, system, history, onText) {
  let res;
  try {
    res = await fetch('/api/gemini', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getGeminiKey() },
      body: JSON.stringify({ model, systemInstruction: { parts: [{ text: system }] },
        contents: history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
        generationConfig: { maxOutputTokens: 8192 } }) });
  } catch(e) { return { error: 'Nätverksfel: ' + e.message }; }

  const ct = res.headers.get('content-type') || '';
  if(!ct.includes('text/event-stream')) {
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch(_) { return { error: 'Ogiltigt svar från servern (' + res.status + ').' }; }
    const err = Array.isArray(data) ? data[0] && data[0].error : data.error;
    return { error: geminiErrorText(res.status, err) };
  }

  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', text = '', usage = null, finish = null;
  for(;;) {
    const { done, value } = await reader.read(); if(done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if(!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch(_) { continue; }
      if(ev.error) return { error: geminiErrorText(ev.error.code, ev.error) };
      const cand = ev.candidates && ev.candidates[0];
      if(cand && cand.content && cand.content.parts) {
        const add = cand.content.parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
        if(add) { text += add; if(onText) onText(text); }
      }
      if(cand && cand.finishReason) finish = cand.finishReason;
      if(ev.usageMetadata) usage = ev.usageMetadata;
    }
  }
  return { text, usage, finish };
}

function geminiErrorText(status, err) {
  const msg = typeof err === 'string' ? err : (err && err.message) || 'okänt fel';
  if(status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'Gemini-kvoten är slut för tillfället (för många frågor på kort tid, eller dagens gratiskvot förbrukad). Vänta en stund, eller slå på fakturering i Google AI Studio.';
  if(/API key not valid|API_KEY_INVALID/i.test(msg)) return 'Gemini-nyckeln är ogiltig. Skapa en ny i Google AI Studio och klistra in den igen.';
  return 'Gemini-fel: ' + msg;
}

// Geminis usageMetadata → samma fält som Anthropics usage (för kostnadsloggen).
// Tänkandet (thoughtsTokenCount) debiteras som utdata.
function geminiUsage(u) {
  if(!u) return null;
  const cached = u.cachedContentTokenCount || 0;
  return { input_tokens: Math.max(0, (u.promptTokenCount || 0) - cached), cache_read_input_tokens: cached,
    output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
}

// ── Gränssnittet ──
// formatAIText gör listrader till <div> men lämnar radbrytningen efter → luft mellan punkterna.
const chatFormat = t => formatAIText(escHtml(t)).replace(/<\/div><br>/g, '</div>');

function renderChatCard() {
  const keyRow = document.getElementById('chat-key-row'), sel = document.getElementById('chat-model');
  if(!keyRow) return;
  sel.innerHTML = CHAT_MODELS.map(([id, label]) => `<option value="${id}"${id === chatModel() ? ' selected' : ''}>${label}</option>`).join('');
  const hasKey = !!getGeminiKey();
  keyRow.innerHTML = hasKey
    ? ''
    : `<div class="info-msg" style="margin-top:12px">
        Chatten använder Google Gemini med din egen nyckel. Skapa en gratis på
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--accent)">aistudio.google.com/apikey ↗</a> och klistra in den här.
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <input type="password" id="chat-key-input" class="filter-input" placeholder="AIza…" style="flex:1;min-width:200px;font-family:var(--mono)">
          <button class="action-btn" onclick="saveGeminiKey()">Spara nyckel</button>
        </div>
        <div id="chat-key-status" style="font-size:12px;margin-top:6px"></div>
        <div style="font-size:11px;color:var(--text3);margin-top:6px">Utan fakturering i Google Cloud körs gratisnivån – då får Google använda frågorna och underlaget (bl.a. dina innehav) för att förbättra sina produkter. Med fakturering påslagen betalar Google AI Pro-abonnemangets månatliga Cloud-krediter, och datan används inte för träning. Nyckeln sparas bara i den här webbläsaren.</div>
      </div>`;
  document.getElementById('chat-input').disabled = !hasKey;
  document.getElementById('chat-send').disabled = !hasKey || chatBusy;
  document.getElementById('chat-forget').style.display = hasKey ? '' : 'none';
}

function chatAppend(role, html, meta) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
  div.innerHTML = `<div class="msg-label">${role === 'user' ? 'Du' : 'Gemini'}</div><div class="msg-bubble">${html}</div>`
    + (meta ? `<div class="chat-meta">${escHtml(meta)}</div>` : '');
  log.appendChild(div);
  log.style.display = '';
  log.scrollTop = log.scrollHeight;
  return div.querySelector('.msg-bubble');
}

function chatClear() {
  chatHistory = []; chatCtx = null;
  const log = document.getElementById('chat-log'); log.innerHTML = ''; log.style.display = 'none';
}

function chatKey(e) { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } }

async function chatSend() {
  const input = document.getElementById('chat-input'), btn = document.getElementById('chat-send');
  const q = (input.value || '').trim();
  if(!q || chatBusy || !getGeminiKey()) return;
  chatBusy = true; btn.disabled = true; input.value = '';
  chatAppend('user', escHtml(q).replace(/\n/g, '<br>'));
  const bubble = chatAppend('model', '<div class="typing"><span></span><span></span><span></span></div>');
  const log = document.getElementById('chat-log');
  const model = chatModel();
  try {
    const ctx = await chatBuildContext(false);
    chatHistory.push({ role: 'user', text: q });
    const history = chatHistory.slice(-CHAT_HISTORY_TURNS * 2);
    const r = await callGeminiStream(model, chatSystemPrompt(ctx), history, t => { bubble.innerHTML = chatFormat(t); log.scrollTop = log.scrollHeight; });
    if(r.error) {
      chatHistory.pop(); // frågan fick inget svar – skicka inte med den som minne
      bubble.innerHTML = `<span style="color:var(--red)">${escHtml(r.error)}</span>`;
    } else {
      let text = (r.text || '').trim() || 'Tomt svar från Gemini.';
      if(r.finish === 'MAX_TOKENS') text += '\n\n_…(svaret kapades vid längdgränsen – ställ en följdfråga för resten)_';
      if(r.finish === 'SAFETY') text += '\n\n_(Gemini stoppade svaret av säkerhetsskäl.)_';
      chatHistory.push({ role: 'model', text });
      bubble.innerHTML = chatFormat(text);
      const usage = geminiUsage(r.usage);
      if(usage) {
        recordAiUsage('gemini_chat', model, usage);
        const meta = document.createElement('div'); meta.className = 'chat-meta';
        meta.textContent = estimateCostText(model, usage) + (usage.cache_read_input_tokens ? '  ·  underlaget cachat' : '');
        bubble.parentNode.appendChild(meta);
      }
    }
  } catch(e) {
    bubble.innerHTML = `<span style="color:var(--red)">Något gick fel: ${escHtml(e.message)}</span>`;
  } finally {
    chatBusy = false; btn.disabled = !getGeminiKey();
    log.scrollTop = log.scrollHeight;
    input.focus();
  }
}
