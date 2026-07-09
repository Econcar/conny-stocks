// Adapter-register. En källadapter är ett objekt:
//   {
//     id: 'sec_edgar',                 // matchar signals.source
//     async fetch() { return [ ...dokument ] }   // se ../lib/schema.js
//   }
//
// Lägg till nya källor genom att importera adaptern och lägga den i SOURCES.
// Analyssteget och lagringen är källoberoende – en ny källa = bara en ny adapter.
// (Fas 1: första riktiga källan läggs till här.)

const demo = require('./_demo');
const rss = require('./rss');
const edgar = require('./edgar');
const insider = require('./insider');

// Riktiga adaptrar registreras här. Demokällan är med endast för att kunna
// testa hela kedjan (analys + lagring) utan en riktig datakälla; kör med --demo.
const SOURCES = [rss, edgar, insider];

const DEMO_SOURCES = [demo];

function getSources({ includeDemo = false } = {}) {
  return includeDemo ? [...SOURCES, ...DEMO_SOURCES] : SOURCES;
}

module.exports = { getSources };
