# Migration: Netlify → Cloudflare Pages

**Status:** Genomförd — appen ligger på https://conny-stocks.pages.dev, Netlify är pensionerat.
Dokumentet behålls som historik över hur migreringen gjordes.
**Skapad:** 2026-07-08
**Varför:** Netlifys kredit-modell stänger av deploys och kan ta sajten offline när
krediterna tar slut. Cloudflare Pages gratisnivå har ingen sådan modell (statiskt
obegränsat, Functions 100 000 anrop/dygn) → varaktig lösning. Se `spec-mall.md` §13
(hostvalet är frikopplat från motorn).

**Omfattning:** Endast webbhosten byts. Signalmotorn (GitHub Actions) och Supabase
påverkas inte.

---

## Vad som ska portas

Sex Netlify-funktioner (258 rader totalt), alla med bara standard-`fetch` — inga
npm-paket, ingen `process.env`, inga Node-API:er. Mekanisk översättning:

| Netlify | Cloudflare Pages Functions |
|---------|----------------------------|
| `exports.handler = async (event) => {}` | `export async function onRequest(context) {}` |
| `event.queryStringParameters.x` | `new URL(context.request.url).searchParams.get('x')` |
| `event.headers['x-api-key']` | `context.request.headers.get('x-api-key')` |
| `event.body` (POST) | `await context.request.text()` |
| `return { statusCode, headers, body }` | `return new Response(body, { status, headers })` |

Logiken (allowlists, Yahoo cookie/crumb, ränte­hämtning, Claude-proxy) är oförändrad.

## Filstruktur

Cloudflare Pages mappar filväg → URL automatiskt. Lägg funktionerna under `/functions/api/`:

```
functions/api/claude.js     → /api/claude
functions/api/models.js     → /api/models
functions/api/yahoo.js      → /api/yahoo
functions/api/avanza.js     → /api/avanza
functions/api/screener.js   → /api/screener
functions/api/rates.js      → /api/rates
```

*(Sedan migreringen har `quote.js`, `fred.js`, `scb.js` och `earnings.js` tillkommit — samma mönster.)*

## Frontend-ändringar

Byt de sju anropen i `index.html` från `/.netlify/functions/<namn>` → `/api/<namn>`:
`screener`, `yahoo`, `rates`, `avanza` (×2), `claude`, `models`.

---

## Steg

1. **Branch:** skapa `cloudflare-migration` (rör inte `main`/Netlify under tiden).
2. **Porta funktionerna:** skapa `functions/api/*.js` (6 st) enligt tabellen ovan.
3. **Uppdatera frontend:** de 7 anropsvägarna i `index.html`.
4. **Anslut repo i Cloudflare** (manuellt, i dashboarden):
   - Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
   - Välj repo `Econcar/conny-stocks`.
   - Build command: *(tom)* · Output directory: `/` (root) · Functions hittas i `/functions`.
   - Deploy → sajten hamnar på `https://<projekt>.pages.dev`.
5. **Testa varje endpoint** på `*.pages.dev`: översikt (yahoo/screener/rates), fonder
   (avanza), AI-analys (claude/models). Kontrollera i webbläsarens Network-flik.
6. **Byt över:** när allt funkar, gör branchen till standard-deploy (merge till `main`
   eller peka Cloudflare på `main`). Netlify kan stängas/lämnas orörd.

## Att veta / risker

- **Inga secrets behövs** — Claude-proxyn använder användarens egen nyckel från headern;
  övriga funktioner är nyckelfria.
- **`screener.js` cookie/crumb-cache** blir mindre långlivad på Workers-runtime men
  auto-förnyas vid behov → ofarligt.
- **`getSetCookie()`** (i screener) stöds av Workers Fetch-API → ingen ändring.
- **Ingen big bang** — Cloudflare körs parallellt tills övertaget är verifierat.
- **Lokal dev:** `server.js` (Express) kan behållas, eller använd `wrangler pages dev`.

## Efter migration

- Uppdatera `docs/spec-mall.md` §13 och minnet (`netlify-sajt-urler`) med nya URL:en.
- Överväg custom domain i Cloudflare (valfritt).
