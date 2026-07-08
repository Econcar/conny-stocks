// Proxy för centralbankernas styrräntor (Cloudflare Pages Function) – nyckelfria
// källor, löser CORS.
//   Fed:        NY Feds ränte-API (EFFR + målintervall)
//   Riksbanken: SWEA-API, serie SECBREPOEFF = styrräntan
//   ECB:        ECB Data Portal, MRO (huvudsakliga refinansieringsräntan)
// Varje källa hämtas oberoende – en som strular slår inte ut de andra.
export async function onRequest() {
  const UA = { 'User-Agent': 'Mozilla/5.0 (conny-stocks rates)' };
  const out = { fed: null, riksbank: null, ecb: null };

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

  await Promise.allSettled(tasks);

  return new Response(JSON.stringify(out), {
    headers: {
      'Content-Type': 'application/json',
      // Styrräntor ändras sällan – mellanlagra en timme
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
