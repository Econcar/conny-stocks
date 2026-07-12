// Schemalagd omvärdering av AI-fonder (körs på servern, oberoende av webbläsaren).
// Läser alla fonder, omvärderar de som är "dags" enligt sitt intervall + autoReeval,
// och skriver tillbaka den ombalanserade portföljen till Supabase.
//
// Speglar klientens logik i index.html (buildFundHoldings, reevalAIFund).

const { getAIFunds, updateAIFundData } = require('./store');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const UA = 'Mozilla/5.0 (compatible; conny-stocks-engine)';

const FX_SYMBOL = { USD:'SEK=X', EUR:'EURSEK=X', GBP:'GBPSEK=X', DKK:'DKKSEK=X',
  NOK:'NOKSEK=X', CAD:'CADSEK=X', CHF:'CHFSEK=X', JPY:'JPYSEK=X', PLN:'PLNSEK=X',
  ZAR:'ZARSEK=X', ILS:'ILSSEK=X', HKD:'HKDSEK=X', AUD:'AUDSEK=X' };

function normPriceCurrency(cur) {
  const c = (cur || '').trim();
  const minor = { GBp:['GBP',100], GBX:['GBP',100], ZAc:['ZAR',100], ILA:['ILS',100] };
  if (minor[c]) return { ccy: minor[c][0], div: minor[c][1] };
  return { ccy: c.toUpperCase(), div: 1 };
}

