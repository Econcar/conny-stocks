# Motorn (signalpipelinen)

Schemalagt backend-jobb som hämtar kurspåverkande data, kör AI-triage och
skriver normaliserade **signaler** till Supabase. Frontend (appen) läser bara
färdiga signaler. Se `docs/signal-pipeline-spec.md` och `docs/spec-mall.md` §13.

Motorn är **dependency-fri** (Node 20+, global `fetch`, PostgREST för skrivning)
— ingen `npm install` behövs.

## Arkitektur

```
sources/*.js  →  lib/schema.js   →  lib/anthropic.js  →  lib/store.js
(adaptrar)       (normalisering)    (Haiku-triage)       (Supabase upsert)
                         ↑ run.js orkestrerar hela kedjan
```

Källoberoende: en ny datakälla = en ny adapter i `sources/`. Analys och lagring
rörs inte.

## Kör lokalt

1. Installera Node 20+.
2. Kopiera `engine/.env.example` → `engine/.env` och fyll i nycklarna.
   `engine/.env` laddas automatiskt av motorn (dependency-fritt, se `lib/env.js`)
   och är `.gitignore`:ad – den committas aldrig.
3. Kör tabellen i `../supabase-signals.sql` i Supabase (SQL Editor) en gång.
4. Kör:

   ```sh
   node engine/run.js --dry          # analyserar men skriver INTE (ingen prod-påverkan)
   node engine/run.js                # skarpt: skriver signaler till Supabase
   node engine/run.js --source=rss   # bara en källa
   ```

### Flaggor

| Flagga | Effekt |
|--------|--------|
| `--demo` | Inkludera demokällan (test utan riktig datakälla) |
| `--dry` | Kör allt utom skrivningen – skriv ut raderna i stället |
| `--source=<id>` | Kör bara en angiven källa |
| `--earnings-only` | Kör bara rapportkalendern (ingen AI – går bra att köra ofta) |

## Schemalagt (GitHub Actions)

`.github/workflows/engine.yml` kör dagligen 06:00 UTC och kan startas manuellt
(Actions → signal-engine → Run workflow, med demo-kryssruta).

Lägg in dessa som **repo-secrets** (Settings → Secrets and variables → Actions):

| Secret | Värde |
|--------|-------|
| `ANTHROPIC_API_KEY` | Din Anthropic-nyckel |
| `SUPABASE_URL` | `https://<projekt>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service role**-nyckeln (ej anon) |

## Källor

| id | Vad | Konfiguration |
|----|-----|---------------|
| `rss` | Finansnyheter via RSS/Atom (CNBC ×2, MarketWatch, Yahoo Finance, WSJ, Investing.com, Dagens Industri) | `ENGINE_RSS_FEEDS` (kommaseparerade URL:er), `ENGINE_RSS_MAX_PER_FEED` (15), `ENGINE_RSS_FRESH_HOURS` (48) |
| `sec_edgar` | Amerikanska 8-K (materiella bolagshändelser) via SEC EDGAR, med dokumenttext, 8-K-punkter och CIK→ticker | `ENGINE_EDGAR_MAX` (20), `ENGINE_EDGAR_FRESH_HOURS` (48), `ENGINE_EDGAR_UA` (SEC-User-Agent) |
| `sec_insider` | Insidertransaktioner via SEC Form 4 – issuer, ticker, insider/roll och öppna marknadsköp/-sälj (koder P/S) | `ENGINE_INSIDER_MAX` (20), `ENGINE_INSIDER_FRESH_HOURS` (48), `ENGINE_EDGAR_UA` |
| `gdelt` | **Avaktiverad** (filen finns kvar). GDELT DOC 2.0 429:ar från moln-IP:n (GitHub-runners). Bredd täcks i stället av fler RSS-flöden | `ENGINE_GDELT_QUERY`, `ENGINE_GDELT_TIMESPAN`, `ENGINE_GDELT_MAX` |
| `demo` | Syntetiskt testdokument (endast med `--demo`) | – |

## Status

- **Fas 0 (klar):** fundament – `signals`-tabell, dokument-/output-schema,
  triage, lagring, schemalagt jobb.
- **Fas 1 (klar):** första riktiga källan – RSS-finansnyheter – end-to-end, med
  dedup mot redan lagrade signaler.
- **Fas 2 (klar):** djupanalys-kaskad – materiella dokument (impact ≥ `ENGINE_DEEP_THRESHOLD`,
  default 0.5) skickas vidare till en starkare modell (`ENGINE_DEEP_MODEL`, default Opus 4.8)
  som fyller `analysis` (rationale) + `model` i signalen. Kräver Fas 2-migrationen
  (`../supabase-signals-fas2.sql`). Kostnadstak: `ENGINE_DEEP_MAX` (default 20/varv).
- **Fas 3 (pågår):** fler adaptrar. Klart: **SEC EDGAR 8-K**, **SEC Form 4 (insider)**, **breddad RSS**
  (7 flöden inkl. Dagens Industri). GDELT provades men avaktiverades (429 från moln-IP:n). Kvar: analytikerbetyg.
- **Daglig riskbarometer-analys:** utöver signalerna kör motorn en daglig AI-sammanvägning av
  risk-/sentimentindikatorer (`lib/risk.js`) och sparar den i `risk_analysis` (kräver
  `../supabase-risk-analysis.sql`). Modell via `ENGINE_RISK_MODEL` (default = djupmodellen).
  Kör enbart den med `node engine/run.js --risk-only`.
- **Daglig megatrend-analys:** AI-analys per långsiktigt tema (`lib/megatrends.js`), grundad i
  de senaste dagarnas signaler (matchas på nyckelord). Sparas i `megatrends` (kräver
  `../supabase-megatrends.sql`). Modell via `ENGINE_TREND_MODEL`. Kör enbart den med
  `node engine/run.js --trends-only`.
- **Daglig rapportkalender:** motorn bygger ett universum av bolag som går att handla via
  Avanza (Yahoos screener, ~1 800 bolag efter börsfilter) och slår upp nästa rapportdatum per
  ticker via `v7/quote`. Sparas i `earnings_calendar` (kräver `../supabase-earnings.sql`).
  Ingen AI inblandad. Rader som inte skrivits om på 7 dygn rensas bort. Kör enbart den med
  `node engine/run.js --earnings-only` (lägg till `--dry` för att bara se resultatet).
  Skälet till att detta ligger i motorn: Yahoos egen kalender-endpoint är nästan tom
  (601 rader ≈ 22 unika bolag på ett år, inga nordiska) – se `../docs/beslutslogg.md`.
- **Teman i databasen + trendspaning:** temana ligger i `themes` (kräver
  `../supabase-themes.sql`, seedat med 5 st). Motorn spanar **veckovis** (måndagar UTC) efter
  nya framväxande teman (`lib/discovery.js`) och sparar dem som `status='suggested'` – du
  aktiverar dem i appen. Kör enbart spaningen med `node engine/run.js --discover`.
