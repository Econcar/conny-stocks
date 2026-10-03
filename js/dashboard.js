// conny-stocks · Översikt + CIO-analysen (knapp, dagens analys, guiden).
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ DASHBOARD ══════════
function renderDashboard() {
  const dateEl = document.getElementById('dashboard-date');
  if(dateEl) dateEl.textContent = '· ' + new Date().toLocaleDateString('sv-SE', {day:'numeric', month:'long', year:'numeric'});
  const usaList = document.getElementById('top-usa-list');
  const nordicList = document.getElementById('top-nordic-list');
  const usa = stocks.filter(s=>s.r==='usa').sort((a,b)=>b.mcap-a.mcap).slice(0,7);
  const nordic = stocks.filter(s=>['se','no','dk'].includes(s.r)).sort((a,b)=>b.mcap-a.mcap).slice(0,7);
  usaList.innerHTML = usa.map(s=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 2px;border-bottom:1px solid var(--border);cursor:pointer" onclick="loadStock('${s.ticker}','${s.name}')" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background=''">
      <div><div style="font-size:13px;font-weight:500">${s.name}</div><div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${s.ticker}</div></div>
      <div style="text-align:right">
        <div style="font-size:12px;font-family:var(--mono)">${s.kurs}</div>
        <div style="font-size:11px;color:${s.ytd>=0?'var(--green)':'var(--red)'}">${s.ytd>=0?'+':''}${s.ytd.toFixed(1)}% ÅTD</div>
      </div>
    </div>`).join('');
  nordicList.innerHTML = nordic.map(s=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 2px;border-bottom:1px solid var(--border);cursor:pointer" onclick="loadStock('${s.ticker}','${s.name}')" onmouseenter="this.style.background='rgba(255,255,255,0.02)'" onmouseleave="this.style.background=''">
      <div><div style="font-size:13px;font-weight:500">${s.flag} ${s.name}</div><div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${s.ticker}</div></div>
      <div style="text-align:right">
        <div style="font-size:12px;font-family:var(--mono)">${s.kurs}</div>
        <div style="font-size:11px;color:${s.ytd>=0?'var(--green)':'var(--red)'}">${s.ytd>=0?'+':''}${s.ytd.toFixed(1)}% ÅTD</div>
      </div>
    </div>`).join('');
  renderSectorChart();
  renderDashboardNews();
  renderCioCard(false);
}

// ══════════ CIO-ANALYS (Översikt) ══════════
// Taktisk tillgångsallokering. Prompt, underlag och uträkningar ligger i
// shared/cio.js (delas med motorn). Kortet visar motorns dagliga analys
// (cio_analysis); knappen kör en färsk med din nyckel och ersätter den i vyn.
let cioMode = 'daily';   // 'daily' = motorns analys visas · 'mine' = din körning (pågående eller klar)
let cioDailyAt = 0;      // senaste hämtningen – Översikt ritas om var 60:e sek, analysen bara var 10:e min
let cioRunId = 0;

