# Funktionsspec (mall)

> **Så här använder du mallen:** Skriv i vardagsspråk, som om du förklarade för en kompis.
> Fokusera på *vad du vill kunna göra* och *varför* — inte på hur det byggs tekniskt.
> Det är okej att lämna avsnitt halvfärdiga eller skriva "vet inte än". Vi diskuterar
> igenom den tillsammans efteråt. Ta bort de här instruktions­raderna (`>`) när du fyllt i.

**App/funktion:** Aktieanalysverktyg
**Skriven av:** Conny Carslsson
**Datum:** 2026-07-07
**Status:** Utkast

---

## 1. I en mening

> Sammanfatta hela idén i en enda mening. "En app som hjälper mig att ___."

En app som hjälper mig att investera mina pengar på bäst sätt.

---

## 2. Varför — problemet jag vill lösa

> Vad är frustrerande, tidskrävande eller omöjligt idag? Vad vill du slippa eller uppnå?
> Beskriv känslan/situationen, inte lösningen.

Det är väldigt mycket information man behöver analysera för att ta bra investeringsbeslut. Det är omöjligt att gå igenom, förstå och analysera all information. Jag vill ha hjälp att analysera information för att ta bra investeringsbeslut.

---

## 3. Vem ska använda den

> Bara du? Du + några till? Hur van är personen vid aktier/teknik? När och var används
> den (mobil på bussen, dator på kvällen)?

Det är bara jag som ska använda den. Jag är vad vid aktier och teknik. Jag vill framförallt använda den framför datorn. Men jag vill ha möjligheten att få viss information till mobilen. 

---

## 4. Vad jag vill få ut (de viktigaste målen)

> De 3–5 viktigaste sakerna du vill kunna göra eller få ut. Punktlista, ett mål per rad.

- Samla in information som kan ligga till grund för investeringsbeslut.
- Presentera informationen på ett överskådligt sätt.
- Hjälp med att analysera informationen.
- Komma med förslag på hur jag ska investera mina pengar.
- 

---

## 5. Vad appen INTE ska göra (avgränsning)

> Lika viktigt som vad den ska göra. Vad vill du medvetet hålla borta, åtminstone nu?
> Det håller idén fokuserad.

- Ingen automatisk handel
- 

---

## 6. Funktioner jag vill ha

> Lista i vardagsspråk, gärna som "Jag vill kunna ___". Blanda stort och smått —
> vi sorterar och prioriterar sen.

- Jag vill varje dag kunna få en sammanfatting av sådant som har hänt i världen som kan påverka mina investeringar. Det kan vara enskilda akter, fonder eller stora makrotrender.
- Jag vill kunna lista aktier (globalt, inkl. Stockholmsbörsen) och svenska fonder, med löpande uppdaterade kurser (nära realtid) och nyckeltal — från bästa tillgängliga källa. (Se §12 Datakällor.)
- Jag vill kunna ska en ska en favoritlista med aktier/fonder som jag följer lite närmare.
- Jag vill kunna sätta larm på aktier/fonder om något speciellt händer - ex om en aktie stiger över en viss nivå.
- Jag vill ha koll på räntor och växelkurser.
- Jag vill ha koll på hur olika marknader går.
- Jag vill ha koll på olika index.
- Jag vill ha koll på råvaror
- Jag vill kunna be AI analysera data (ex en aktier)
- Jag vill ha information om insiderköp
- Jag vill kunna mata in eller hämta vilka investeringar jag har gjort i Avanza.
- Jag vill kunna skanna olika aktieforum för att kunna leta efter olika triggers (sälj/köp).
- Jag vill kunna se hur olika sektorer går.
- Jag vill kunna ha koll på olika skräckindex.
- Jag vill kunna följa långsiktiga megatrender / investeringsteman (t.ex. AI & halvledare, elektrifiering/EV, försvar, energiomställning, hälsa/demografi) med en löpande AI-analys av hur varje tema utvecklas och vilka bolag/sektorer som gynnas.
- Jag vill att du hjälper mig att analysera mina investeringar och komma med förslag på förändringar. 

### Status per önskemål (2026-07-23)

> Listan ovan är önskemålen i mina egna ord och ändras inte. Tabellen visar vad som
> faktiskt finns i appen idag. ✅ klart · 🟡 delvis · ⬜ inte byggt

