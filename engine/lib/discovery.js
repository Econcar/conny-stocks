// Trendspaning: AI föreslår NYA framväxande megatrender utifrån de senaste
// dagarnas signaler, som inte redan täcks av befintliga teman. Förslagen
// sparas med status 'suggested' – du aktiverar dem i appen.

const { extract } = require('./anthropic');
const { recentSignals, getThemes, insertThemes } = require('./store');

const DISCOVERY_TOOL = {
  name: 'propose_themes',
  description: 'Föreslå nya framväxande investeringsteman som inte redan täcks.',
  input_schema: {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        description: '0–3 nya teman. Tom lista om inget nytt tydligt framträder.',
        items: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'kort id i gemener (a–z, 0–9, bindestreck)' },
            name: { type: 'string', description: 'kort visningsnamn på svenska' },
            keywords: { type: 'array', items: { type: 'string' }, description: '6–12 nyckelord/bolag i gemener för att matcha nyheter' },
            rationale: { type: 'string', description: '1–2 meningar om varför temat är framväxande just nu' }
          },
          required: ['slug', 'name', 'keywords', 'rationale']
        }
      }
    },
    required: ['themes']
  }
};

const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function discoverThemes() {
  const existing = await getThemes();               // alla statusar
  const existingIds = new Set(existing.map(t => t.id));
  const existingNames = existing.map(t => t.name).join(', ') || '(inga)';

  const signals = await recentSignals({ days: 7, limit: 500 });
  const ctx = signals.slice(0, 70)
    .map(s => `- ${s.summary}${s.ticker ? ` [${s.ticker}]` : ''}`)
    .join('\n') || '(inga signaler)';

  const prompt =
    'Du är en trendspanare för investeringsteman.\n\n' +
    `Befintliga teman (föreslå INTE dessa igen): ${existingNames}\n\n` +
    `Senaste veckans marknadssignaler:\n${ctx}\n\n` +
    'Föreslå 0–3 NYA framväxande långsiktiga investeringsteman som (a) syns i signalerna ovan, ' +
    '(b) inte redan täcks av de befintliga temana, och (c) har uthållig strukturell relevans ' +
    '(inte en enskild dagshändelse). Ge slug, namn, 6–12 nyckelord (bolag/termer, gemener) och ' +
    'en kort motivering. Om inget nytt tema tydligt framträder: returnera en tom lista.';

  const { input, model } = await extract(prompt, DISCOVERY_TOOL, { maxTokens: 1024 });
  const proposed = Array.isArray(input.themes) ? input.themes : [];

  const rows = [];
  for (const t of proposed) {
    const id = slugify(t.slug || t.name);
    if (!id || existingIds.has(id) || rows.find(r => r.id === id)) continue;
    rows.push({
      id,
      name: String(t.name || id).slice(0, 80),
      keywords: (Array.isArray(t.keywords) ? t.keywords : []).map(k => String(k).toLowerCase()).slice(0, 15),
      status: 'suggested',
      rationale: t.rationale ? String(t.rationale) : null,
      origin: 'ai'
    });
  }

  if (rows.length) await insertThemes(rows);
  return { model, proposed: proposed.length, added: rows.map(r => r.name) };
}

module.exports = { discoverThemes };
