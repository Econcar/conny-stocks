# Spec: Signalpipeline för kurspåverkande data

**Status:** Utkast / ej påbörjad
**Skapad:** 2026-07-06
**Ägare:** Conny
**Relaterat:** conny-stocks (aktie/fond-app), Supabase, planerad Telegram-prisavisering

---

## 1. Syfte

Bygga en **schemalagd pipeline** som löpande hämtar data som kan påverka aktiekurser
(forum, nyheter, bolagshändelser, insiderköp, analytikerbetyg, makro), kör **AI-analys**
på innehållet, och lagrar normaliserade **signaler** i Supabase som appen (och framtida
prisaviseringar) kan läsa.

Kärnprincip: **en pipeline, många källor.** All kurspåverkande data har samma form —
*en bit text kopplad till ett bolag/sektor vid en tidpunkt* — och samma analysfråga:
*"påverkar detta kursen, hur, och för vilka tickers?"*. Vi bygger **en analysmotor** och
pluggar in **källadaptrar**.

---

## 2. Mål och icke-mål

**Mål**
- Löpande, automatisk insamling + AI-analys utan att någon har appen öppen.
- Källoberoende analyssteg och lagring — ny datakälla = en ny liten adapter.
- Låg driftskostnad genom modellkaskad + batch + prompt caching.
- Resultat som appen kan visa per ticker/sektor.

**Icke-mål (i denna version)**
- Realtidshandel eller ordersignaler.
- Egen tung server-beräkning (all AI-tyngd ligger hos Anthropic; se §8).
- Investeringsrådgivning till tredje part (se §11).

---

## 3. Arkitektur

```
[källadaptrar]        [normalisering]     [AI-analys, delad]        [lagring]        [app]
forum ─┐
nyheter ┤
filings ┼──►  gemensamt "dokument"  ──►  cachad prompt + kaskad  ──►  signals-tabell ──► vy/rankning
macro   ┤     {källa, tid, text,          (sentiment, impact,        i Supabase          i webbläsaren
insider ┤      tickers?, typ}              tickers, confidence)                           (klientsidan)
ratings ┘
```

**Frikoppling:** Insamling + AI körs som ett **schemalagt jobb**, separat från webbhosten.
Webbappen förblir tunn (statisk SPA + proxy-funktioner) och läser bara färdiga signaler.
Aggregering/rankning per ticker sker i webbläsaren eller som Supabase-vy — inte i jobbet
(samma "räkna i klienten"-princip som resten av appen).

---

## 4. Datakällor (källadaptrar)

Varje adapter hämtar och normaliserar till det gemensamma dokumentformatet. Prioritera
**officiella / gratis** källor och respektera ToS + rate limits.

| Signal | Källa | Kadens | Not |
|--------|-------|--------|-----|
| Forum / social | Reddit API, StockTwits | ~30–60 min | Officiellt API, inte scraping |
| Nyheter | GDELT (gratis), RSS-flöden, Finnhub/Marketaux | ~15–30 min | GDELT är stort och gratis |
| Bolagshändelser (8-K) | SEC EDGAR RSS + fulltext | vid release | Materiella händelser = stora rörelser |
| Insiderköp (Form 4) | SEC EDGAR | dagligen | |
| Analytikerbetyg / vinst | Finnhub, Financial Modeling Prep | dagligen | Gratisnivåer |
| Makrokalender | Ekonomisk kalender (Trading Economics/Finnhub) | vid release | |
| Styrräntor | **Befintlig `rates.js`** (Fed/Riksbank/ECB) | timme | Redan byggd — första signalen |

> Ränte-funktionen (`functions/api/rates.js`) är alltså redan en av dessa signaler.

---

## 5. Gemensamt dokumentformat (input till analys)

```json
{
  "source": "sec_edgar",           // adapterns id
  "type": "filing_8k",             // signaltyp
  "external_id": "0001...",        // för dedup
  "url": "https://...",
  "published_at": "2026-07-06T12:00:00Z",
  "title": "…",
  "text": "…",                     // råtext att analysera
  "hint_tickers": ["AAPL"]         // valfritt, om källan redan vet
}
```

**Dedup:** hash på `source + external_id` (eller innehåll) så samma nyhet från flera
källor inte analyseras dubbelt.

---

## 6. AI-analys (delat steg)

Samma analysfråga oavsett källa → möjliggör återanvänd, cachad prompt.

**Output-schema (structured output):**
```json
{
  "sentiment": "positiv | neutral | negativ",
  "impact_score": 0.0,             // 0–1, uppskattad kurspåverkan
  "tickers": ["AAPL"],             // berörda bolag
  "sectors": ["Teknik"],
  "summary": "…",                  // kort sammanfattning
  "confidence": 0.0                // 0–1
}
```

### 6.1 Tvåstegs-kaskad (kostnadshävstång)
1. **Triage — Haiku 4.5 (`claude-haiku-4-5`, $1/$5):** körs på *allt*. "Materiellt? vilka tickers?"
2. **Djupanalys — Sonnet 4.6 (`claude-sonnet-4-6`, $3/$15) eller Opus 4.8 (`claude-opus-4-8`, $5/$25):**
   bara på det som triage flaggar som materiellt.

