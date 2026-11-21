// Proxy för centralbankernas styrräntor (Cloudflare Pages Function) – nyckelfria
// källor, löser CORS.
//   Fed:        NY Feds ränte-API (EFFR + målintervall)
//   Riksbanken: SWEA-API, serie SECBREPOEFF = styrräntan
//   ECB:        ECB Data Portal, MRO (huvudsakliga refinansieringsräntan)
// Varje källa hämtas oberoende – en som strular slår inte ut de andra.
//
// ?se=1 lägger till svenska marknadsräntor (CIO-analysen): statsskuldväxlar
// (SWEA-grupp 6) och statsobligationer (grupp 7), två anrop för alla serier.
// Bara på begäran – SWEA utan nyckel tål bara några få anrop per minut.
const SE_SERIES = {
  SETB1MBENCHC: 'tbill_1m', SETB3MBENCH: 'tbill_3m', SETB6MBENCH: 'tbill_6m',
  SEGVB2YC: 'gov_2y', SEGVB5YC: 'gov_5y', SEGVB10YC: 'gov_10y'
};

export async function onRequest({ request }) {
  const UA = { 'User-Agent': 'Mozilla/5.0 (conny-stocks rates)' };
  const withSe = new URL(request.url).searchParams.get('se') === '1';
  const out = { fed: null, riksbank: null, ecb: null };
  if (withSe) out.se = null;

  async function getJson(url) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(url + ' → ' + r.status);
    return r.json();
  }

  const tasks = [
    (async () => {
      const d = await getJson('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json');
      const x = d && d.refRates && d.refRates[0];
      if (x) out.fed = { low: x.targetRateFrom, high: x.targetRateTo, effr: x.percentRate, date: x.effectiveDate };
    })(),
    (async () => {
      const d = await getJson('https://api.riksbank.se/swea/v1/Observations/latest/SECBREPOEFF');
      if (d && d.value != null) out.riksbank = { rate: d.value, date: d.date };
    })(),
    (async () => {
      const d = await getJson('https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?lastNObservations=1&format=jsondata');
      const series = d && d.dataSets && d.dataSets[0] && d.dataSets[0].series;
      const first = series && series[Object.keys(series)[0]];
      const obs = first && first.observations;
      const val = obs ? obs[Object.keys(obs)[0]][0] : null;
      let date = null;
      try {
        const tv = d.structure.dimensions.observation.find(x => x.id === 'TIME_PERIOD').values;
        date = tv[tv.length - 1].id;
      } catch (e) { /* datum är valfritt */ }
      if (val != null) out.ecb = { rate: val, date };
    })(),
  ];

  if (withSe) tasks.push((async () => {
    const groups = await Promise.allSettled([6, 7].map(g =>
      getJson('https://api.riksbank.se/swea/v1/Observations/Latest/ByGroup/' + g)));
    const se = {};
    const stale = Date.now() - 30 * 86400000; // nedlagda serier (t.ex. 12-månadersväxeln) hoppas över
    for (const g of groups) {
      if (g.status !== 'fulfilled' || !Array.isArray(g.value)) continue;
      for (const o of g.value) {
        const key = SE_SERIES[o.seriesId];
        if (key && typeof o.value === 'number' && new Date(o.date).getTime() > stale) se[key] = { rate: o.value, date: o.date };
      }
    }
    if (Object.keys(se).length) out.se = se;
  })());

  await Promise.allSettled(tasks);

  return new Response(JSON.stringify(out), {
    headers: {
      'Content-Type': 'application/json',
      // Styrräntor ändras sällan – mellanlagra en timme
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