// Utfällbar guide till AI-flödet (tratten CIO → portfölj → screener → enskilt bolag).
// Visas vid varje steg; `here` markerar steget man står på: 'cio' | 'pm' | 'screener' | 'deep'.
function aiGuideHtml(here) {
  const link = (s, txt) => `<span class="card-link" style="float:none;font-size:12px" onclick="showSection('${s}')">${txt}</span>`;
  const step = (key, n, title, where, what) => `
    <div style="display:flex;gap:10px;margin:8px 0${key === here ? ';color:var(--text)' : ''}">
      <div style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:${key === here ? 'var(--accent)' : 'var(--surface2)'};color:${key === here ? '#fff' : 'var(--text2)'};font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center">${n}</div>
      <div><b style="color:var(--text)">${title}</b> <span class="muted">· ${where}</span>${key === here ? ' <span style="color:var(--accent);font-weight:600">← du är här</span>' : ''}<br>${what}</div>
    </div>`;
  return `<details style="margin-top:12px">
    <summary style="cursor:pointer;color:var(--accent);font-size:12px;user-select:none">Så kör du AI-analyserna ▾</summary>
    <div style="font-size:12px;line-height:1.7;color:var(--text2);margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
      <b style="color:var(--text)">Innan du börjar</b> (en gång):
      <div style="padding-left:12px">
        · Din Anthropic-nyckel i AI-panelen (✦ AI-analys) och krediter på kontot (console.anthropic.com → Billing).<br>
        · Logga in med Google – då sparas analyserna i molnet och kostnaden syns i ${link('aicost', 'AI-kostnader')}.<br>
        · En portfölj att genomlysa: klistra in dina innehav från Avanza i ${link('portfolio', 'Min portfölj')}, eller skapa en ${link('aifund', 'AI-fond')}.
      </div>
      <div style="margin-top:10px"><b style="color:var(--text)">Flödet</b> – varje steg bygger på det förra:</div>
      ${step('cio', 1, '✦ Kör CIO-analys', link('dashboard', 'Översikt'),
        'Makrobilden: vilken regim vi är i, hur aktier, räntor, guld och kassa ska viktas, och vilka sektorer som ska över- respektive underviktas. Körs automatiskt varje morgon (06:00 UTC) – finns dagens redan kan du hoppa över knappen.')}
      ${step('pm', 2, '✦ Kör Portföljgenomlysning', `${link('portfolio', 'Min portfölj')} eller inne i en ${link('aifund', 'AI-fond')}`,
        'Ställer innehaven mot senaste CIO-analysen och riskbarometern: vad som ska säljas, minskas, köpas och behållas, målnivå för kassan och vilka bolag portföljen behöver.')}
      ${step('screener', 3, '⚡ Applicera AI:ns filter i Screenern', 'knappen under genomlysningen',
        `Öppnar ${link('screener', 'Aktiescreenern')} med sektorer, marknader och nyckeltalsfilter (P/E, EV/EBITDA, ROE, fritt kassaflöde) ifyllda. Tryck sedan <b>✦ Kör AI-triage</b> och välj hur många (3–15) bolag AI:n ska vaska fram ur listan mot CIO-analysen.`)}
      ${step('deep', 4, '✦ Kör Institutionell Djupanalys', 'knappen på ett triage-kort (eller klicka på ett bolag i listan)',
        'Granskar kandidaten på djupet innan du agerar: vallgrav, kassaflöden, värdering mot 4–5 års historik och djävulens advokat.')}
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
        <b style="color:var(--text)">Bra att veta:</b> varje AI-steg tar 1–2 minuter och kostar ungefär $0,10–0,30. Allt sparas i
        ${link('analyses', 'Sparade analyser')} – där finns ⚡-knappen även för äldre genomlysningar. Analyserna är beslutsunderlag, inte personlig finansiell rådgivning.
      </div>
    </div>
  </details>`;
}

