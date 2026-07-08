// Demokälla – används bara för att testa hela pipelinen (analys + lagring)
// end-to-end utan en riktig datakälla. Aktiveras med flaggan --demo.
// Fungerar också som mall för riktiga adaptrar (se ./index.js).

module.exports = {
  id: 'demo',
  async fetch() {
    const today = new Date().toISOString().slice(0, 10);
    return [
      {
        source: 'demo',
        type: 'news',
        external_id: `demo-${today}-1`, // stabilt per dag → dedup fungerar vid omkörning
        url: 'https://example.com/demo',
        published_at: new Date().toISOString(),
        title: 'Volvo höjer prognosen efter rekordkvartal',
        text:
          'Volvo rapporterar ett rekordkvartal med orderingång långt över ' +
          'analytikernas förväntningar och höjer helårsprognosen. Bolaget pekar ' +
          'på stark efterfrågan på lastbilar i Europa.',
        hint_tickers: ['VOLV-B.ST']
      }
    ];
  }
};
