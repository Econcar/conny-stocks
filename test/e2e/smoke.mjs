// Webbläsartest (röktest) av appen – körs av verify.mjs före varje deploy.
// Inga npm-beroenden: startar Chrome/Edge headless och styr den via DevTools-
// protokollet med Nodes inbyggda WebSocket (Node 22+). Den LOKALA koden servas
// från repot; /api/* skickas vidare till sajten, så det är den nya koden som
// testas – mot riktig data. Inga AI-anrop görs (kostar inget).
//
//   node test/e2e/smoke.mjs          (SKIP_E2E=1 hoppar över)
// Avslutar med kod ≠ 0 om något test fallerar. Saknas webbläsare: varning, kod 0.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROD = process.env.E2E_API_BASE || 'https://conny-stocks.pages.dev';
const BROWSERS = [
  process.env.E2E_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

if (process.env.SKIP_E2E === '1') { console.log('  – webbläsartest överhoppat (SKIP_E2E=1)'); process.exit(0); }
const browserPath = BROWSERS.find(p => existsSync(p));
if (!browserPath) { console.log('  ⚠ ingen Chrome/Edge hittad – webbläsartestet hoppas över'); process.exit(0); }
if (typeof WebSocket === 'undefined') { console.log('  ⚠ Node saknar WebSocket (kräver Node 22+) – webbläsartestet hoppas över'); process.exit(0); }

// ── Lokal server: statiska filer från repot + /api/* vidare till sajten ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const body = req.method === 'GET' ? undefined : await new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
      const up = await fetch(PROD + req.url, { method: req.method, body, headers: { 'content-type': req.headers['content-type'] || 'application/json' } });
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' });
      return res.end(Buffer.from(await up.arrayBuffer()));
    }
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '') || 'index.html';
    if (path.startsWith('..')) { res.writeHead(403); return res.end(); }
    const file = join(ROOT, path);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) { if (!res.headersSent) res.writeHead(404); res.end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${server.address().port}/`;

// ── Webbläsare + minimal DevTools-klient ──
const profile = mkdtempSync(join(tmpdir(), 'conny-e2e-'));
const chrome = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsBrowser = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('webbläsaren startade inte')), 20000);
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
});
const port = new URL(wsBrowser).port;
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map(), listeners = [];
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
  else if (msg.method) listeners.forEach(l => l(msg));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Okontrollerade fel i sidan (exceptions + ohanterade promise-avvisningar).
const pageErrors = [];
listeners.push(m => {
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    pageErrors.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0]);
  }
});
await send('Runtime.enable');
await send('Page.enable');

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
}
async function open(url) {
  const loaded = new Promise(r => listeners.push(m => { if (m.method === 'Page.loadEventFired') r(); }));
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await sleep(1500);
}

// ── Testerna ──
let failed = 0;
async function check(name, fn) {
  const before = pageErrors.length;
  try {
    await fn();
    const fresh = pageErrors.slice(before);
    if (fresh.length) throw new Error('fel i sidan: ' + fresh.join(' | '));
    console.log(`  ✔ ${name}`);
  } catch (e) { failed++; console.error(`  ✖ ${name}\n    ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  await check('sidan laddar utan fel', async () => {
    await open(APP);
    assert(await evaluate(`return typeof showSection === 'function' && typeof formatMemo === 'function'`), 'appens funktioner saknas');
    assert(/^Version \d+ · /.test(await evaluate(`return document.getElementById('app-version').textContent`)), 'versionsnumret visas inte');
  });

  await check('alla flikar går att öppna', async () => {
    const sections = await evaluate(`return [...document.querySelectorAll('.section')].map(s => s.id.replace('section-', '')).filter(s => s !== 'detail')`);
    assert(sections.length >= 10, `bara ${sections.length} flikar hittades`);
    for (const s of sections) {
      await evaluate(`showSection('${s}')`);
      await sleep(700);
      assert(await evaluate(`return document.getElementById('section-${s}').classList.contains('active')`), `fliken ${s} aktiverades inte`);
    }
    await sleep(2500); // låt flikarnas hämtningar landa – fel där fångas också
  });

  await check('aktiesidan laddar (Aktiedetalj)', async () => {
    await evaluate(`await loadStock('AAPL', 'Apple')`);
    await sleep(1500);
    const r = await evaluate(`return { ticker: currentTicker, deep: !!document.getElementById('d-deep-btn'), price: document.getElementById('d-price').textContent }`);
    assert(r.ticker === 'AAPL' && r.deep, 'aktiesidan eller djupanalysknappen saknas');
  });

  await check('guiden "Så kör du AI-analyserna" finns vid varje steg', async () => {
    const n = await evaluate(`return [...document.querySelectorAll('.ai-guide[data-here]')].filter(e => e.textContent.includes('Så kör du AI-analyserna')).length`);
    assert(n >= 3, `bara ${n} ifyllda guider`);
  });

  await check('promemorian döljer <screener_config> och escapar HTML', async () => {
    const html = await evaluate(`return formatMemo('### Rubrik\\nP/E < 15 **fet**\\n<screener_config>{"sectors":["Försvar"]}</screener_config>')`);
    assert(!html.includes('screener_config') && !html.includes('Försvar'), 'blocket syns i texten');
    assert(html.includes('&lt; 15') && html.includes('<strong>fet</strong>'), 'escaping/fetstil fel');
  });

  await check('⚡ Applicera AI:ns filter fyller i Aktiescreenern', async () => {
    const answer = '### 1. Åtgärder\\n- SÄLJ: X\\n\\n<screener_config>\\n{"sectors":["Försvar","Hälsovård"],"regions":["USA","Norden"],"max_pe":22,"max_ev_ebitda":12,"min_roe":15,"require_positive_fcf":true}\\n</screener_config>';
    await evaluate(`localStorage.setItem('ai_analyses', JSON.stringify([{ ts: Date.now(), title: 'Portföljgenomlysning · Min portfölj', model: 'test', answer: '${answer}' }]))`);
    await open(APP);
    await evaluate(`showSection('analyses')`);
    await sleep(1500);
    const clicked = await evaluate(`const b = [...document.querySelectorAll('#analyses-list button')].find(x => x.textContent.includes('Applicera')); if (b) b.click(); return !!b`);
    assert(clicked, 'knappen saknas i Sparade analyser');
    await sleep(1500);
    const r = await evaluate(`return { section: currentSection,
      regions: [...document.querySelectorAll('#region-filters .filter-chip.on')].map(c => c.dataset.r).sort().join(','),
      sectors: [...document.querySelectorAll('#sector-filters .filter-chip.on')].map(c => c.dataset.s).sort().join(','),
      pe: document.getElementById('nf-maxPe').value, ev: document.getElementById('nf-maxEvEbitda').value,
      roe: document.getElementById('nf-minRoe').value, fcf: document.getElementById('nf-posFcf').checked,
      params: screenerParams(0, 50) }`);
    assert(r.section === 'screener', 'screenern öppnades inte');
    assert(r.regions === 'norden,us' && r.sectors === 'Försvar,Hälsovård', `fel chips: ${r.regions} / ${r.sectors}`);
    assert(r.pe === '22' && r.ev === '12' && r.roe === '15' && r.fcf, 'nyckeltalsfälten fylldes inte i');
    assert(/maxPe=22/.test(r.params) && /posFcf=1/.test(r.params), 'filtren följer inte med i frågan');
    await evaluate(`localStorage.removeItem('ai_analyses')`);
  });

  await check('kostnadstaket stoppar AI-anrop när budgeten är slut', async () => {
    // Simulerad månadskostnad + "Avbryt" i dialogen – inget riktigt anrop görs.
    const r = await evaluate(`
      const realSpend = aiMonthSpend, realConfirm = window.confirm, realFetch = window.fetch;
      let claudeCalls = 0, asked = '';
      window.fetch = (u, o) => { if(String(u).includes('/api/claude')) claudeCalls++; return realFetch(u, o); };
      aiMonthSpend = async () => ({ usd: 12.5, mine: 10, engine: 2.5 });
      window.confirm = msg => { asked = msg; return false; };
      try {
        localStorage.setItem('ai_budget_usd', '10');
        const stopped = await callClaudeStream({ model: 'x', max_tokens: 1, messages: [] });
        localStorage.setItem('ai_budget_usd', '100');
        const underBudget = await aiBudgetGate();
        localStorage.removeItem('ai_budget_usd');
        const noBudget = await aiBudgetGate();
        showSection('aicost');
        await new Promise(r => setTimeout(r, 800));
        return { stopped: stopped.error && stopped.error.message, asked, claudeCalls, underBudget, noBudget,
                 card: document.getElementById('aicost-budget').textContent.includes('Månadsbudget') };
      } finally { aiMonthSpend = realSpend; window.confirm = realConfirm; window.fetch = realFetch; }`);
    assert(/månadsbudgeten/i.test(r.stopped || ''), 'anropet stoppades inte');
    assert(r.asked.includes('$12.50 av $10.00') && r.claudeCalls === 0, 'fel fråga eller anrop gick ändå iväg');
    assert(r.underBudget === true && r.noBudget === true, 'spärren slog till under taket/utan tak');
    assert(r.card, 'budgetkortet visas inte i AI-kostnader');
  });

  await check('beslutsloggen loggar och följer upp mot index', async () => {
    const r = await evaluate(`
      localStorage.removeItem('ai_decisions'); aiDecisionsLocal = [];
      const parsed = parseTagJson('text <decisions>[{"ticker":"VOLV-B.ST","action":"MINSKA EXPONERING"}]</decisions>', 'decisions');
      const n = await recordDecisions('triage', 'test', [{ ticker: 'VOLV-B.ST', name: 'Volvo B', action: 'KANDIDAT', note: 'test' },
                                                         { ticker: 'PAHITTAD-XYZ.ST', action: 'KÖP' }]);
      // Datera om beslutet 100 dagar bakåt (med kurs/index från då okända) – 1 och 3 mån ska då vara klara, 6 mån väntar.
      const d = aiDecisionsLocal[0];
      d.created_at = new Date(Date.now() - 100 * 86400000).toISOString(); d.bench_price = null;
      const s = await fetchChartSeries('VOLV-B.ST', '6mo', '1d'); d.price = closeOnOrAfter(s, Date.parse(d.created_at));
      saveDecisionsLocal();
      showSection('track');
      for(let i = 0; i < 40 && !document.querySelector('#track-body table'); i++) await new Promise(r => setTimeout(r, 250));
      const cells = [...document.querySelectorAll('#track-body tbody tr:first-child td')].map(td => td.textContent.trim());
      const out = { parsedAction: normAction(parsed[0].action), n, bench: decisionBenchmark('VOLV-B.ST'), us: decisionBenchmark('AAPL'), cells,
        hidden: !formatMemo('a <decision>{"action":"KÖP"}</decision>').includes('KÖP') };
      localStorage.removeItem('ai_decisions'); aiDecisionsLocal = [];
      return out;`);
    assert(r.parsedAction === 'MINSKA' && r.bench === '^OMX' && r.us === '^GSPC', 'tolkning/index fel');
    assert(r.n === 1, `skulle logga 1 beslut (påhittad ticker bort), loggade ${r.n}`);
    assert(r.hidden, '<decision>-blocket syns i texten');
    const [, , bolag, action, , , , , m1, m3, m6] = r.cells;
    assert(bolag.includes('VOLV-B.ST') && action === 'KANDIDAT', 'raden saknas i vyn: ' + r.cells.join(' | '));
    assert(/%/.test(m1) && /%/.test(m3) && /^om \d+ d$/.test(m6), `horisonter fel: ${m1} / ${m3} / ${m6}`);
  });

  await check('AI-triagens svarstolkning och prompt', async () => {
    const r = await evaluate(`return { picks: parseTriageResult('<triage_result>{"top_picks":[{"ticker":"SAAB-B.ST","name":"Saab","sector":"Försvar","justification":"x"}]}</triage_result>'),
      prompt: triageSystemPrompt(7), row: !!document.getElementById('triage-btn') }`);
    assert(r.row, 'triageknappen saknas');
    assert(r.picks && r.picks[0].ticker === 'SAAB-B.ST', 'svaret tolkades inte');
    assert(r.prompt.includes('EXAKT 7 bolag') && !r.prompt.includes('${'), 'antalet sattes inte in i prompten');
  });
} finally {
  try { ws.close(); } catch (e) {}
  chrome.kill();
  server.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}

if (failed) { console.error(`  ✖ ${failed} webbläsartest fallerade`); process.exit(1); }