| Önskemål | Status | Var / vad som saknas |
|---|---|---|
| Daglig sammanfattning av världshändelser | 🟡 | Sidan **Nyheter** + motorn (`engine/`, kör 06:00 UTC dagligen: RSS, GDELT, SEC EDGAR, insider). Notis till mobilen saknas. |
| Lista aktier globalt + svenska fonder, kurser & nyckeltal | ✅ | **Aktiescreener** (sektor/industri/region), sök, **Aktiedetalj**, fonder via Avanza. |
| Favoritlista | ✅ | **Bevakningslista** i sidopanelen, Supabase-synkad mellan enheter. |
| Larm när något händer (t.ex. kurs över nivå) | ⬜ | Inte byggt. Kräver server-side utvärdering + notiskanal (Telegram var det tänkta valet). |
| Räntor och växelkurser | 🟡 | Räntor klart (**Makro**: centralbanksräntor via `/api/rates` + FRED). Växelkurser används bara internt för att räkna om portföljinnehav till SEK — ingen egen vy. |
| Hur olika marknader går | ✅ | **Översikt** + **Makro**. |
| Index | ✅ | **Översikt**. |
| Råvaror | ⬜ | Inte byggt. |
| Be AI analysera data (t.ex. en aktie) | ✅ | AI-panelen, **Sparade analyser**, samt **AI-fond** som förvaltar en fiktiv portfölj. |
| Insiderköp | 🟡 | `engine/sources/insider.js` samlar in data till Nyheter — ingen egen vy för insidersyn. |
| Mata in / hämta Avanza-innehav | 🟡 | **Min portfölj**: klistra in eller ladda upp tabellen från Avanza (Innehav → Inköpsinfo). Automatisk hämtning finns inte — Avanza har inget publikt konto-API. |
| Skanna aktieforum efter triggers | 🟡 | Reddit inläst via subreddit-RSS (r/aktier, r/stocks, r/wallstreetbets). Kvar: mentions-räkning som trigger, och svenska forum (kräver skrapning). Se `signal-pipeline-spec.md` §4.1. |
| Hur olika sektorer går | ✅ | Screenern filtrerar och sorterar på sektor/industri. |
| Skräckindex | ✅ | **Riskbarometer** (VIX, VXN m.fl. med tolkningsband). |
| Följa megatrender med löpande AI-analys | ✅ | **Megatrender** + `engine/lib/megatrends.js`. |
| AI som analyserar *mina* investeringar och föreslår ändringar | 🟡 | AI analyserar enskilda aktier, och AI-fonden förvaltar en fiktiv portfölj — men ingen genomgång av den egna portföljen med konkreta förändringsförslag. |

**Byggt utan att stå i §6** (kom till under arbetets gång): **Rapportkalender** (kommande
kvartalsrapporter i datumordning), **Jämförelse** (aktier sida vid sida), **AI-fond**
(AI bygger och förvaltar en fiktiv portfölj med schemalagd omvärdering, historik och
kostnadsspårning), **Riskbarometer** som egen sida.

---

## 7. En vanlig dag med appen

> Berätta som en liten historia hur du använder appen. "På morgonen kollar jag ___,
> och om ___ vill jag att den ___." Det här avslöjar ofta funktioner man annars missar.

Jag vill varje dag kunna logga in på websidan för att se vad som har hänt i världen som kan påverka mina investeringar. Jag vill ha en sammanfattning. Om något viktigt händer vill jag även ha rapport till min mobil.

---

## 8. Så vet jag att den är bra

> Hur märker du i vardagen att appen faktiskt hjälper dig? Beskriv i känsla/resultat,
> inte i siffror. "Jag slipper ___", "Jag hinner ___", "Jag missar aldrig ___."

Jag missar inte en möjlighet till en bra investering. Jag undviker dåliga invessteringar eller gör mig av med dåliga investeringar.

---

## 9. Prioritering

> Grovsortera funktionerna från §6. Det hjälper oss börja på rätt ställe.

> Uppdaterad 2026-07-23: det mesta av ursprungslistan är byggt. Nedan är vad som
> återstår, omsorterat efter var värdet finns nu. Full status i §6.

**Klart** — daglig sammanfattning (Nyheter + motorn), aktie- och fondlistning med kurser
och nyckeltal, favoritlista, sektorer, index, räntor, marknader, skräckindex, AI-analys av
enskild aktie, megatrender, portföljinmatning. Plus Rapportkalender, Jämförelse och AI-fond
som inte fanns i den ursprungliga listan.

**Måste ha (kvar):**
- Jag vill kunna sätta larm på aktier/fonder om något speciellt händer - ex om en aktie stiger över en viss nivå.
  *— den enda kvarvarande punkten som kräver ny infrastruktur (server-side utvärdering + notiskanal). Motorn finns nu, så grunden är på plats.*
