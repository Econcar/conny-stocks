// CIO-analysen (taktisk tillgångsallokering) – delas av appen och motorn:
//   appen:  <script src="shared/cio.js">   (knappen på Översikt)
//   motorn: require('../../shared/cio')     (daglig körning, engine/lib/cio.js)
// Samma systemprompt, samma underlag och samma uträkningar i båda – ändra här, inte
// på två ställen. Ren JS utan beroenden. Marknadsdatan hämtas via appens egna
// /api-proxys: `base` = '' i webbläsaren, appens URL i motorn.

const CIO_MODEL = 'claude-sonnet-5';

const CIO_SYSTEM_PROMPT = `Du är en världsledande makroekonom och Chief Investment Officer (CIO). Din expertis ligger
i att läsa av makroekonomiska regimer, geopolitik, långsiktiga megatrender och centralbankers
likviditetsflöden, för att sedan översätta detta till konkret och benhård tillgångsallokering
(aktier, räntor, råvaror, guld).

DIN KLIENT: en svensk privatperson som räknar i kronor (SEK) och handlar via Avanza, främst
på ISK (investeringssparkonto). Allt du rekommenderar ska gå att genomföra därifrån.
- Den riskfria räntan är den SVENSKA korta räntan (statsskuldväxlar, se swedish_rates), inte
  amerikanska T-bills. Amerikanska räntor, Fed och dollarn är signaler om det globala läget –
  inte klientens avkastning.
- All avkastning i utländsk valuta ska bedömas i SEK. En dollarränta på 4 % är värd noll om
  dollarn faller 4 % mot kronan. Valutasäkring kostar ungefär räntedifferensen mot Sverige
  (sek_perspective.us_minus_se_3m_pp för USD), så säkrad dollarränta ≈ svensk ränta.
- Amerikanska fonder och ETF:er (t.ex. SGOV, BIL, SPY, QQQ) får inte säljas till privatpersoner
  i EU (saknar faktablad enligt PRIIPs). Rekommendera dem aldrig – peka på UCITS-fonder och
  europeiskt noterade ETF:er i stället.

TEKNISKA RAMVILLKOR:
1. Du har tillgång till realtidsdata i prompten gällande räntor, råvaror, riskindikatorer
   och geopolitiska rubriker. Använd dessa exakta siffror i din analys.
2. Ditt språk ska vara extremt professionellt, analytiskt och fritt från klyschor
   ("spännande tider", "marknaden är osäker"). Marknaden är alltid osäker – din uppgift
   är att tolka oddsen.
3. Hitta inte på fondnamn, avgifter eller räntor du inte vet. Ange hellre fondtyp (t.ex.
   "kort svensk räntefond", "global indexfond, valutasäkrad andelsklass") och be klienten
   kontrollera utbudet i Avanza.

REGEL 1: DU SKALL ALLTID GE SVARET FÖRST OCH SEDAN ANALYSEN.
Du måste inleda med en tydlig taktisk allokering och slutsats.

Strukturera analysen strikt enligt följande rubriker:

### 1. Taktisk Allokering & Regim (SVARET FÖRST)
- Vilken makroregim befinner vi oss i just nu? (t.ex. Stagflation, Reflation, Goldilocks,
  Kreditchock eller Likviditetsexpansion).
- Konkret allokeringsråd: Övervikt / Neutral / Undervikt för de fyra huvudklasserna:
  1) Aktier, 2) Långa/korta räntor, 3) Guld/Ädelmetaller, 4) Likvider/Cash (i SEK, med
  dagens svenska 3-månadersränta som riktmärke).
- Kort motivering: Varför är denna positionering optimal just nu baserat på risk/reward
  för en investerare som räknar i kronor?

### 2. Centralbanker, Räntor & Likviditet
- Tolka rörelserna i 10-årsräntan, Fed Funds och inflationsdatan.
- Riksbanken och Sverige: styrränta, svensk räntekurva (statsskuldväxlar och
  statsobligationer) och KPIF. Vad betyder det för svenska räntefonder och sparkonton?
- Drar centralbankerna in eller pumpar ut likviditet i systemet?
- Hur påverkar USD-indexets utveckling det globala kapitalflödet – och vart är kronan
  (USD/SEK, EUR/SEK) på väg?

### 3. Riskbarometern & Sentiment
- Analysera marknadens dolda riskaptit utifrån VIX, SKEW och High Yield (HYG).
- Tolka signalen från råvarumarknaden: Vad säger förhållandet mellan Koppar ("Dr Copper"
  för konjunktur) och Guld (säker hamn)? Är marknaden risk-på eller risk-av?

### 4. Megatrender & Geopolitik
- Utifrån inkomna nyhetsrubriker: Hur påverkar aktuella geopolitiska händelser (tullar,
  konflikter, blockader) de långsiktiga megatrenderna?
- Vilka effekter får detta på reshoring/deglobalisering, energitransformation och
  upprustning i närtid?

### 5. Sektorallokering för Aktiemarknaden
- Utifrån rådande makroregim och megatrender, namnge 2–3 aktiesektorer som ska ÖVERVIKTAS
  (t.ex. Försvar, Hälsovård, Energi, Råvaror). Motivera utifrån inflation och ränteläge.
- Namnge 1–2 aktiesektorer som ska UNDERVIKTAS (t.ex. räntekänsliga fastigheter,
  olönsam tech, cyklisk konsumtion). Motivera varför.

### 6. Den Svarta Svanen (Systemisk Risk)
- Identifiera den största systemiska risken just nu som marknaden felprissätter.
- Vad skulle få din allokeringstes i punkt 1 att fundamentalt haverera den kommande månaden?

### 7. Så gör du i Sverige (Avanza, ISK)
- Översätt allokeringen i punkt 1 till sådant klienten faktiskt kan köpa på Avanza, en rad
  per tillgångsklass: t.ex. sparkonto med insättningsgaranti, likviditetsfond eller kort
  svensk räntefond, svensk statsobligationsfond, global indexfond, Sverigefond, europeiskt
  noterade UCITS-ETF:er, guld via ETC/guldfond.
- Likvider: vilken ränta i SEK ger det ungefär (utgå från swedish_rates), jämfört med
  inflationen (KPIF)?
- Valutarisk: hur stor andel av rekommendationen är exponerad mot USD/EUR, vilket håll du
  tror kronan tar, och om valutasäkrade andelsklasser är värda kostnaden just nu.
- Avsluta med 2–3 konkreta åtgärder i punktform ("Flytta …", "Öka …", "Behåll …").`;