// Sektion 1 (allokeringen) syns direkt, resten fälls ut på begäran.
function cioHtml(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const heads = lines.map((l, i) => /^#{1,3}\s/.test(l.trim()) ? i : -1).filter(i => i >= 0);
  if(heads.length < 2) return `<div class="memo">${formatMemo(text)}</div>`;
  const head = lines.slice(0, heads[1]).join('\n'), rest = lines.slice(heads[1]).join('\n');
  return `<div class="memo">${formatMemo(head)}</div>
    <details class="cio-more"><summary>Visa hela analysen – centralbanker, riskbarometer, geopolitik, sektorer, svart svan ▾</summary>
    <div class="memo">${formatMemo(rest)}</div></details>`;
}

async function renderCioCard(force) {
  if(cioMode !== 'daily') return; // din egen körning ligger kvar tills du väljer motorns igen
  if(!force && cioDailyAt && Date.now() - cioDailyAt < 10 * 60 * 1000) return;
  const sub = document.getElementById('cio-sub'), out = document.getElementById('cio-out');
  if(!sub || !out) return;
  if(!cloudEnabled || !sb) { sub.textContent = 'Molnet är inte konfigurerat – kör analysen med knappen.'; return; }
  cioDailyAt = Date.now();
  try {
    const { data, error } = await sb.from('cio_analysis').select('date,analysis,model').order('date', { ascending: false }).limit(1);
    if(error) throw new Error(error.message);
    if(cioMode !== 'daily') return;
    const a = data && data[0];
    if(!a) {
      sub.textContent = 'Ingen daglig analys ännu – motorn skriver en varje morgon (06:00 UTC). Kör en själv med knappen.';
      out.innerHTML = '';
      return;
    }
    const modelShort = a.model ? ' · ' + a.model.replace('claude-', '') : '';
    sub.textContent = `Motorns dagliga analys · ${a.date}${modelShort}`;
    out.innerHTML = cioHtml(a.analysis);
  } catch(e) {
    cioDailyAt = 0;
    sub.textContent = /cio_analysis/.test(e.message)
      ? 'Tabellen cio_analysis saknas – kör supabase-cio-analysis.sql i Supabase. Knappen fungerar ändå.'
      : 'Kunde inte läsa dagens analys: ' + e.message;
  }
}

function showCioDaily() {
  cioRunId++; // en pågående körning slutar skriva i vyn (men sparas ändå när den är klar)
  cioMode = 'daily';
  const btn = document.getElementById('cio-btn'); btn.disabled = false; btn.textContent = '✦ Kör CIO-analys';
  document.getElementById('cio-out').innerHTML = '';
  renderCioCard(true);
}

async function cioLoadMegatrends() {
  if(!cloudEnabled || !sb) return [];
  try {
    const { data } = await sb.from('megatrends').select('date,name,analysis').order('date', { ascending: false }).limit(30);
    return data && data.length ? data.filter(r => r.date === data[0].date) : [];
  } catch(e) { return []; }
}

async function runCioNow() {
  const out = document.getElementById('cio-out'), sub = document.getElementById('cio-sub'), btn = document.getElementById('cio-btn');
  if(!getApiKey()) {
    out.innerHTML = '<div class="error-msg">Ingen API-nyckel. Klistra in din Anthropic-nyckel i AI-panelen (✦ AI-analys) först.</div>';
    return;
  }
  const id = ++cioRunId, live = () => id === cioRunId;
  cioMode = 'mine';
  const stamp = new Date().toLocaleString('sv-SE', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  sub.innerHTML = `Din körning · ${escHtml(stamp)} · <span class="card-link" style="float:none;margin-left:0" onclick="showCioDaily()">visa motorns dagliga</span>`;
  const doneBtn = label => { if(live()) { btn.disabled = false; btn.textContent = label; } };
  const status = txt => { if(live()) memoStatus(out, txt); };
  btn.disabled = true; btn.textContent = '✦ Analyserar…';

  status('Samlar underlag: räntor, inflation, valutor, råvaror, riskindikatorer, megatrender och nyhetsrubriker…');
  let ctx;
  try {
    const [market, megatrends, headlines] = await Promise.all([
      cioGatherMarketData({ base: '' }),
      cioLoadMegatrends(),
      loadSignals(false).catch(() => [])
    ]);
    ctx = buildCioContext({ ...market, megatrends, headlines: headlines || [] });
  } catch(e) {
    if(live()) out.innerHTML = `<div class="error-msg">Kunde inte samla underlaget: ${escHtml(e.message)}</div>`;
    return doneBtn('↻ Försök igen');
  }
  status('CIO:n läser av regimen – modellen tänker innan den skriver, det kan ta en minut…');

  const body = { model: CIO_MODEL, max_tokens: 32000, system: CIO_SYSTEM_PROMPT,
    output_config: { effort: 'high' }, messages: [{ role: 'user', content: cioUserMessage(ctx) }] };
  const result = await streamMemo(body, { getOut: () => out, live, html: cioHtml });
  if(result.error) return doneBtn('↻ Försök igen');
  const text = result.text;

  const costMeta = estimateCostText(CIO_MODEL, result.usage);
  recordAiUsage('cio', CIO_MODEL, result.usage);
  saveAnalysis({ ts: Date.now(), title: `CIO-analys · taktisk allokering (${ctx.as_of})`, model: CIO_MODEL, answer: text, cost: costMeta });
  if(live()) {
    out.innerHTML = cioHtml(text) +
      `<div class="deep-meta">Sparad i Sparade analyser · ${escHtml(costMeta)}${currentUser ? '' : ' · logga in för att kostnaden ska synas i AI-kostnader'}</div>`;
  }
  doneBtn('↻ Kör ny CIO-analys');
}

function renderSectorChart() {
  const sectorData = {};
  stocks.forEach(s => {
    if(!sectorData[s.sektor]) sectorData[s.sektor] = [];
    sectorData[s.sektor].push(s.ytd);
  });
  const labels = Object.keys(sectorData);
  const avgs = labels.map(l => { const arr=sectorData[l]; return +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1); });
  const colors = labels.map(l => (sectorColors[l]||['rgba(100,100,100,0.2)','#666'])[1]);
  const ctx = document.getElementById('sectorChart').getContext('2d');
  if(sectorChartInstance) sectorChartInstance.destroy(); // undvik "Canvas already in use" när översikten ritas om var 60:e sek
  sectorChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: avgs, backgroundColor: colors.map(c=>c+'44'), borderColor: colors, borderWidth: 1.5, borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8b91a8', font: { size: 11 }, callback: v=>v+'%' } } } }
  });
}