### 6.2 Kostnadsoptimering
- **Message Batches API → −50 %** på alla tokens. Passar schemalagt (svar behövs inte i realtid; klart oftast inom ~1 h, max 24 h).
- **Prompt caching:** lägg den fasta impact-rubriken/instruktionen först med `cache_control`.
  Cache-läsningar ~0,1× av inpris — stort när samma prompt körs över tusentals dokument.
- Structured outputs (`output_config.format`) för garanterat parsbar JSON.

> Standardmodell är Opus 4.8 om inget annat väljs; Haiku/Sonnet används medvetet för
> volym-/kostnadsskäl i kaskaden.

---

## 7. Lagring (Supabase)

Tabell `signals`, nyck*ad på ticker + tid så appen kan fråga "vad rör bolag X":

| kolumn | typ | not |
|--------|-----|-----|
| id | uuid | pk |
| source | text | adapter-id |
| type | text | signaltyp |
| external_id | text | dedup |
| url | text | |
| published_at | timestamptz | |
| ticker | text | en rad per berörd ticker |
| sector | text | |
| sentiment | text | |
| impact_score | numeric | 0–1 |
| summary | text | |
| confidence | numeric | 0–1 |
| created_at | timestamptz | default now() |

- **Unik constraint** på `(source, external_id, ticker)` för idempotens.
- **RLS** enligt befintligt mönster (jfr `watchlist_items`).
- **Aggregering/rankning** per ticker som Supabase-vy eller i klienten — inte i jobbet.

---

## 8. Var beräkningen körs

- **AI-tyngden** ligger hos **Anthropic** — jobbet gör bara fetch + API-anrop + skriv. Det är
  I/O-bundet och långkörande, inte CPU-tungt.
- Därför **olämpligt i edge-funktioner** (Cloudflare Workers 10 ms CPU; Supabase Edge ~150 s).
- Kör som **schemalagt batch-jobb med lång körtid + full Node/npm**:
  - **GitHub Actions** (schemalagt workflow) — enkelt, host-oberoende, i befintligt repo.
    Obs: privat repo har 2000 min/mån; schemalagda workflows pausas efter 60 dagars inaktivitet.
  - Alternativ: container-cron (Render/Fly/Railway) om volymen växer.
- **Prisaviseringar** (Telegram, separat men relaterat): **Supabase pg_cron + Edge Function**
  eller Cloudflare Cron Trigger — läser `signals`/watchlist, skickar Telegram vid träff, markerar skickat (dedup).

---

## 9. Säkerhet

- **Serverside Anthropic-nyckel:** till skillnad från appen (där användaren klistrar in sin
  egen nyckel i webbläsaren) behöver jobbet **din** nyckel som en **secret** (GitHub Actions
  secret / Supabase env). Du står för den kostnaden.
- Telegram bot-token + Supabase service key som secrets — aldrig i klienten.
- Respektera källornas ToS/rate limits; throttle:a; använd officiella API:er.

---

## 10. Kostnadsmodell (tumregel)

Dagligt scan av hundratals dokument:
- Haiku-triage på allt (billigt) + djupanalys bara på materiellt (fåtal).
- Batches (−50 %) + prompt caching (~0,1× på prefixet).
- → Landar i småpengar per dag, inte hundralappar. Kaskaden är största spararen vid många källor.

---

## 11. Regelefterlevnad

Detta liknar signalgenerering för investeringsbeslut.
- **Eget bruk:** fritt fram.
- **Delas med andra:** tydliga "inte investeringsrådgivning"-brasklappar; respektera
  källornas licens/ToS för vidaredistribution av innehåll.

---

## 12. Byggplan (fasat — börja smalt, generalisera schemat)

1. **Fas 0 – Fundament:** skapa `signals`-tabell + RLS. Definiera dokumentformat och
   output-schema. Sätt upp schemalagt jobb (GitHub Actions) + serverside-nyckel som secret.
2. **Fas 1 – Första källa end-to-end:** forum ELLER SEC EDGAR 8-K → normalisera →
   Haiku-triage (batch + cachad prompt) → skriv till `signals`. Visa i appen.
3. **Fas 2 – Kaskad:** lägg till djupanalyssteg (Sonnet/Opus) på materiellt flaggade dokument.
4. **Fas 3 – Fler adaptrar:** nyheter (GDELT/RSS), insider (Form 4), analytikerbetyg. Varje
   ny källa = en adapter mot samma analyssteg.
5. **Fas 4 – Aggregering & rankning:** Supabase-vy / klient-rankning per ticker; koppla till
   prisaviseringar (Telegram) via schemalagt jobb.

> Princip: gör `signals`-tabellen och analyssteget källoberoende **från dag ett**, men bygg
> inte alla adaptrar på spekulation.

---

## 13. Öppna beslut

- [ ] Hostingval för webbappen (Netlify credits vs Cloudflare-migrering) — påverkar inte
      jobbet (körs separat), men bör bestämmas.
- [ ] Första källa att implementera (forum vs SEC EDGAR).
- [ ] Jobbhost: GitHub Actions vs container-cron.
- [ ] Kadens per källa.
- [ ] Standardmodell i djupanalys (Sonnet 4.6 vs Opus 4.8).
- [ ] Ska prisaviseringar (Telegram) ingå i denna scope eller vara separat spec?