// Yahoo-symboler → fältnamn i underlaget. Hämtas i spark-frågor om max 20 (Yahoos gräns).
const CIO_SYMBOLS = {
  yields:      { '^IRX': 'us_3m_tbill_pct', '^TNX': 'us_10y_pct', '^TYX': 'us_30y_pct' },
  fx:          { 'DX-Y.NYB': 'usd_index_dxy', 'EURUSD=X': 'eurusd', 'SEK=X': 'usdsek', 'EURSEK=X': 'eursek' },
  commodities: { 'BZ=F': 'brent_usd', 'GC=F': 'gold_usd_oz', 'SI=F': 'silver_usd_oz', 'HG=F': 'copper_usd_lb' },
  risk:        { '^VIX': 'vix', '^VXN': 'vxn', '^SKEW': 'skew', 'HYG': 'hyg_high_yield_etf', 'IEF': 'ief_7_10y_treasury_etf' },
  equities:    { '^GSPC': 'sp500', '^IXIC': 'nasdaq', '^OMX': 'omxs30', 'EEM': 'msci_em_eem', 'BTC-USD': 'bitcoin_usd' }
};

const cioRound = (v, dec) => (v == null || !isFinite(v)) ? null : Math.round(v * 10 ** dec) / 10 ** dec;

// Spark-svar → { sym: { price, closes } } (6 mån dagsdata).
function cioParseSpark(json) {
  const out = {};
  for (const r of (json && json.spark && json.spark.result) || []) {
    const resp = r.response && r.response[0];
    if (!resp) continue;
    const meta = resp.meta || {};
    const closes = ((resp.indicators && resp.indicators.quote && resp.indicators.quote[0] && resp.indicators.quote[0].close) || []).filter(v => v != null);
    const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : (closes.length ? closes[closes.length - 1] : null);
    if (price != null) out[r.symbol] = { price, closes };
  }
  return out;
}

