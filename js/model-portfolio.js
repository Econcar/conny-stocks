// conny-stocks · Egen modellportfölj: en fiktiv portfölj där du själv väljer aktierna
// (t.ex. från AI-triagens kort eller aktiesidan) och följer dem mot index.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ MODELLPORTFÖLJ ══════════
// Lagras som en fond i aiFunds med kind:'model' – samma lagring (lokalt + Supabase
// ai_funds), värdering, graf mot index, dagliga NAV-logg i motorn och Portföljgenomlysning
// som AI-fonderna. Skillnaden: ingen AI-omvärdering, och en fiktiv KASSA. Du startar med ett
// startkapital; köp dras från kassan och sälj går tillbaka dit, så avkastningen och grafen
// stämmer även när du köper efter hand. Varje köp/sälj loggas med innehav + kassa (för grafen).
let currentModelView = null;
const modelFunds = () => aiFunds.filter(isModelFund);

function openModel(id) { currentModelView = id; renderModelPortfolios(); }
function backToModelList() { currentModelView = null; renderModelPortfolios(); }

async function renderModelPortfolios() {
  const view = document.getElementById('model-view');
  if(!view) return;
  if(sb && currentUser) { const cloud = await pullAIFundsCloud(); if(cloud) { aiFunds = cloud; saveAIFundsLocal(); } }
  if(currentModelView) { const f = aiFunds.find(x => x.id === currentModelView); if(f) return renderFundDetail(f, view); currentModelView = null; }
  const cards = modelFunds().map(f => `
    <div class="pf-card" style="cursor:pointer;margin-bottom:10px" onclick="openModel('${escQuote(f.id)}')">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><div style="font-weight:600">${escHtml(f.name)}</div><div style="font-size:11px;color:var(--text3)">${f.holdings.length} innehav · kassa ${fmtSekNum(f.cashSek || 0, 0)} kr · start ${fmtSekNum(f.startValueSek, 0)} kr · ${new Date(f.createdAt).toLocaleDateString('sv-SE')}</div></div>
        <div style="color:var(--text3);font-size:18px">›</div>
      </div>
    </div>`).join('');
  const inp = 'margin-top:4px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:7px 9px';
  view.innerHTML = `
    <div class="pf-card">
      <div style="font-weight:600;margin-bottom:10px">Skapa ny modellportfölj</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:12px;color:var(--text2)">Namn<br><input id="mp-name" placeholder="t.ex. Stagflationsskydd" style="${inp};width:240px"></label>
        <label style="font-size:12px;color:var(--text2)">Startkapital (kr)<br><input id="mp-budget" value="100000" style="${inp};width:130px;font-family:var(--mono)"></label>
        <button class="action-btn" onclick="createModelFromForm()">+ Skapa</button>
      </div>
      <div style="font-size:12px;color:var(--text3);margin-top:10px">Fyll portföljen med <b>+ Modellportfölj</b> på AI-triagens kort eller aktiesidan, eller köp direkt inne i portföljen. Allt är fiktivt – inget handlas på riktigt.</div>
    </div>
    ${cards ? `<div style="margin-top:16px;margin-bottom:8px;font-weight:600">Dina modellportföljer</div>${cards}` : '<div class="info-msg" style="margin-top:14px">Inga modellportföljer än.</div>'}`;
}

async function saveModel(f) { saveAIFundsLocal(); try { await pushAIFundCloud(f); } catch(e) {} }

// Loggpost med innehav + kassa efter ändringen – grafen räknar varje period för sig.
function modelLog(f, commentary) {
  f.reevalLog = f.reevalLog || [];
  f.reevalLog.unshift({ date: new Date().toISOString(), commentary, costUsd: 0, changes: [],
    holdings: f.holdings.map(h => ({ ...h })), cashSek: f.cashSek });
}

async function createModelPortfolio(name, budget) {
  budget = Number(budget);
  if(!(budget > 0)) throw new Error('Ange ett startkapital i kr.');
  const now = new Date().toISOString();
  const f = { id: 'mp_' + Date.now().toString(36), kind: 'model', name: (name || '').trim() || 'Modellportfölj',
    model: 'egen', web: false, budget, instructions: '', strategy: '', holdings: [], cashSek: budget,
    createdAt: now, lastReevalAt: null, startValueSek: Math.round(budget), reevalIntervalDays: 0, autoReeval: false, reevalLog: [] };
  modelLog(f, `Modellportfölj skapad med ${fmtSekNum(budget, 0)} kr i kassa.`);
  aiFunds.unshift(f);
  await saveModel(f);
  return f;
}

async function createModelFromForm() {
  try {
    const f = await createModelPortfolio(document.getElementById('mp-name').value, pfNum(document.getElementById('mp-budget').value));
    openModel(f.id);
  } catch(e) { alert(e.message); }
}

