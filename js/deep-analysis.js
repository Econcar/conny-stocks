// conny-stocks · Institutionell djupanalys + delad promemoria-rendering (formatMemo, streamMemo).
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ INSTITUTIONELL DJUPANALYS ══════════
// Knappen på aktiesidan samlar ett strukturerat JSON-underlag ur appens egna källor
// (Yahoo-nyckeltal + 4–5 års bokslutshistorik, makro, riskbarometer, megatrender,
// nyhetsflöde) och strömmar en investeringspromemoria från Claude direkt under
// grafen. Resultatet sparas i Sparade analyser och loggas i AI-kostnader.
// Sonnet 5 – efterträdaren till Sonnet 3.7/3.5, som båda är pensionerade.
const DEEP_MODEL = 'claude-sonnet-5';
const DEEP_SYSTEM_PROMPT = `Du är en ledande global makrostrateg och chefsanalytiker på en fundamental hedgefond. 
Du genomlyser bolag genom att koppla samman geopolitik, makroregimer och kapitalflöden 
med bolagets underliggande intjäningsförmåga och kassaflöden.

REGEL 1: DU SKALL ALLTID GE SVARET FÖRST OCH SEDAN ANALYSEN.
Börja direkt i första sektionen med din entydiga slutsats, rekommendation och prislapp.

REGEL 2: TRANSPARENS KRING SEKTORKOLLEGOR.
Eftersom sektorkollegor inte ingår i den inskickade datan från användaren får du använda 
din egen förtränade kunskapsbas för peers och branschjämförelser. Du MÅSTE dock explicit 
skriva ut: "[Baserat på intern förtränad kunskap]" när du refererar till konkurrenter 
och externa multiplar.

Strukturera analysen strikt enligt följande rubriker:

### 1. Investeringstes & Slutsats (SVARET FÖRST)
- Koncis rekommendation: Köp / Avvakta / Sälj.
- Riktkursintervall eller attraktiv ingångsnivå baserat på FCF-yield och historiska multiplar.
- Risk/Reward-asymmetri: Varför är oddsen till investerarens fördel just nu (eller varför är de inte det)?

### 2. Makro & Geopolitisk Medvind (Top-Down)
- Hur påverkas bolaget av aktuell regim (ränteläge, 10-årsräntan, inflation, likviditet)?
- Placera bolaget i relevanta megatrender: Reshoring/deglobalisering, energibehov/elektrifiering, 
  AI/beräkningskapacitet, åldrande demografi eller försvarsupprustning. Rör sig bolaget med eller mot strömmen?

### 3. Affärsmodell & Vallgrav (Economic Moat)
- Identifiera bolagets primära vallgrav: Nätverkseffekter, höga byteskostnader, patent/IP, 
  stordriftsfördelar eller regulatoriska skydd.
- Pricing Power: Klarar bolaget att föra över kostnadsinflation till slutkund utan volymtapp?

### 4. Finansiell Kvalitet & Kassaflöden (Bottom-Up)
- Vinstkvalitet: Jämför redovisad vinst mot Fritt Kassaflöde (FCF). Döljs kapitaltunga 
  investeringar (CAPEX) eller hög aktiebaserad ersättning (SBC)?
- Balansräkningsstyrka: Granska nettoskuld i relation till EBITDA och räntekostnader 
  utifrån de senaste 4–5 årens historik. Hur ser refinansieringsrisken ut i dagens ränteklimat?

### 5. Värdering & Förväntningsbild (Reverse Valuation)
- Värderingsmultiplar: EV/EBITDA, P/E och FCF Yield i relation till bolagets 4–5-årssnitt.
- Sektorkollegor: Ange jämförbara bolag och hur värderingen står sig (ange tydligt att kollegorna 
  hämtas via intern förtränad kunskap).
- Vad är inprisat i dagens kurs? Vilken tillväxttakt och marginal måste bolaget leverera 
  för att försvara värderingen?

### 6. Djävulens Advokat (Pre-Mortem & Krossa Tesen)
- Antag att aktien rasar 50 % under de kommande 24 månaderna: Vad var det mest sannolika skälet?
- Lista de 3 mest kritiska strukturella riskerna (t.ex. teknologisk disruption, kundkoncentration, 
  tullar/handelsrestriktioner eller regulatoriska ingrepp).

### 7. Allokeringsperspektiv (Aktie vs Övriga Tillgångsslag)
- Mot bakgrund av Riskbarometerns signaler (VIX, guld, koppar, kreditspreadar): Är marknadsklimatet 
  rätt för att allokera kapital till just denna aktie, eller erbjuder andra tillgångsslag 
  (likvider, korta räntepapper, guld/råvaror) en överlägsen riskjusterad avkastning just nu?

Ton och format:
- Strikt professionellt, analytiskt och sakligt språk.
- Inga floskler eller inställsamma fraser.
- Referera alltid till de faktiska siffrorna i den inskickade datan.`;

