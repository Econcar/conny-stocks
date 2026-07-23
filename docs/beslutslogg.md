# Beslutslogg

En rad per icke-uppenbart vägval: **vad** som bestämdes, **varför**, och vad det **kostar oss**.
Buggfixar och vanliga funktionstillägg hör inte hemma här — de står i `git log`, som är den
fullständiga ändringshistoriken. Det här dokumentet fångar bara det som `git log` *inte* visar:
skälet bakom ett val, och vad vi medvetet valde bort.

Nyast först. Poster som ångrats stryks inte — de får en rad om vad som ersatte dem.

---

### 2026-07-23 · Beslutslogg införd, specen uppdateras bara vid arkitekturändringar

Specdokumenten i `docs/` uppdateras automatiskt när en ändring rör arkitektur, hosting,
datakällor eller stänger ett öppet beslut — inte vid vanliga funktionstillägg och buggfixar.
Ingen manuell changelog över alla ändringar.

**Varför:** `spec-mall.md` §13 beskrev fortfarande Netlify femton commits efter migreringen,
vilket gör specen missvisande som beslutsunderlag. Samtidigt vore en handunderhållen changelog
en sämre kopia av `git log` som garanterat glider isär. Det som faktiskt saknas är *varför*,
inte *vad* — därav den här filen.

---

### 2026-07-13 · Rapportkalender: en rad per bolag, primärnoteringen vinner

Dubbletter (samma bolag på flera börser) slås ihop och primärnoteringen behålls.

**Varför:** Yahoos earnings-data listar varje notering separat, vilket gav samma rapport tre
gånger i kalendern. **Kostnad:** en sekundärnotering man faktiskt äger kan visas under
huvudtickerns namn.

---

### 2026-07-12 · AI-fondens omvärdering körs på servern, inte i webbläsaren

Omvärderingen flyttades till motorn (`engine/lib/aifunds.js`) med valbart intervall.

**Varför:** en fond som bara omvärderas när någon råkar ha fliken öppen är inte en fond.
Detta var första gången motorn användes till något annat än signalpipelinen — den är nu
generell infrastruktur för allt som måste hända utan att appen är öppen.
**Kostnad:** omvärderingarna dras på *din* API-nyckel, inte användarens. Därav
kostnadsspårningen per körning och KPI-kortet med totalsumman.

---

### 2026-07-11 · AI får aldrig räkna valuta själv

Appen räknar om alla belopp till SEK innan de skickas till AI:n, och normaliserar
minorvalutor (pence/cent → huvudvaluta).

**Varför:** portföljanalysen gav fel totaler när modellen gissade växelkurser, och
London-aktier blev ~100× för höga när pence tolkades som pund. Aritmetik och enheter är
appens ansvar; AI:n ska tolka, inte räkna.

---

### 2026-07-11 · Kostnadskontroll som designprincip för AI-anropen

Webbsök är opt-in, billigare modell som standard, kortare kontext, och "Analysera"-knapparna
förbereder analysen men väntar på ett explicit "Kör analys". Faktisk kostnad och tokens visas
per fråga.

**Varför:** ett oavsiktligt klick ska aldrig kunna kosta pengar utan att du sett det först.
Kostnaden ska vara synlig i stunden, inte upptäckas på fakturan.

---

### 2026-07-11 · Avanza-innehav klistras in, hämtas inte automatiskt

Portföljen importeras genom att kopiera tabellen från Avanza (Innehav → Inköpsinfo) eller
ladda upp en CSV. Tickers mappas mot Yahoo med ISIN som fallback.

**Varför:** Avanza har inget publikt konto-API. Alternativet vore att be om ditt lösenord,
vilket inte är aktuellt. **Kostnad:** manuellt steg vid varje uppdatering av innehaven.

---

### 2026-07-10 · Makrodata live från FRED och SCB, aldrig hårdkodat

BNP, inflation, kärninflation och arbetslöshet hämtas från FRED (US + Sverige) och svensk KPIF
från SCB:s PxWebApi 2.0.

**Varför:** hårdkodade makrovärden blir tyst felaktiga och är omöjliga att upptäcka i UI:t.
Hellre ett tomt fält än ett gammalt tal som ser aktuellt ut.

---

### 2026-07-09 · GDELT avaktiverad, RSS breddad istället

GDELT-adaptern byggdes men stängdes av; RSS-källorna utökades för att täcka samma bredd.

**Varför:** GDELT svarar 429 från moln-IP:n (GitHub Actions), inte från lokal körning.
Adaptern ligger kvar i `engine/sources/` och kan slås på igen om körningen flyttar.

---

### 2026-07-08 · Netlify → Cloudflare Pages

Webbhosten byttes; proxyerna portades till Pages Functions i `functions/api/` och anropen
gick från `/.netlify/functions/<namn>` till `/api/<namn>`. Se `cloudflare-migration.md`.

