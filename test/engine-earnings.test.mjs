// Enhetstester för motorns universum-dedup (engine/lib/earnings.js).
// Körs med:  node --test test/
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { dedupeCompanies, TRADABLE } = require('../engine/lib/earnings.js');

const r = (ticker, exchange, name) => ({ ticker, exchange, name });

test('korsnotering av samma bolag sorteras bort, hemmamarknaden vinner', () => {
  const rows = [
    r('NVD.DE', 'GER', 'NVIDIA Corporation'),
    r('NVDA', 'NMS', 'NVIDIA Corporation'),
  ];
  const out = dedupeCompanies(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, 'NVDA');
});

test('bolagssuffix (Inc/AB/Corp) stör inte matchningen', () => {
  const rows = [
    r('VOLV-B.ST', 'STO', 'AB Volvo (publ)'),
    r('VOL3.DE', 'GER', 'Volvo AB'),
  ];
  const out = dedupeCompanies(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].exchange, 'STO');
});

test('olika aktieslag på samma börs behålls', () => {
  const rows = [
    r('VOLV-A.ST', 'STO', 'Volvo, AB ser. A'),
    r('VOLV-B.ST', 'STO', 'Volvo, AB ser. B'),
  ];
  const out = dedupeCompanies(rows);
  assert.equal(out.length, 2);
});

test('olika bolag slås inte ihop', () => {
  const rows = [
    r('ERIC-B.ST', 'STO', 'Telefonaktiebolaget LM Ericsson'),
    r('ABB.ST', 'STO', 'ABB Ltd'),
  ];
  assert.equal(dedupeCompanies(rows).length, 2);
});

test('TRADABLE: nordiskt högst, ohandlingsbart saknas', () => {
  assert.ok(TRADABLE.STO >= TRADABLE.OSL);
  assert.ok(TRADABLE.OSL > TRADABLE.NMS);
  assert.equal(TRADABLE.BVC, undefined);
});