const deepOk = v => v != null && isFinite(v);
const deepR1 = v => deepOk(v) ? Math.round(v * 10) / 10 : null;
const deepR2 = v => deepOk(v) ? Math.round(v * 100) / 100 : null;
const deepMn = v => deepOk(v) ? Math.round(v / 1e6) : null; // belopp i miljoner

// Pris, 1/3-månadersförändring och läge mot 50-dagarssnitt ur en spark-serie (3 mån dagsdata).
function deepTrend(d, dec = 2) {
  if(!d || d.price == null) return null;
  const c = d.closes || [], n = c.length;
  const pct = past => past ? deepR1((d.price - past) / past * 100) : null;
  const last50 = c.slice(-50);
  const sma50 = last50.length >= 20 ? last50.reduce((a, b) => a + b, 0) / last50.length : null;
  return { value: +d.price.toFixed(dec), chg_1m_pct: n > 21 ? pct(c[n-22]) : null,
           chg_3m_pct: n ? pct(c[0]) : null, vs_50d_avg_pct: sma50 ? pct(sma50) : null };
}

// Årsbokslut (4–5 år) ur Yahoos fundamentals-timeseries – underlaget för
// vinstkvalitet (FCF vs nettoresultat, capex, SBC) och historiska multiplar.
const DEEP_TS_TYPES = ['TotalRevenue','NetIncome','FreeCashFlow','CapitalExpenditure','StockBasedCompensation',
  'EBITDA','NetDebt','InterestExpense','DilutedEPS','DilutedAverageShares'];