// Köp för ett belopp i kr (från kassan). Kursen räknas om till huvudvaluta (pence → pund)
// och SEK, som i AI-fonderna. Finns aktien redan blir inköpskursen ett viktat snitt (GAV).
async function modelBuy(f, ticker, name, amountSek) {
  amountSek = Number(amountSek);
  if(!(amountSek > 0)) throw new Error('Ange ett belopp i kr.');
  if(amountSek > (f.cashSek || 0) + 0.5) throw new Error(`Kassan räcker inte – ${fmtSekNum(f.cashSek || 0, 0)} kr kvar.`);
  const q = await fetchQuotesChunked([ticker]);
  const d = q[ticker];
  if(!d || d.price == null) throw new Error(`Hittade ingen kurs för ${ticker}.`);
  const pc = normPriceCurrency(d.currency), price = d.price / pc.div, ccy = pc.ccy || 'SEK';
  const rate = (await getFxRates([ccy]))[ccy.toUpperCase()];
  if(rate == null) throw new Error(`Saknar valutakurs för ${ccy}.`);
  const shares = amountSek / (price * rate);
  const ex = f.holdings.find(h => h.ticker === ticker);
  if(ex) {
    const tot = ex.shares + shares;
    ex.buyPrice = +((ex.buyPrice * ex.shares + price * shares) / tot).toFixed(4);
    ex.shares = +tot.toFixed(6);
  } else {
    f.holdings.push({ ticker, name: name || ticker, weight: 0, shares: +shares.toFixed(6), buyPrice: +price.toFixed(4), currency: ccy, rationale: '' });
  }
  f.cashSek = +((f.cashSek || 0) - amountSek).toFixed(2);
  modelLog(f, `${ex ? 'Ökat' : 'Köpt'} ${name || ticker} (${ticker}): ${fmtSekNum(shares, shares < 10 ? 2 : 0)} st à ${fmtSekNum(price, 2)} ${ccy} ≈ ${fmtSekNum(amountSek, 0)} kr.`);
  await saveModel(f);
}

async function modelSell(fid, ticker) {
  const f = aiFunds.find(x => x.id === fid);
  const h = f && f.holdings.find(x => x.ticker === ticker);
  if(!h || !confirm(`Sälj hela innehavet i ${h.name || ticker} till dagens kurs?`)) return;
  try {
    const d = (await fetchQuotesChunked([ticker]))[ticker];
    if(!d || d.price == null) throw new Error(`Hittade ingen kurs för ${ticker}.`);
    const pc = normPriceCurrency(d.currency), price = d.price / pc.div;
    const rate = (await getFxRates([pc.ccy || h.currency]))[(pc.ccy || h.currency || 'SEK').toUpperCase()];
    if(rate == null) throw new Error('Saknar valutakurs.');
    const value = price * h.shares * rate;
    f.holdings = f.holdings.filter(x => x.ticker !== ticker);
    f.cashSek = +((f.cashSek || 0) + value).toFixed(2);
    modelLog(f, `Sålt ${h.name || ticker} (${ticker}): ${fmtSekNum(h.shares, h.shares < 10 ? 2 : 0)} st à ${fmtSekNum(price, 2)} ${pc.ccy} ≈ ${fmtSekNum(value, 0)} kr (${fmtSekPct((price - h.buyPrice) / h.buyPrice * 100)} mot inköp).`);
    await saveModel(f);
    renderModelPortfolios();
  } catch(e) { alert('Kunde inte sälja: ' + e.message); }
}

// Köpformulär inne i en modellportfölj (anropas från renderFundDetail).
function modelBuyFormHtml(f) {
  const inp = 'background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:6px 9px';
  return `<div class="pf-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
    <span style="font-size:12px;color:var(--text2)">Köp aktie:</span>
    <input id="mp-buy-q" placeholder="ticker eller namn, t.ex. SAAB-B.ST" style="${inp};width:220px">
    <input id="mp-buy-amt" value="${Math.min(10000, Math.floor(f.cashSek || 0))}" style="${inp};width:110px;font-family:var(--mono)"> <span style="font-size:12px;color:var(--text2)">kr</span>
    <button class="action-btn" id="mp-buy-btn" onclick="modelBuyFromForm('${escQuote(f.id)}')">Köp</button>
    <span style="font-size:12px;color:var(--text3)">Kassa: ${fmtSekNum(f.cashSek || 0, 0)} kr</span>
  </div>`;
}