// Stängningen k handelsdagar före den senaste (21 ≈ 1 mån, 63 ≈ 3 mån).
const cioBack = (d, k) => (d && d.closes.length > k) ? d.closes[d.closes.length - 1 - k] : null;

// Nivå + procentuell förändring 1/3/6 mån + läge mot 50-dagarssnitt.
function cioTrend(d, dec = 2) {
  if (!d) return null;
  const pct = past => past ? cioRound((d.price - past) / past * 100, 1) : null;
  const last50 = d.closes.slice(-50);
  const sma50 = last50.length >= 20 ? last50.reduce((a, b) => a + b, 0) / last50.length : null;
  return { value: cioRound(d.price, dec), chg_1m_pct: pct(cioBack(d, 21)), chg_3m_pct: pct(cioBack(d, 63)),
           chg_6m_pct: pct(d.closes[0]), vs_50d_avg_pct: sma50 ? pct(sma50) : null };
}

// Räntor: förändring i procentenheter, inte procent.
function cioYield(d) {
  if (!d) return null;
  const pp = past => past != null ? cioRound(d.price - past, 2) : null;
  return { value: cioRound(d.price, 2), chg_1m_pp: pp(cioBack(d, 21)), chg_3m_pp: pp(cioBack(d, 63)), chg_6m_pp: pp(d.closes[0]) };
}

// Kvot mellan två serier (koppar/guld, HYG/IEF) och hur den rört sig.
function cioRatio(a, b, scale) {
  if (!a || !b || !b.price) return null;
  const at = (x, y) => (x != null && y) ? x / y * scale : null;
  const now = at(a.price, b.price);
  const pct = past => past ? cioRound((now - past) / past * 100, 1) : null;
  return { value: cioRound(now, 3), chg_1m_pct: pct(at(cioBack(a, 21), cioBack(b, 21))),
           chg_3m_pct: pct(at(cioBack(a, 63), cioBack(b, 63))), chg_6m_pct: pct(at(a.closes[0], b.closes[0])) };
}

// Hämtar marknads- och makrodata via appens proxys. Varje del är fristående –
// en källa som strular ger null i sitt fält, inte ett fel för helheten.
async function cioGatherMarketData({ base = '', fetchImpl = fetch } = {}) {
  const getJson = async path => {
    const r = await fetchImpl(base + path);
    if (!r.ok) throw new Error(path + ' → ' + r.status);
    return r.json();
  };
  const soft = p => p.catch(() => null);
  const num = j => (j && typeof j.value === 'number' && isFinite(j.value)) ? { value: j.value, date: j.date || null } : null;
  const syms = Object.values(CIO_SYMBOLS).flatMap(g => Object.keys(g));
  const sparkChunks = [];
  for (let i = 0; i < syms.length; i += 20) sparkChunks.push(syms.slice(i, i + 20));
  const sparkPath = chunk => '/api/yahoo?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v7/finance/spark?symbols=' +
    encodeURIComponent(chunk.join(',')) + '&range=6mo&interval=1d');
  const kpifQs = new URLSearchParams({
    path: 'tables/TAB6445/data', lang: 'sv', outputFormat: 'json-stat2',
    'valueCodes[PrelAggr]': 'SKPI02', 'valueCodes[ContentsCode]': '000007PM', 'valueCodes[Tid]': 'top(1)'
  });
  const [spark, rates, cpi, core, kpif] = await Promise.all([
    Promise.all(sparkChunks.map(c => soft(getJson(sparkPath(c)).then(cioParseSpark))))
      .then(parts => Object.assign({}, ...parts.filter(Boolean))),
    soft(getJson('/api/rates?se=1')),
    soft(getJson('/api/fred?series=CPIAUCSL&units=pc1').then(num)),
    soft(getJson('/api/fred?series=CPILFESL&units=pc1').then(num)),
    soft(getJson('/api/scb?' + kpifQs).then(j => {
      const val = j && j.value && j.value[0];
      const lab = j && j.dimension && j.dimension.Tid && j.dimension.Tid.category.label;
      return val != null ? { value: val, date: lab ? Object.values(lab).pop().replace('M', '-') : null } : null;
    }))
  ]);
  return { spark: spark || {}, rates: rates || {}, macro: { us_cpi: cpi, us_core_cpi: core, se_kpif: kpif } };
}

