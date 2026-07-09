// Källadapter: GDELT DOC 2.0 – bred global nyhetstäckning. Gratis, ingen nyckel.
// Ger artikelmetadata (titel, url, källa) att analysera – ingen fulltext, likt RSS.
// Filtrerar på finans/marknad via GDELT-query (konfigurerbar).

// Standard-query: stock market-tema på engelska. Justera via ENGINE_GDELT_QUERY.
const QUERY = process.env.ENGINE_GDELT_QUERY || 'theme:ECON_STOCKMARKET sourcelang:english';
const TIMESPAN = process.env.ENGINE_GDELT_TIMESPAN || '1d';
const MAX = Number(process.env.ENGINE_GDELT_MAX || 40);

module.exports = {
  id: 'gdelt',
  async fetch() {
    const params = new URLSearchParams({
      query: QUERY,
      mode: 'ArtList',
      format: 'json',
      maxrecords: String(Math.min(250, MAX * 2)),
      timespan: TIMESPAN,
      sort: 'DateDesc'
    });
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + params;

    let data;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'conny-stocks research' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      // GDELT svarar ibland med tom kropp eller varningstext i stället för JSON.
      if (!text.trim().startsWith('{')) throw new Error('inget JSON-svar');
      data = JSON.parse(text);
    } catch (err) {
      console.error(`[gdelt] kunde inte hämta: ${err.message}`);
      return [];
    }

    const articles = Array.isArray(data.articles) ? data.articles : [];
    const seen = new Set();
    const docs = [];
    for (const a of articles) {
      if (docs.length >= MAX) break;
      const link = a.url;
      const title = (a.title || '').trim();
      if (!link || !title || seen.has(link)) continue;
      seen.add(link);
      docs.push({
        source: 'gdelt',
        type: 'news',
        external_id: link,
        url: link,
        published_at: parseSeen(a.seendate),
        title,
        text: [title, a.domain ? `Källa: ${a.domain}` : ''].filter(Boolean).join('\n'),
        hint_tickers: []
      });
    }
    return docs;
  }
};

// GDELT-datum: "20260709T120000Z" → ISO-sträng.
function parseSeen(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}