const REBALANCE_TOOL = {
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

async function yget(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  return r.json();
}

// Kurs + valuta per symbol (chunkat).
async function fetchSpark(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 15) {
    const chunk = symbols.slice(i, i + 15);
    try {
      const j = await yget(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=5d&interval=1d`);
      for (const r of (j.spark && j.spark.result) || []) {
        const resp = r.response && r.response[0]; if (!resp) continue;
        const m = resp.meta || {};
        const closes = ((resp.indicators && resp.indicators.quote[0] && resp.indicators.quote[0].close) || []).filter(v => v != null);
        const price = m.regularMarketPrice != null ? m.regularMarketPrice : (closes.length ? closes[closes.length - 1] : null);
        if (price != null) out[r.symbol] = { price, currency: m.currency };
      }
    } catch (e) { /* hoppa över trasig chunk */ }
  }
  return out;
}

async function searchSymbol(q) {
  try {
    const j = await yget(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`);
    const quotes = (j.quotes || []).filter(x => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND'].includes(x.quoteType));
    if (!quotes.length) return '';
    const scored = quotes.map(x => {
      const sym = x.symbol || ''; let s = 0;
      if (/^[0-9]/.test(sym)) s -= 5;
      if (sym.indexOf('.') < 0) s += 1;
      if (x.quoteType === 'EQUITY') s += 1;
      return { sym, s };
    }).sort((a, b) => b.s - a.s);
    return scored[0].sym;
  } catch (e) { return ''; }
}

async function getFxRates(ccys) {
  const norm = ccys.map(c => (c || 'SEK').toUpperCase());
  const syms = [...new Set(norm.map(c => FX_SYMBOL[c]).filter(Boolean))];
  const fx = { SEK: 1 };
  if (syms.length) {
    const fd = await fetchSpark(syms);
    norm.forEach(c => { if (c === 'SEK') fx[c] = 1; else { const s = FX_SYMBOL[c]; if (s && fd[s]) fx[c] = fd[s].price; } });
  }
  return fx;
}

async function buildHoldings(rawHoldings, budget) {
  const items = (rawHoldings || []).map(h => ({ name: (h.name || '').trim() || (h.ticker || '').trim(), ticker: (h.ticker || '').trim(), weight: Number(h.weight) || 0, rationale: (h.rationale || '').trim() }));
  let q = {}; const provided = items.map(i => i.ticker).filter(Boolean);
  if (provided.length) q = await fetchSpark([...new Set(provided)]);
  for (const it of items) {
    if (!it.ticker || !q[it.ticker] || q[it.ticker].price == null) {
      const cand = await searchSymbol(it.name); if (cand) it.ticker = cand;
    }
  }
  const all = [...new Set(items.map(i => i.ticker).filter(Boolean))];
  q = all.length ? await fetchSpark(all) : {};
  const ccys = all.map(t => { const d = q[t]; return d && d.currency ? normPriceCurrency(d.currency).ccy : 'SEK'; });
  const fx = await getFxRates(ccys.length ? ccys : ['SEK']);
  const tot = items.reduce((s, i) => s + i.weight, 0) || 1;
  const holdings = [];
  for (const it of items) {
    const d = q[it.ticker]; if (!d || d.price == null) continue;
    const pc = normPriceCurrency(d.currency); const price = d.price / pc.div; const ccy = pc.ccy;
    const rate = fx[(ccy || 'SEK').toUpperCase()]; if (rate == null) continue;
    const amount = budget * (it.weight / tot);
    const shares = amount / (price * rate);
    if (!isFinite(shares) || shares <= 0) continue;
    holdings.push({ ticker: it.ticker, name: it.name, weight: +((it.weight / tot) * 100).toFixed(1), shares: +shares.toFixed(6), buyPrice: +price.toFixed(4), currency: ccy, rationale: it.rationale });
  }
  return holdings;
}

function fundValue(f, q, fx) {
  let total = 0;
  for (const h of f.holdings) {
    const d = q[h.ticker];
    const pc = d && d.currency ? normPriceCurrency(d.currency) : null;
    const price = d && d.price != null ? (pc ? d.price / pc.div : d.price) : null;
    const ccy = pc ? pc.ccy : h.currency;
    const rate = fx[(ccy || 'SEK').toUpperCase()];
    const v = (price != null && rate != null) ? price * h.shares * rate : null;
    if (v != null) total += v;
  }
  return total;
}

async function aiTool(model, system, userText, tool, web) {
  if (!API_KEY) throw new Error('Saknar ANTHROPIC_API_KEY');
  const body = { model, max_tokens: 3000, system, tools: [tool], messages: [{ role: 'user', content: userText }] };
  if (web) {
    const st = /haiku/.test(model) ? 'web_search_20250305' : 'web_search_20260209';
    body.tools.push({ type: st, name: 'web_search', max_uses: 5 });
    body.tool_choice = { type: 'auto' };
  } else body.tool_choice = { type: 'tool', name: tool.name };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Anthropic (${model}) ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const tu = (data.content || []).find(b => b.type === 'tool_use' && b.name === tool.name);
  if (!tu) throw new Error('inget tool_use-svar');
  return tu.input;
}

async function reevalFund(f) {
  const q = await fetchSpark(f.holdings.map(h => h.ticker));
  const fx = await getFxRates([...new Set(f.holdings.map(h => h.currency))]);
  const total = fundValue(f, q, fx) || f.startValueSek;
  const lines = f.holdings.map(h => {
    const d = q[h.ticker]; const pc = d && d.currency ? normPriceCurrency(d.currency) : null;
    const price = d && d.price != null ? (pc ? d.price / pc.div : d.price) : null;
    const g = (price != null) ? (((price - h.buyPrice) / h.buyPrice) * 100).toFixed(1) + '%' : '?';
    return `- ${h.name} (${h.ticker}): vikt ${h.weight}%, sedan köp ${g}`;
  }).join('\n');
  const today = new Date().toLocaleDateString('sv-SE');
  const sys = `Du är portföljförvaltare och omvärderar en befintlig fiktiv fond. Behåll det som fungerar, ombalansera vid behov enligt strategin. Returnera HELA den nya portföljen via verktyget rebalance_portfolio (vikter summerar ~100, Yahoo-tickers) samt en kort kommentar om vad du ändrar och varför.${f.web ? ' Du kan söka på nätet.' : ''}`;
  const user = `Dagens datum: ${today}. Fondens strategi/instruktioner:\n${f.instructions || f.strategy || '(ingen)'}\n\nNuvarande värde: ${Math.round(total)} SEK. Nuvarande innehav:\n${lines}\n\nOmvärdera nu.`;
  const input = await aiTool(f.model || 'claude-sonnet-4-6', sys, user, REBALANCE_TOOL, !!f.web);
  const built = await buildHoldings(input.holdings || [], total);
  if (!built.length) throw new Error('kunde inte prissätta de nya innehaven');
  f.holdings = built;
  if (input.strategy) f.strategy = input.strategy;
  f.lastReevalAt = new Date().toISOString();
  f.reevalLog = f.reevalLog || [];
  f.reevalLog.unshift({ date: f.lastReevalAt, commentary: (input.commentary || '') + ' (auto · server)' });
  if (f.reevalLog.length > 50) f.reevalLog = f.reevalLog.slice(0, 50);
  return f;
}

function isDue(f) {
  if (!f || !f.autoReeval || !f.reevalIntervalDays) return false;
  const base = f.lastReevalAt ? new Date(f.lastReevalAt).getTime() : new Date(f.createdAt).getTime();
  return Date.now() >= base + f.reevalIntervalDays * 86400000;
}

async function runAIFunds() {
  const rows = await getAIFunds();
  let checked = 0, done = 0, errs = 0;
  for (const row of rows) {
    const f = row.data;
    if (!isDue(f)) continue;
    checked++;
    try {
      const updated = await reevalFund(f);
      await updateAIFundData(row.id, updated);
      console.log(`  ✓ AI-fond omvärderad: ${f.name} (${f.model || '?'}, ${f.holdings.length} innehav)`);
      done++;
    } catch (e) {
      console.error(`  ✗ AI-fond ${f && f.name}: ${e.message}`);
      errs++;
    }
  }
  return { total: rows.length, due: checked, done, errs };
}

module.exports = { runAIFunds };
