// Enhetstester för Gemini-proxyn (functions/api/gemini.js) med låtsad Google-fetch.
// Körs med:  node --test test/
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { onRequest } from '../functions/api/gemini.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const call = (body = { model: 'gemini-3.8-flash', contents: [] }, key = 'AIzaTEST') => onRequest({
  request: new Request('https://x/api/gemini', { method: 'POST',
    headers: key ? { 'x-goog-api-key': key, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) })
});
const events = text => text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));

test('svarar direkt med SSE innan Google svarat, och strömmar sedan igenom svaret', async () => {
  let release, seen;
  globalThis.fetch = (url, opts) => { seen = { url, opts }; return new Promise(r => { release = r; }); };
  const res = await call();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader(), dec = new TextDecoder();
  assert.match(dec.decode((await reader.read()).value), /^: ok/);   // livstecken innan Google svarat
  release(new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hej"}]}}]}\n\n',
    { headers: { 'content-type': 'text/event-stream' } }));
  let rest = '';
  for(;;) { const { done, value } = await reader.read(); if(done) break; rest += dec.decode(value); }
  assert.equal(events(rest)[0].candidates[0].content.parts[0].text, 'Hej');
  assert.match(seen.url, /models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
  assert.equal(seen.opts.headers['x-goog-api-key'], 'AIzaTEST');
  assert.equal(JSON.parse(seen.opts.body).model, undefined);
});

test('fel från Google blir ett data: {error}-event med statuskod', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify([{ error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' } }]), { status: 429 });
  const [ev] = events(await (await call()).text());
  assert.equal(ev.error.code, 429);
  assert.match(ev.error.message, /exhausted/);
});

test('nätverksfel och icke-JSON-fel blir också error-event', async () => {
  globalThis.fetch = async () => { throw new Error('connect failed'); };
  assert.match(events(await (await call()).text())[0].error.message, /connect failed/);
  globalThis.fetch = async () => new Response('Bad Gateway', { status: 502 });
  const [ev] = events(await (await call()).text());
  assert.equal(ev.error.code, 502);
  assert.equal(ev.error.message, 'Bad Gateway');
});

test('saknad nyckel och ogiltig modell avvisas utan anrop till Google', async () => {
  globalThis.fetch = () => { throw new Error('ska inte anropas'); };
  assert.equal((await call(undefined, null)).status, 401);
  assert.equal((await call({ model: '../x' })).status, 400);
});