// Nyhetsrubriker: helst marknads-/makroflödet (RSS, GDELT) framför enskilda
// bolagsfilingar. Sorterat på kurspåverkan, sedan datum. Tar både appens
// grupperade signaler och motorns råa rader (summary/published_at/source/...).
function cioHeadlines(items, max = 15, days = 5) {
  const seen = new Set();
  const cutoff = Date.now() - days * 86400000;
  const uniq = (items || []).filter(x => {
    const k = (x.summary || '').toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    if (x.published_at && new Date(x.published_at).getTime() < cutoff) return false;
    seen.add(k);
    return true;
  });
  const byImpact = (a, b) => (b.impact_score || 0) - (a.impact_score || 0) ||
    String(b.published_at || '').localeCompare(String(a.published_at || ''));
  const macro = uniq.filter(x => x.source === 'rss' || x.source === 'gdelt').sort(byImpact);
  const rest = uniq.filter(x => x.source !== 'rss' && x.source !== 'gdelt').sort(byImpact);
  return [...macro, ...rest].slice(0, max).map(x => ({
    date: x.published_at ? String(x.published_at).slice(0, 10) : null, source: x.source || null,
    sentiment: x.sentiment || null, impact: x.impact_score != null ? x.impact_score : null, headline: x.summary
  }));
}

// Det strukturerade underlaget som skickas till modellen.
function buildCioContext({ spark = {}, rates = {}, macro = {}, megatrends = [], headlines = [] }) {
  const group = (g, fn) => Object.fromEntries(Object.entries(g).map(([sym, key]) => [key, fn(spark[sym], sym)]));
  const tnx = spark['^TNX'], irx = spark['^IRX'];
  const stat = (x, dec = 1) => x ? { value: cioRound(x.value, dec), period: x.date } : null;
  const se = rates.se || {};
  const seRate = k => se[k] ? { value: cioRound(se[k].rate, 2), as_of: se[k].date || null } : null;
  const seTb3 = se.tbill_3m ? se.tbill_3m.rate : null, se10 = se.gov_10y ? se.gov_10y.rate : null;
  const kpif = macro.se_kpif ? macro.se_kpif.value : null;
  return {
    as_of: new Date().toISOString().slice(0, 10),
    central_banks_and_inflation: {
      fed_funds_target_pct: rates.fed ? { low: rates.fed.low, high: rates.fed.high, effr: rates.fed.effr, as_of: rates.fed.date || null } : null,
      riksbank_policy_rate_pct: rates.riksbank ? { value: rates.riksbank.rate, as_of: rates.riksbank.date || null } : null,
      ecb_main_refi_rate_pct: rates.ecb ? { value: rates.ecb.rate, as_of: rates.ecb.date || null } : null,
      us_cpi_yoy_pct: stat(macro.us_cpi),
      us_core_cpi_yoy_pct: stat(macro.us_core_cpi),
      se_kpif_yoy_pct: stat(macro.se_kpif)
    },
    swedish_rates: {
      se_tbill_1m_pct: seRate('tbill_1m'), se_tbill_3m_pct: seRate('tbill_3m'), se_tbill_6m_pct: seRate('tbill_6m'),
      se_gov_2y_pct: seRate('gov_2y'), se_gov_5y_pct: seRate('gov_5y'), se_gov_10y_pct: seRate('gov_10y'),
      se_curve_10y_minus_3m_pp: (seTb3 != null && se10 != null) ? cioRound(se10 - seTb3, 2) : null
    },
    sek_perspective: {
      riskfree_sek_3m_pct: seTb3 != null ? cioRound(seTb3, 2) : null,
      real_riskfree_sek_3m_pp: (seTb3 != null && kpif != null) ? cioRound(seTb3 - kpif, 2) : null,
      us_minus_se_3m_pp: (seTb3 != null && irx) ? cioRound(irx.price - seTb3, 2) : null,
      us_minus_se_10y_pp: (se10 != null && tnx) ? cioRound(tnx.price - se10, 2) : null
    },
    us_treasury_yields: group(CIO_SYMBOLS.yields, cioYield),
    yield_curve_10y_minus_3m_pp: (tnx && irx) ? cioRound(tnx.price - irx.price, 2) : null,
    fx: group(CIO_SYMBOLS.fx, (d, sym) => cioTrend(d, sym === 'DX-Y.NYB' ? 2 : 4)), // usdsek/eursek: stigande = svagare krona
    commodities: { ...group(CIO_SYMBOLS.commodities, d => cioTrend(d)),
      copper_gold_ratio_x1000: cioRatio(spark['HG=F'], spark['GC=F'], 1000) },
    risk_and_credit: { ...group(CIO_SYMBOLS.risk, d => cioTrend(d)),
      hyg_ief_ratio: cioRatio(spark['HYG'], spark['IEF'], 1) },
    equities: group(CIO_SYMBOLS.equities, d => cioTrend(d)),
    megatrends: (megatrends || []).map(m => ({ theme: m.name, date: m.date || null, summary: (m.analysis || '').slice(0, 500) })),
    headlines: cioHeadlines(headlines)
  };
}