async function modelBuyFromForm(fid) {
  const f = aiFunds.find(x => x.id === fid);
  const q = (document.getElementById('mp-buy-q').value || '').trim();
  const btn = document.getElementById('mp-buy-btn');
  if(!f || !q) return;
  btn.disabled = true; btn.textContent = 'Köper…';
  try {
    const r = await resolveSymbol(q);
    await modelBuy(f, r ? r.sym : q.toUpperCase(), r ? r.name : q, pfNum(document.getElementById('mp-buy-amt').value));
    renderModelPortfolios();
  } catch(e) { alert('Kunde inte köpa: ' + e.message); btn.disabled = false; btn.textContent = 'Köp'; }
}

// ── Dialogen "Lägg i modellportfölj" (från AI-triagens kort och aktiesidan) ──
let modelAddTarget = null;
function openModelAdd(ticker, name) {
  modelAddTarget = { ticker, name };
  closeModelAdd();
  const funds = modelFunds();
  const inp = 'width:100%;margin-top:4px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:7px 9px';
  const div = document.createElement('div');
  div.id = 'model-add';
  div.className = 'modal-bg';
  div.onclick = e => { if(e.target === div) closeModelAdd(); };
  div.innerHTML = `<div class="card modal">
    <div class="card-title" style="margin-bottom:6px">Lägg i modellportfölj</div>
    <div style="font-weight:600;margin-bottom:12px">${escHtml(name || ticker)} <span class="muted" style="font-family:var(--mono);font-size:12px">${escHtml(ticker)}</span></div>
    <label style="font-size:12px;color:var(--text2)">Portfölj
      <select id="ma-fund" style="${inp}" onchange="modelAddToggle()">
        ${funds.map(f => `<option value="${escHtml(f.id)}">${escHtml(f.name)} – kassa ${fmtSekNum(f.cashSek || 0, 0)} kr</option>`).join('')}
        <option value="__new"${funds.length ? '' : ' selected'}>+ Ny modellportfölj…</option>
      </select></label>
    <div id="ma-new" style="display:${funds.length ? 'none' : 'flex'};gap:10px;margin-top:10px">
      <label style="font-size:12px;color:var(--text2);flex:2">Namn<input id="ma-name" placeholder="t.ex. Stagflationsskydd" style="${inp}"></label>
      <label style="font-size:12px;color:var(--text2);flex:1">Startkapital (kr)<input id="ma-budget" value="100000" style="${inp};font-family:var(--mono)"></label>
    </div>
    <label style="font-size:12px;color:var(--text2);display:block;margin-top:10px">Belopp att köpa för (kr)<input id="ma-amount" value="10000" style="${inp};font-family:var(--mono)"></label>
    <div id="ma-msg" style="font-size:12px;color:var(--red);margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="action-btn" id="ma-ok" onclick="confirmModelAdd()">Köp</button>
      <button class="ghost-btn" onclick="closeModelAdd()">Avbryt</button>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:10px">Fiktivt köp till dagens kurs – inget handlas på riktigt.</div>
  </div>`;
  document.body.appendChild(div);
}
function modelAddToggle() { document.getElementById('ma-new').style.display = document.getElementById('ma-fund').value === '__new' ? 'flex' : 'none'; }
function closeModelAdd() { const el = document.getElementById('model-add'); if(el) el.remove(); }

async function confirmModelAdd() {
  const t = modelAddTarget, msg = document.getElementById('ma-msg'), btn = document.getElementById('ma-ok');
  if(!t) return;
  btn.disabled = true; btn.textContent = 'Köper…'; msg.textContent = '';
  try {
    const sel = document.getElementById('ma-fund').value;
    const f = sel === '__new'
      ? await createModelPortfolio(document.getElementById('ma-name').value, pfNum(document.getElementById('ma-budget').value))
      : aiFunds.find(x => x.id === sel);
    await modelBuy(f, t.ticker, t.name, pfNum(document.getElementById('ma-amount').value));
    closeModelAdd();
    showToast(`${t.name || t.ticker} lagd i ${f.name}`, 'Öppna', () => { currentModelView = f.id; showSection('model'); });
  } catch(e) { msg.textContent = e.message; btn.disabled = false; btn.textContent = 'Köp'; }
}

// Kort bekräftelse nere i hörnet, med valfri knapp.
function showToast(text, actionLabel, action) {
  const old = document.getElementById('toast'); if(old) old.remove();
  const div = document.createElement('div');
  div.id = 'toast';
  div.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:9999;background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:10px 14px;border-radius:10px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.4);display:flex;gap:12px;align-items:center';
  div.innerHTML = `<span>✓ ${escHtml(text)}</span>`;
  if(actionLabel) {
    const b = document.createElement('button');
    b.className = 'ghost-btn'; b.style.padding = '4px 10px'; b.textContent = actionLabel;
    b.onclick = () => { div.remove(); action(); };
    div.appendChild(b);
  }
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 7000);
}