async function fetchAnnualFundamentals(ticker) {
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}` +
    `?type=${DEEP_TS_TYPES.map(t => 'annual' + t).join(',')}&period1=${p2 - 7*365*86400}&period2=${p2}`;
  const j = await fetchYahoo(url);
  const byPeriod = {};
  let currency = null;
  for(const r of (j && j.timeseries && j.timeseries.result) || []) {
    const type = r.meta && r.meta.type && r.meta.type[0];
    for(const x of (type && r[type]) || []) {
      if(!x || !x.asOfDate || !x.reportedValue) continue;
      (byPeriod[x.asOfDate] ||= { period: x.asOfDate })[type.replace(/^annual/, '')] = x.reportedValue.raw;
      if(x.currencyCode) currency = x.currencyCode;
    }
  }
  return { currency, rows: Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period)) };
}

// Multiplar per räkenskapsår, räknade på kursen vid bokslutsmånadens slut. Bara när
// rapport- och handelsvaluta är samma – annars blir kvoterna meningslösa.
function deepHistory(ann, monthClose, priceCur) {
  if(!ann || !ann.rows.length) return null;
  const same = !!(ann.currency && priceCur && ann.currency === priceCur);
  return ann.rows.map(r => {
    const px = same ? monthClose[r.period.slice(0, 7)] : null;
    const mcap = (px != null && r.DilutedAverageShares) ? px * r.DilutedAverageShares : null;
    const ev = (mcap != null && r.NetDebt != null) ? mcap + r.NetDebt : null;
    return {
      fiscal_year_end: r.period,
      revenue_mn: deepMn(r.TotalRevenue), net_income_mn: deepMn(r.NetIncome), fcf_mn: deepMn(r.FreeCashFlow),
      capex_mn: deepMn(r.CapitalExpenditure), sbc_mn: deepMn(r.StockBasedCompensation), ebitda_mn: deepMn(r.EBITDA),
      net_debt_mn: deepMn(r.NetDebt), interest_expense_mn: deepMn(r.InterestExpense), eps_diluted: deepR2(r.DilutedEPS),
      fcf_to_net_income_pct: (r.FreeCashFlow != null && r.NetIncome > 0) ? deepR1(r.FreeCashFlow / r.NetIncome * 100) : null,
      price_at_fy_end: deepR2(px),
      pe: (px != null && r.DilutedEPS > 0) ? deepR1(px / r.DilutedEPS) : null,
      fcf_yield_pct: (mcap && r.FreeCashFlow != null) ? deepR1(r.FreeCashFlow / mcap * 100) : null,
      ev_ebitda: (ev != null && r.EBITDA > 0) ? deepR1(ev / r.EBITDA) : null
    };
  });
}

// Insynshandel: SEC Form 4 (US, redan i fund) eller Finansinspektionen (.ST, delar cache med kortet).
async function deepInsider(ticker, name, f) {
  if(f && ((f.insider && f.insider.length) || f.insiderNetto)) {
    return { source: 'SEC Form 4 via Yahoo', net_activity_6m: f.insiderNetto || null,
      recent: (f.insider || []).slice(0, 10).map(t => ({ date: t.datum, person: t.person, role: t.befattning,
        transaction: t.text, shares: t.volym, value: t.varde })) };
  }
  if(!/\.ST$/i.test(ticker)) return null;
  let data = insiderSeCache[ticker];
  if(!data) {
    try {
      const q = name || ticker.replace(/\.ST$/i, '');
      data = await (await fetch(`/api/insider-se?q=${encodeURIComponent(q)}&months=12`)).json();
      insiderSeCache[ticker] = data;
    } catch(e) { return null; }
  }
  const tx = (data && data.transaktioner) || [];
  if(!tx.length) return { source: 'Finansinspektionen', note: 'Inga rapporterade insynsaffärer senaste 12 månaderna' };
  const kop = tx.filter(t => insiderTyp(t.karaktar) === 'kop').length;
  const salj = tx.filter(t => insiderTyp(t.karaktar) === 'salj').length;
  return { source: 'Finansinspektionen, senaste 12 mån', buys: kop, sells: salj, other: tx.length - kop - salj,
    recent: tx.slice(0, 10).map(t => ({ date: t.datum, person: t.person, role: t.befattning, transaction: t.karaktar,
      volume: t.volym, price: t.pris, currency: t.valuta })) };
}

// Megatrender: motorns senaste temaanalyser – teman där bolaget nämns + alla aktiva teman.
async function deepMegatrends(ticker, name) {
  if(!cloudEnabled || !sb) return null;
  try {
    const { data, error } = await sb.from('megatrends').select('date,name,analysis,companies')
      .order('date', { ascending: false }).limit(30);
    if(error || !data || !data.length) return null;
    const rows = data.filter(r => r.date === data[0].date);
    const base = s => (s || '').toUpperCase().replace(/\.[A-Z]+$/, '');
    const norm = s => (s || '').toLowerCase().replace(/\b(ab|publ|inc|corp|corporation|ltd|plc|asa|oyj|sa|nv|ag|se|co|holding|group|class [ab]|ser [ab])\b/g, '').replace(/[^a-z0-9åäö]/g, '');
    const nm = norm(name);
    const linked = [];
    for(const r of rows) {
      for(const c of Array.isArray(r.companies) ? r.companies : []) {
        const byTicker = c.ticker && base(c.ticker) === base(ticker);
        const cn = norm(c.name);
        const byName = nm.length >= 4 && cn.length >= 4 && (cn === nm || cn.startsWith(nm) || nm.startsWith(cn));
        if(byTicker || byName) linked.push({ theme: r.name, direction: c.direction || null, reason: c.reason || null,
          theme_summary: (r.analysis || '').slice(0, 600) });
      }
    }
    return { analysis_date: data[0].date, linked_themes: linked, all_active_themes: rows.map(r => r.name) };
  } catch(e) { return null; }
}

// Nyheter: Yahoo-rubriker för tickern + motorns nyhetsflöde (signals), de 5 senaste.
async function deepNews(ticker) {
  const items = [];
  try {
    const j = await fetchYahoo(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=0&newsCount=8`);
    for(const n of (j && j.news) || []) {
      const ts = (n.providerPublishTime || 0) * 1000;
      items.push({ ts, date: ts ? new Date(ts).toISOString().slice(0, 10) : null, headline: n.title, source: n.publisher || 'Yahoo' });
    }
  } catch(e) {}
  try {
    const up = ticker.toUpperCase();
    for(const g of (await loadSignals(false)) || []) {
      if(!g.tickers.some(t => (t || '').toUpperCase() === up)) continue;
      const ts = g.published_at ? new Date(g.published_at).getTime() : 0;
      items.push({ ts, date: g.published_at ? g.published_at.slice(0, 10) : null, headline: g.summary, source: g.source,
        sentiment: g.sentiment || null, impact_score: g.impact_score != null ? g.impact_score : null });
    }
  } catch(e) {}
  const seen = new Set();
  return items.filter(x => x.headline && !seen.has(x.headline.toLowerCase()) && seen.add(x.headline.toLowerCase()))
    .sort((a, b) => b.ts - a.ts).slice(0, 5).map(({ ts, ...rest }) => rest);
}

