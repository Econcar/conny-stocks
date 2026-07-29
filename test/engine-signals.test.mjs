// Enhetstester för signalskrivningen (engine/lib/schema.js + engine/lib/store.js).
// Bakgrund: 29 juli 2026 föll hela dygnets skörd bort när EN batch avvisades.
// Körs med:  node --test test/
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Låtsasmiljö + stubbad fetch: testet ska aldrig nå riktiga Supabase.
process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

let batches = [];       // antal rader per POST
let failIndex = -1;     // vilken batch som ska svara med fel
globalThis.fetch = async (_url, opts) => {
  batches.push(JSON.parse(opts.body).length);
  if (batches.length - 1 === failIndex) {
    return { ok: false, status: 400, text: async () => '{"code":"21000"}' };
  }
  return { ok: true, status: 201, text: async () => '' };
};

const { toSignalRows, normalizeTickers } = require('../engine/lib/schema.js');
const { upsertSignals } = require('../engine/lib/store.js');

const reset = () => { batches = []; failIndex = -1; };
const rows = (n) => Array.from({ length: n }, (_, i) => ({ source: 'rss', external_id: 'd' + i, ticker: 'T' }));

test('normalizeTickers tar bort dubbletter och normaliserar skiftläge', () => {
  assert.deepEqual(normalizeTickers(['NVDA', ' nvda ', 'AAPL']), ['NVDA', 'AAPL']);
  assert.deepEqual(normalizeTickers(['VOLV-B.st']), ['VOLV-B.ST']);
});

test('ticker-svar som sträng tas emot i stället för att tappas', () => {
  assert.deepEqual(normalizeTickers('NVDA, aapl'), ['NVDA', 'AAPL']);
});

test('tom eller trasig ticker-lista ger en marknadsbred rad', () => {
  assert.deepEqual(normalizeTickers([]), ['']);
  assert.deepEqual(normalizeTickers(undefined), ['']);
  assert.deepEqual(normalizeTickers(['', null, '  ']), ['']);
});

test('toSignalRows ger en rad per unik ticker', () => {
  const doc = { source: 'rss', type: 'news', external_id: 'x1', url: null, published_at: null };
  const analysis = { sentiment: 'positiv', impact_score: 0.9, tickers: ['NVDA', 'nvda'], sectors: ['Teknik'], summary: 's', confidence: 0.8 };
  assert.deepEqual(toSignalRows(doc, analysis, 'm').map((r) => r.ticker), ['NVDA']);
});

test('skrivningen delas i batchar om 200 rader', async () => {
  reset();
  assert.deepEqual(await upsertSignals(rows(450)), { written: 450, failed: 0, firstError: null });
  assert.deepEqual(batches, [200, 200, 50]);
});

test('dubbletter på (source, external_id, ticker) sållas bort före skrivning', async () => {
  reset();
  const res = await upsertSignals([
    { source: 'rss', external_id: 'a', ticker: 'NVDA', summary: 'första' },
    { source: 'rss', external_id: 'a', ticker: 'NVDA', summary: 'andra' },
    { source: 'rss', external_id: 'a', ticker: '' }
  ]);
  assert.equal(res.written, 2);
  assert.deepEqual(batches, [2]);
});

test('en avvisad batch sänker inte de övriga', async () => {
  reset();
  failIndex = 1;
  const res = await upsertSignals(rows(450));
  assert.equal(res.written, 250);
  assert.equal(res.failed, 200);
  assert.match(res.firstError, /400/);
});

test('nätverksfel i en batch fångas i stället för att kasta', async () => {
  reset();
  const ok = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
  const res = await upsertSignals(rows(10));
  globalThis.fetch = ok;
  assert.equal(res.written, 0);
  assert.equal(res.failed, 10);
  assert.match(res.firstError, /ECONNRESET/);
});