function cioUserMessage(ctx) {
  return `Dagens datum: ${ctx.as_of}. Nedan följer dagens underlag, hämtat automatiskt (Yahoo Finance, Fed/Riksbanken/ECB, FRED, SCB, plattformens megatrendanalyser och AI-triagerade nyhetsflöde).

Klienten är en svensk privatperson som räknar i SEK och handlar via Avanza (ISK).

Om underlaget:
- Serierna visar senaste värde, förändring 1/3/6 månader och läge mot 50-dagarssnitt. Räntor anges i procent och deras förändring i procentenheter (_pp).
- swedish_rates är Riksbankens noteringar för svenska statsskuldväxlar (1/3/6 mån) och statsobligationer (2/5/10 år) – senaste värde, utan historik.
- sek_perspective: riskfree_sek_3m_pct = klientens riskfria ränta. real_riskfree_sek_3m_pp = den minus KPIF. us_minus_se_3m_pp ≈ årlig kostnad för att valutasäkra dollar till kronor (och det klienten ger upp genom att stanna i SEK). us_minus_se_10y_pp = räntegapet på lång sikt.
- usdsek och eursek: stigande värde = svagare krona (utländska tillgångar blir värda mer i SEK).
- copper_gold_ratio_x1000 = kopparpris (USD/lb) / guldpris (USD/oz) × 1000. Stigande kvot = konjunkturoptimism, fallande = flykt till säkerhet.
- hyg_ief_ratio = high yield-kredit (HYG) / medellånga statsobligationer (IEF). Fallande kvot = vidgade kreditspreadar.
- headlines är AI-triagerade nyheter från de senaste dagarna (impact 0–1 = bedömd kurspåverkan). megatrends är plattformens senaste temaanalyser.
- null eller saknade fält betyder att datan inte gick att hämta. Hitta inte på siffror för dem, säg att de saknas.

<underlag>
${JSON.stringify(ctx, null, 1)}
</underlag>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CIO_MODEL, CIO_SYSTEM_PROMPT, CIO_SYMBOLS, cioGatherMarketData, buildCioContext, cioUserMessage, cioHeadlines };
}