// Context Aggregator: ett strukturerat JSON-underlag inför anropet.
async function buildDeepAnalysisContext(ticker, name) {
  const f = (currentStockMeta && currentStockMeta.fund) || await fetchFundamentals(ticker) || {};
  const [chart, ann, perf, insider, spark, rates, kpif, cpiUs, riskDaily, mega, news] = await Promise.all([
    fetchYahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=10y`).catch(() => null),
    fetchAnnualFundamentals(ticker).catch(() => null),
    buildPerfContext(ticker),
    deepInsider(ticker, name, f),
    fetchSparkData(['^TNX','BZ=F','SEK=X','^VIX','^VXN','^SKEW','GC=F','HG=F','HYG'], '3mo', '1d').catch(() => ({})),
    fetch('/api/rates').then(r => r.json()).catch(() => ({})),
    fetchScbKpif(),
    fetchFred('CPIAUCSL', 'pc1'),
    (cloudEnabled && sb) ? sb.from('risk_analysis').select('date,analysis').order('date', { ascending: false }).limit(1)
      .then(r => (r.data && r.data[0]) || null, () => null) : null,
    deepMegatrends(ticker, name),
    deepNews(ticker)
  ]);

  // Kurs + månadsstängningar (för multiplar vid varje bokslut).
  const cr = chart && chart.chart && chart.chart.result && chart.chart.result[0];
  const meta = (cr && cr.meta) || {};
  const cur = meta.currency || f.currency || null;
  const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : null;
  const monthClose = {};
  if(cr) {
    const ts = cr.timestamp || [], cl = (cr.indicators.quote[0].close || []), off = meta.gmtoffset || 0;
    ts.forEach((t, i) => { if(cl[i] != null) monthClose[new Date((t + off) * 1000).toISOString().slice(0, 7)] = cl[i]; });
  }

  const sameCur = !!(f.finCurrency && cur && f.finCurrency === cur);
  const netDebt = (f.debt != null && f.cash != null) ? f.debt - f.cash : null;
  const withBand = (d, band, dec) => { const t = deepTrend(d, dec); return t && band ? { ...t, regime: band(d.price).text } : t; };
  const tnx = spark['^TNX'];

  return {
    as_of: new Date().toISOString().slice(0, 10),
    company: {
      ticker, name, full_name: meta.longName || null, exchange: meta.exchangeName || null,
      currency: cur, financial_currency: f.finCurrency || null, price: deepR2(price),
      sector: f.sector || null, industry: f.industry || null,
      market_cap_mn: deepMn(f.mcap), enterprise_value_mn: deepMn(f.ev),
      ev_ebitda: deepR1(f.evEbitda), pe_ttm: deepR1(f.pe), pe_forward: deepR1(f.forwardPe), ps_ttm: deepR2(f.ps),
      pb: deepR2(f.pb), peg: deepR2(f.peg), roe_pct: deepR1(f.roe),
      gross_margin_pct: deepR1(f.grossMargin), operating_margin_pct: deepR1(f.opMargin), profit_margin_pct: deepR1(f.profitMargin),
      revenue_growth_pct: deepR1(f.revenueGrowth), revenue_ttm_mn: deepMn(f.revenue), ebitda_ttm_mn: deepMn(f.ebitda),
      net_income_ttm_mn: deepMn(f.netIncome), operating_cashflow_ttm_mn: deepMn(f.opCashflow), fcf_ttm_mn: deepMn(f.fcf),
      fcf_yield_pct: (sameCur && f.fcf != null && f.mcap) ? deepR1(f.fcf / f.mcap * 100) : null,
      cash_mn: deepMn(f.cash), total_debt_mn: deepMn(f.debt), net_debt_mn: deepMn(netDebt),
      net_debt_to_ebitda: (netDebt != null && f.ebitda > 0) ? deepR2(netDebt / f.ebitda) : null,
      debt_to_equity_pct: deepR1(f.debtToEquity), current_ratio: deepR2(f.currentRatio),
      dividend_yield_pct: deepR2(f.div), payout_ratio_pct: deepR1(f.payout), beta: deepR2(f.beta),
      week52_low: deepR2(meta.fiftyTwoWeekLow), week52_high: deepR2(meta.fiftyTwoWeekHigh),
      price_performance: (perf || '').replace(/^\s*Kursutveckling:\s*/, '').trim() || null,
      analysts: { target_mean: deepR2(f.targetMean), target_low: deepR2(f.targetLow), target_high: deepR2(f.targetHigh),
                  count: f.numAnalysts || null, recommendation: f.recommendation || null },
      description: f.description ? f.description.slice(0, 1500) : null
    },
    historical_annual: deepHistory(ann, monthClose, cur),
    historical_note: ann && ann.currency && cur && ann.currency !== cur
      ? `Rapportvaluta ${ann.currency} skiljer sig från handelsvaluta ${cur} – historiska multiplar ej beräknade.` : null,
    insider_trading: insider,
    macro: {
      us_10y_yield_pct: tnx ? { value: deepR2(tnx.price), value_3m_ago: deepR2((tnx.closes || [])[0]) } : null,
      fed_funds_target_pct: rates.fed ? { low: rates.fed.low, high: rates.fed.high, effr: rates.fed.effr, as_of: rates.fed.date || null } : null,
      riksbank_policy_rate_pct: rates.riksbank ? { value: rates.riksbank.rate, as_of: rates.riksbank.date || null } : null,
      ecb_main_rate_pct: rates.ecb ? { value: rates.ecb.rate, as_of: rates.ecb.date || null } : null,
      se_kpif_yoy_pct: kpif ? { value: deepR1(kpif.value), period: kpif.period } : null,
      us_cpi_yoy_pct: cpiUs ? { value: deepR1(cpiUs.value), as_of: cpiUs.date || null } : null,
      brent_usd: deepTrend(spark['BZ=F']),
      usdsek: deepTrend(spark['SEK=X'], 3)
    },
    risk_regime: {
      vix: withBand(spark['^VIX'], vixBand, 1),
      vxn: withBand(spark['^VXN'], null, 1),
      skew: withBand(spark['^SKEW'], skewBand, 0),
      gold_usd_oz: deepTrend(spark['GC=F'], 0),
      copper_usd_lb: deepTrend(spark['HG=F']),
      hyg_high_yield_etf: deepTrend(spark['HYG']),
      engine_daily_assessment: riskDaily ? { date: riskDaily.date, text: (riskDaily.analysis || '').slice(0, 1500) } : null
    },
    megatrends: mega,
    news
  };
}

function deepUserMessage(ctx) {
  const today = new Date().toLocaleDateString('sv-SE', { year:'numeric', month:'long', day:'numeric' });
  return `Dagens datum: ${today}. Genomlys ${ctx.company.name} (${ctx.company.ticker}) utifrån underlaget nedan, sammanställt automatiskt ur plattformens datakällor (Yahoo Finance, Fed/Riksbanken/ECB, SCB, FRED, riskbarometern, megatrendanalyser och nyhetsflödet).

Om underlaget:
- Fält som slutar på _mn är belopp i miljoner i bolagets rapportvaluta (financial_currency). Börsvärde, EV och kurser är i handelsvalutan (currency).
- historical_annual är bolagets räkenskapsår, 4–5 år bakåt (mer historik finns inte). Multiplarna där är beräknade på kursen vid respektive bokslut och är underlaget för 4–5-årssnitten.
- risk_regime-serierna visar värde, förändring 1 och 3 månader samt läge mot 50-dagarssnitt. HYG är en high yield-kreditfond: fallande HYG = vidgade kreditspreadar.
- Sektorkollegor ingår inte i underlaget.
- null eller saknade fält betyder att datan inte gick att hämta. Hitta inte på siffror för dem, säg att de saknas.
- Avsluta hela svaret med en maskinläsbar rad som inte visas för användaren: <decision>{"action": "KÖP"}</decision> – action är KÖP, AVVAKTA eller SÄLJ, samma som din rekommendation i avsnitt 1.

<underlag>
${JSON.stringify(ctx, null, 1)}
</underlag>`;
}

// Enkel markdown → HTML för promemorian (rubriker, listor, tabeller, fetstil). Escapar först.
function formatMemo(md) {
  // Maskinläsbara block (portföljgenomlysningens <screener_config>) visas inte som text –
  // även ett halvfärdigt block under strömningen döljs.
  md = md.replace(/<(screener_config|decisions|decision)>[\s\S]*?(<\/\1>|$)/g, '').trimEnd();
  const inline = s => escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?!\s)([^*]+?)\*/g, '<em>$1</em>')
    .replace(/^_(.+)_$/, '<em>$1</em>')
    .replace(/\[Baserat på intern förtränad kunskap\]/g, '<span class="memo-src">$&</span>'); // peers utanför underlaget
  const cells = t => t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
  const lines = md.replace(/\r/g, '').split('\n');
  let html = '', list = null, para = [];
  const flushPara = () => { if(para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const closeList = () => { if(list) { html += `</${list}>`; list = null; } };
  for(let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    let m;
    if(!t) { flushPara(); closeList(); continue; }
    if((m = t.match(/^(#{1,6})\s+(.+?)\s*#*$/))) {
      flushPara(); closeList();
      const tag = m[1].length <= 3 ? 'h3' : 'h4';
      html += `<${tag}>${inline(m[2])}</${tag}>`; continue;
    }
    if(/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); closeList(); html += '<hr>'; continue; }
    if(t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i+1].trim())) {
      flushPara(); closeList();
      const head = cells(t); i += 2;
      const body = [];
      while(i < lines.length && lines[i].trim().startsWith('|')) { body.push(cells(lines[i].trim())); i++; }
      i--;
      html += `<div class="memo-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
        body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
      continue;
    }
    if((m = t.match(/^[-*•]\s+(.+)$/))) {
      flushPara();
      if(list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`; continue;
    }
    if((m = t.match(/^(\d+)[.)]\s+(.+)$/))) {
      flushPara();
      if(list !== 'ol') { closeList(); html += `<ol start="${m[1]}">`; list = 'ol'; }
      html += `<li>${inline(m[2])}</li>`; continue;
    }
    closeList(); para.push(t);
  }
  flushPara(); closeList();
  return html;
}

// Strömmar ett Claude-svar som promemoria in i en container – delas av djupanalysen,
// CIO-analysen och portföljgenomlysningen. getOut() slås upp vid varje ritning (vyn
// kan ha ritats om under tiden); live() = false när användaren bytt vy eller startat
// en ny körning, då ritas inget mer. Fel och tomma svar ritas här. Returnerar
// { text, usage } (text med ev. kapningsnot) eller { error }.
async function streamMemo(body, { getOut, live, html = t => `<div class="memo">${formatMemo(t)}</div>` }) {
  let latest = '', queued = false, streaming = true;
  const paint = () => {
    queued = false;
    const out = getOut();
    if(!streaming || !live() || !out) return; // en sen bildruta får inte skriva över slutvyn
    let el = out.querySelector(':scope > .memo-live');
    if(!el) { out.innerHTML = '<div class="memo memo-live"></div>'; el = out.firstChild; }
    el.innerHTML = formatMemo(latest); // texten ritas om högst en gång per bildruta
  };
  const result = await callClaudeStream(body, partial => { latest = partial; if(!queued) { queued = true; requestAnimationFrame(paint); } });
  streaming = false;

  const out = getOut(), show = live() && out;
  let text = (result.text || '').trim();
  if(result.error) {
    if(show) out.innerHTML = (text ? html(text) : '') +
      `<div class="error-msg" style="margin-top:12px">API-fel: ${escHtml(result.error.message || result.error.type || 'okänt fel')}</div>`;
    return { error: result.error };
  }
  if(!text) {
    if(show) out.innerHTML = `<div class="error-msg">Tomt svar från modellen${result.stop_reason ? ' (' + escHtml(result.stop_reason) + ')' : ''}. Försök igen.</div>`;
    return { error: { message: 'tomt svar' } };
  }
  if(result.stop_reason === 'max_tokens') text += '\n\n_…svaret nådde längdgränsen och kapades._';
  else if(result.stop_reason === 'refusal') text += '\n\n_…modellen avbröt svaret._';
  return { text, usage: result.usage };
}

// Statusrad med spinner medan underlaget samlas / modellen tänker.
const memoStatus = (out, txt) => { if(out) out.innerHTML = `<div class="deep-status"><span class="spinner"></span>${txt}</div>`; };

// Körnings-id: byter man aktie mitt i en analys slutar den gamla att skriva i vyn,
// men den körs klart och sparas ändå i Sparade analyser.
let deepRunId = 0;
function resetDeepAnalysis(show) {
  deepRunId++;
  const card = document.getElementById('d-deep-card'); if(card) card.style.display = show ? '' : 'none';
  const out = document.getElementById('d-deep-out'); if(out) { out.style.display = 'none'; out.innerHTML = ''; }
  const btn = document.getElementById('d-deep-btn'); if(btn) { btn.disabled = false; btn.textContent = '✦ Kör Institutionell Djupanalys'; }
}

async function runDeepAnalysis() {
  if(currentIsFund || !currentTicker) return;
  const out = document.getElementById('d-deep-out'), btn = document.getElementById('d-deep-btn');
  out.style.display = '';
  if(!getApiKey()) {
    out.innerHTML = '<div class="error-msg">Ingen API-nyckel. Klistra in din Anthropic-nyckel i AI-panelen (✦ AI-analys) först.</div>';
    return;
  }
  const id = ++deepRunId, live = () => id === deepRunId;
  const ticker = currentTicker, name = currentStockName || ticker;
  const doneBtn = label => { if(live()) { btn.disabled = false; btn.textContent = label; } };
  const status = txt => { if(live()) memoStatus(out, txt); };
  btn.disabled = true; btn.textContent = '✦ Analyserar…';

  status('Samlar underlag: nyckeltal, bokslutshistorik, makro, riskregim, megatrender och nyheter…');
  let ctx;
  try { ctx = await buildDeepAnalysisContext(ticker, name); }
  catch(e) {
    if(live()) out.innerHTML = `<div class="error-msg">Kunde inte samla underlaget: ${escHtml(e.message)}</div>`;
    return doneBtn('✦ Kör Institutionell Djupanalys');
  }
  status('Analytikern går igenom underlaget – modellen tänker innan den skriver, det kan ta en minut…');

  const body = { model: DEEP_MODEL, max_tokens: 32000, system: DEEP_SYSTEM_PROMPT,
    output_config: { effort: 'high' }, messages: [{ role: 'user', content: deepUserMessage(ctx) }] };
  const result = await streamMemo(body, { getOut: () => out, live });
  if(result.error) return doneBtn('↻ Försök igen');
  const text = result.text;

  const costMeta = estimateCostText(DEEP_MODEL, result.usage);
  recordAiUsage('deep_analysis', DEEP_MODEL, result.usage);
  const c = ctx.company;
  const kurs = c.price != null ? `${fmtSekNum(c.price, 2)} ${c.currency || ''}`.trim() : 'kurs okänd';
  const deepTitle = `Institutionell djupanalys: ${name} (${ticker}) @ ${kurs}`;
  saveAnalysis({ ts: Date.now(), title: deepTitle, model: DEEP_MODEL, answer: text, cost: costMeta });
  // Rekommendationen till beslutsloggen (AI:ns träffsäkerhet).
  const dec = parseTagJson(text, 'decision');
  if(dec && dec.action) recordDecisions('deep_analysis', deepTitle, [{ ticker, name, action: dec.action, price: c.price, currency: c.currency,
    note: ((text.match(/###\s*1\.[^\n]*\n([\s\S]*?)(\n###|$)/) || [])[1] || '').replace(/[#*_<>]/g, '').trim().slice(0, 400) }]);

  if(live()) {
    out.innerHTML = `<div class="memo">${formatMemo(text)}</div>
      <div class="deep-meta">Sparad i Sparade analyser · kurs vid analys ${escHtml(kurs)} · ${escHtml(costMeta)}${currentUser ? '' : ' · logga in för att kostnaden ska synas i AI-kostnader'}</div>`;
  }
  doneBtn('↻ Kör ny djupanalys');
}