- Jag vill ha rapport till min mobil när något viktigt händer (§7) — samma beroende som larmen.

**Bra att ha (kvar):**
- Jag vill att du hjälper mig att analysera mina investeringar och komma med förslag på förändringar.
  *— delvis: AI analyserar enskilda aktier, men inte min egen portfölj som helhet.*
- Jag vill ha information om insiderköp — data samlas redan in, men saknar egen vy.
- Jag vill ha koll på växelkurser — finns internt för valutaomräkning, men ingen egen vy.

**Kan vänta (drömmar / framtid):**
- Jag vill ha koll på råvaror
- Jag vill kunna skanna olika aktieforum för att kunna leta efter olika triggers (sälj/köp).
- Automatisk hämtning av innehav från Avanza (idag: klistra in tabellen).

---

## 10. Inspiration och referenser

> Appar, sajter eller tjänster du gillar — och vad specifikt du gillar med dem.
> Även "jag ogillar hur X gör Y" är användbart.

- Avanza är den app jag använder. Tycker den är bra att hitta information om aktier och fonder.

---

## 11. Öppna frågor och osäkerheter

> Saker du inte bestämt dig om, eller där du vill ha min input innan du väljer.

- ~~Var kommer "all Avanza-data" ifrån?~~ **Utrett — se §12.** Kortversion: ingen officiell Avanza-API finns, men Yahoo (globalt, inkl. Stockholmsbörsen) + Avanzas inofficiella fond-API täcker i praktiken behovet, och appen använder redan båda.
- "Komma med förslag på hur jag ska investera" (§4) — hur konkret? Ren analys/underlag, eller faktiska köp/sälj-förslag? Det påverkar både bygge och juridik (även för eget bruk).

---

## 12. Datakällor (utredning)

> Utredning gjord 2026-07-08 utifrån vad appen redan gör + tillgängliga API:er.

### Vad appen redan använder

| Källa | Vad den ger | Kod |
|-------|-------------|-----|
| **Yahoo Finance** (inofficiellt API) | Hela aktieuniversumet via screener, kurser, sektorer/industrier | `functions/api/screener.js`, `yahoo.js` |
| **Avanza** (inofficiellt `_api`) | Svenska fonder: sök, fonddetaljer, graf | `functions/api/avanza.js` |
| **Riksbank/Fed/ECB** | Styrräntor | `functions/api/rates.js` |

### Svaret på "var kommer Avanza-datan ifrån?"

Det finns **inget officiellt, publikt Avanza-API**. Men målet är i praktiken redan ~90 %
löst — bara inte *via* Avanza:

- **Globala aktier** (inkl. Stockholmsbörsen, `.ST`-tickers) → **Yahoo**. Täcker i princip
  hela Avanzas aktieuniversum.
- **Svenska fonder** (som Yahoo saknar) → **Avanzas inofficiella API**, som appen redan proxar.

### Tre viktiga förbehåll

1. **"Live" är en sanning med modifikation.** Yahoos inofficiella API ger *fördröjda* kurser
   (~15 min för många börser), inte tick-realtid. Äkta realtid kräver betald feed. Därför
   formulerat som "nära realtid" i §6/§9.
2. **Inofficiella API:er kan sluta funka.** Både Yahoo och Avanza är odokumenterade och kan
   ändras/blockeras utan förvarning. En driftrisk att vara medveten om — inte en showstopper
   (fungerar idag).
3. **"All tillgänglig data" är för brett för att vara byggbart.** Behöver konkretiseras: lista
   *vilka* fält per aktie som faktiskt ska visas (kurs, P/E, utdelning, börsvärde, historik,
   nyckeltal…), annars blir målet omätbart.

### Beslut: vi kör vidare på gratis-källorna (Yahoo + Avanza-fonder)

Betalalternativen utreddes men väljs bort tills vidare:

- **Börsdata** — priser: Premium 10 €/mån (ingen API), **Pro 25 €/mån** (nordisk API),
  **Pro+ 59 €/mån** (global API, max 200 nedladdningar/dag). **Men:** villkoren tillåter
  personlig analys men **förbjuder uttryckligen att bygga externa system/sajter/widgets som
  visar API-datan**. Eftersom appen *är* en deployad webbsajt som visar data är Börsdata i
  praktiken utesluten för den här arkitekturen — även för eget bruk. Beslut: **nej tills vidare.**
- **Finnhub / Financial Modeling Prep / EOD Historical** — mer globalt inriktade, gratisnivåer
  finns. Kan bli aktuella om Yahoo/Avanza slutar fungera. Sparas som reserv.

### Datafält per aktie (v1 — de vanligaste)

