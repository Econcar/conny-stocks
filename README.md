# conny-stocks — lokal körning

Detta repo innehåller en statisk frontend (`index.html`) och en liten Express-proxy (`server.js`) som vidarebefordrar anrop till Anthropic/Claude.

I drift ligger appen på **Cloudflare Pages** (https://conny-stocks.pages.dev) och proxyerna körs som Pages Functions i `functions/api/`. `server.js` är motsvarigheten för lokal körning — samma `/api/*`-vägar.

Snabbstart lokalt

1. Installera beroenden:

```bash
npm install
```

2. Sätt din Claude API-nyckel i miljön (PowerShell exempel):

```powershell
$env:CLAUDE_API_KEY = "din_claude_api_key"
npm start
```

Eller permanent (Windows):

```powershell
setx CLAUDE_API_KEY "din_claude_api_key"
# starta om terminal
npm start
```

Frontend anropar nu `/api/claude` som proxas av `server.js`. Nyckeln hålls på servern och skickas aldrig från klienten.

Hantera modeller

Du kan konfigurera vilka Anthropic-modeller som ska vara tillgängliga i frontend genom miljövariabler.

- `CLAUDE_ALLOWED_MODELS` — kommaseparerad lista över modellnamn, t.ex. `claude-2,claude-sonnet-4-6`.
- `CLAUDE_DEFAULT_MODEL` — (valfritt) default-modell om ingen anges.

Exempel (PowerShell, temporärt för session):

```powershell
$env:CLAUDE_ALLOWED_MODELS = "claude-2,claude-sonnet-4-6"
$env:CLAUDE_DEFAULT_MODEL = "claude-2"
npm start
```

Frontend hämtar listan via `GET /api/models` och visar en dropdown i AI-panelen. Servern validerar att den modell klienten begär finns i `CLAUDE_ALLOWED_MODELS` innan anrop till Anthropic görs.

Säkerhetsnoter

- Lagra aldrig API-nycklar i repository.
- Begränsa åtkomst och implementera rate-limiting vid produktion.
- I produktion ligger Claude-nyckeln som miljövariabel i Cloudflare Pages, inte i repot.
