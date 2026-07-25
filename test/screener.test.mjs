// Enhetstester för screener-proxyns dubblettfilter (functions/api/screener.js).
// Körs med:  node --test test/
import { test } from 'node:test';
import assert from 'node:assert';
import { dedupeTradable, TRADABLE } from '../functions/api/screener.js';

const q = (symbol, exchange, name) => ({ symbol, exchange, longName: name, shortName: name });

test('filtrerar bort börser Avanza inte handlar på', () => {
  const rows = [
    q('AAPL', 'NMS', 'Apple Inc.'),        // NasdaqGS – handlingsbar
    q('AAPLCO.CL', 'BVC', 'Apple Inc.'),   // Colombia – ej handlingsbar
    q('AAPL.BA', 'BUE', 'Apple Inc.'),     // Buenos Aires CEDEAR – ej handlingsbar
  ];
  const out = dedupeTradable(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'AAPL');
});

test('hemmamarknaden vinner när samma bolag finns på flera handlingsbara börser', () => {
  const rows = [
    q('NVD.DE', 'GER', 'NVIDIA Corporation'), // XETRA (poäng 5)
    q('NVDA', 'NMS', 'NVIDIA Corporation'),   // NasdaqGS (poäng 7) – ska vinna
  ];
  const out = dedupeTradable(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'NVDA');
});

test('olika aktieslag på samma börs behålls båda (GOOG/GOOGL)', () => {
  const rows = [
    q('GOOG', 'NMS', 'Alphabet Inc.'),
    q('GOOGL', 'NMS', 'Alphabet Inc.'),
  ];
  const out = dedupeTradable(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.symbol).sort(), ['GOOG', 'GOOGL']);
});

test('svenska A- och B-aktier är olika papper, inte dubbletter', () => {
  const rows = [
    q('INVE-A.ST', 'STO', 'Investor AB ser. A'),
    q('INVE-B.ST', 'STO', 'Investor AB ser. B'),
  ];
  const out = dedupeTradable(rows);
  assert.equal(out.length, 2);
});

test('nordisk notering vinner över tysk för samma bolag', () => {
  const rows = [
    q('NOVN.DE', 'GER', 'Novo Nordisk'),   // XETRA (5)
    q('NOVO-B.CO', 'CPH', 'Novo Nordisk'), // Köpenhamn (8) – ska vinna
  ];
  const out = dedupeTradable(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].exchange, 'CPH');
});

test('tom lista ger tom lista', () => {
  assert.deepEqual(dedupeTradable([]), []);
});

test('TRADABLE poängsätter nordiska börser högst', () => {
  assert.ok(TRADABLE.STO > TRADABLE.NMS, 'Stockholm > NasdaqGS');
  assert.ok(TRADABLE.NMS > TRADABLE.GER, 'NasdaqGS > XETRA');
  assert.equal(TRADABLE.BVC, undefined, 'Colombia ska inte finnas');
});