Konkretiserar "all tillgänglig data". Börja med dessa; fler kan läggas till längre fram.

| Fält | Exempel | Källa |
|------|---------|-------|
| Namn + ticker | Volvo B (VOLV-B.ST) | Yahoo |
| Marknad / börs | Stockholm | Yahoo |
| Aktuell kurs + valuta | 285,40 SEK | Yahoo |
| Dagens förändring | −1,2 % (−3,50) | Yahoo |
| Börsvärde | 580 mdr SEK | Yahoo |
| P/E-tal | 12,4 | Yahoo |
| Direktavkastning | 3,8 % | Yahoo |
| Volym (dagens) | 4,2 M | Yahoo |
| 52-veckors högsta/lägsta | 312 / 214 | Yahoo |
| Sektor / bransch | Industri / Fordon | Yahoo |
| Kursgraf (historik) | 1D/1M/1Å | Yahoo (fonder: Avanza) |

> Senare tillägg (ej v1): fler nyckeltal (P/B, EV/EBITDA, soliditet), utdelningshistorik,
> analytikerriktkurser, insiderköp — flera kräver rikare källa än Yahoo.

### Öppet beslut

- [x] ~~Yahoo + Avanza-fonder vs Börsdata~~ → **Gratis-källorna gäller tills vidare** (Börsdata
      utesluts av villkoren, se ovan).
- [x] ~~Vilka datafält per aktie?~~ → **v1-listan ovan** (utökas längre fram).

---

## 13. Teknisk riktning

> Framåtblickande arkitekturbeslut utifrån vart specen är på väg. Kompletterar den
> detaljerade `signal-pipeline-spec.md` (motorn bakom daglig sammanfattning).
> Skälen bakom de val som redan gjorts finns i `beslutslogg.md`.

### Utgångsläge (funkar bra idag, behålls)

- **En `index.html`** (statisk SPA, inget byggsteg, Chart.js + Supabase via CDN).
- **Cloudflare Pages Functions** (`functions/api/`) som request-tid-proxys (Yahoo, Avanza, räntor, Claude).
- **Supabase** för auth (Google) + watchlist. Klienten räknar, hosten är tunn.
- Användaren klistrar in **egen Anthropic-nyckel** i webbläsaren.

### Den stora ändringen: appen blir två delar

Flera Måste-ha/önskade funktioner (daglig sammanfattning, prislarm, Telegram-notis) måste
hända **utan att appen är öppen**. Det går inte i en ren klient-SPA. Därför delas appen i:

- **(a) Tunn läs-frontend** — dashboarden. Läser färdig data, renderar, kör on-demand-AI.
- **(b) Schemalagd backend-motor** — GitHub Actions-jobb (se signal-pipeline-spec) som hämtar
  data, kör AI och skriver till Supabase. Körs oavsett om någon är inloggad.

Pages Functions blir kvar men **bara** som lätta proxys. Allt som måste ske i bakgrunden
flyttar till motorn. **Detta är beslutet allt annat hänger på.**

### Följdändringar

1. **Två AI-vägar med olika nyckelmodeller:**
   - *On-demand* ("analysera denna aktie") → användarens nyckel i webbläsaren. Behålls.
   - *Bakgrund* (daglig sammanfattning, pipeline) → **din** nyckel som secret i motorn. Du
     står för den kostnaden.
2. **Cacha trög data i Supabase** i stället för att hämta allt live varje gång. Live-kurser
   hämtas fortsatt i klienten; aktieuniversum, fundamenta och signaler hämtar motorn på schema
   och lagrar. Skyddar mot att Yahoo/Avanza-API:er stryps (§12-risken) och ger den historik som
   larm/sammanfattningar ändå kräver.
3. **Larm utvärderas server-side** (motorn eller Supabase `pg_cron` + Edge Function): kollar
   watchlist-trösklar mot senaste data → Telegram. Kan inte bero på öppen flik.
4. **Bryt upp `index.html` till ES-moduler** (`<script type="module">`, en fil per vy + delad
   state-modul). Ingen bundler krävs. Ramverk (React/Vite) skjuts upp tills UI-komplexiteten
   verkligen kräver det — rör inte det som funkar.

### Vad som medvetet INTE ändras

- Byggsteg-fritt / CDN-libs — behålls tills en riktig smärta uppstår.
- "Räkna i klienten" för aggregering/rankning — fortsatt rätt.
- **Hostval är frikopplat från motorn** (motorn kör i GitHub Actions oavsett webbhost).
  Webbhosten flyttades till Cloudflare Pages — en driftfråga, inte en arkitekturfråga.