**Varför:** Netlifys kreditmodell stängde av produktionsdeploys när krediterna tog slut —
sajten kunde alltså gå offline av budgetskäl, inte tekniska. Cloudflares gratisnivå har ingen
sådan spärr (statiskt obegränsat, Functions 100 000 anrop/dygn).
**Kostnad:** ingen i praktiken — funktionerna använde bara standard-`fetch`, så porteringen
var mekanisk.

---

### 2026-07-08 · Två AI-vägar med olika nyckelmodeller, och en kaskad för att hålla nere kostnaden

*On-demand* (analysera en aktie) använder användarens egen Anthropic-nyckel från webbläsarens
localStorage. *Bakgrund* (motorn) använder din nyckel som secret i GitHub Actions. Motorns
nyheter triageras billigt först, och bara materiella händelser går vidare till djupanalys med
en dyrare modell.

**Varför:** on-demand-användning ska inte belasta dig, och nyckeln ska aldrig ligga på en
server vi måste skydda. Bakgrundsjobbet kan däremot inte be någon om en nyckel — det körs när
ingen är inloggad. Kaskaden finns för att en full analys av varje nyhetsflöde skulle bli
orimligt dyr.

---

### 2026-07-06 · Appen delas i två: tunn frontend + schemalagd motor

Dashboarden läser färdig data och renderar. En separat Node-motor (`engine/`) körs på schema i
GitHub Actions (dagligen 06:00 UTC), hämtar data, kör AI och skriver till Supabase.

**Varför:** daglig sammanfattning, larm och notiser måste hända *utan att appen är öppen*. Det
går inte i en ren klient-SPA. Detta är beslutet som allt annat i §13 hänger på.
**Kostnad:** två körmiljöer att hålla reda på, och trög data cachas i Supabase i stället för
att hämtas live.

---

### 2026-07-05 · Egen `rates`-funktion för centralbanksräntor

Fed, Riksbanken och ECB hämtas via en egen proxy från nyckelfria källor.

**Varför:** inget enskilt gratis-API täcker alla tre. Proxyn samlar dem och slipper API-nycklar
i klienten.

---

### 2026-06-20 · Yahoos inofficiella screener med sortering på serversidan

Screenern filtrerar hela Yahoo-universumet på sektor/industri/region med sidbladdring, och
sorterar server-side. Cookie/crumb-autentiseringen hanteras i proxyn.

**Varför:** sortering i klienten sorterar bara den laddade sidan, vilket ger fel svar på
"störst börsvärde". **Kostnad:** ett inofficiellt API till, och sorteringsfält som ibland
skiljer sig från det visade värdet (P/E-fallet) — därav efterjustering av den synliga sidan.

---

### 2026-06-17 · Supabase för auth och molnsynk, local-first i klienten

Google OAuth + tabeller med RLS. localStorage renderar UI:t direkt; molnet synkas i bakgrunden
när man är inloggad.

**Varför:** bevakningslistan ska följa med mellan enheter utan att vi driftar en egen backend.
Local-first gör att appen fungerar utloggad och känns omedelbar — molnet är en bonus, inte ett
beroende.

---

### 2026-06-16 · Svenska fonder via Avanzas inofficiella API

Fondsök, fondguide och grafer hämtas från Avanzas publika men odokumenterade endpoints.

**Varför:** det finns ingen gratis, öppen källa för svenska fonddata. **Kostnad:** kan sluta
fungera utan förvarning — men bara fondfunktionen faller då, resten av appen är oberoende.
Avanza blockerar inte hostens IP (kontrollerat).

---

### 2026-06-16 · Alla externa API-anrop går genom egna proxys

Ingen tredjeparts-API anropas direkt från webbläsaren.

**Varför:** i första hand CORS — Yahoo och Avanza tillåter inte browseranrop. I andra hand att
det blev snabbare, och att nycklar (FRED, Anthropic i motorn) kan hållas utanför klienten.

---

### 2026-06-15 · En enda `index.html`, inget byggsteg

Hela frontend är vanilla JS i en fil, med Chart.js och Supabase via CDN. Ingen bundler, inget
ramverk.

**Varför:** projektet ligger på Google Drive (G:\), där npm-installationer är opålitliga — och
en app utan byggsteg kan deployas genom att pusha en fil. **Kostnad:** filen är stor och växer.
Uppdelning i ES-moduler är medvetet uppskjuten tills UI-komplexiteten kräver det; ramverk
(React/Vite) ännu längre fram. Se `spec-mall.md` §13.

---

## Beslut som ännu inte är byggda

- **Telegram som notiskanal** för prislarm och viktiga händelser (valt, inte implementerat).
  Larmen måste utvärderas server-side — i motorn eller via Supabase `pg_cron` — eftersom de
  inte kan bero på en öppen flik.
