# Deploy-skript: lägger till alla ändringar, commit och push i ett steg.
# Användning:  ./deploy.ps1            (använder standardmeddelande)
#              ./deploy.ps1 "min text" (eget commit-meddelande)

param(
    [string]$Message = "Uppdatering"
)

# Pre-deploy-kontroll: syntax + enhetstester. Avbryter push om nagot fallerar.
Write-Host "Kor kontroller (node verify.mjs)..." -ForegroundColor Cyan
node verify.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Kontrollerna misslyckades - deploy avbruten. Inget pushat." -ForegroundColor Red
    exit 1
}

Write-Host "Lagar till andringar..." -ForegroundColor Cyan
git add -A

# Avbryt om det inte finns nagot att committa
if (-not (git status --porcelain)) {
    Write-Host "Inga andringar att ladda upp." -ForegroundColor Yellow
    exit 0
}

Write-Host "Skapar commit: $Message" -ForegroundColor Cyan
git commit -m $Message

Write-Host "Laddar upp till GitHub (Cloudflare Pages deployar automatiskt)..." -ForegroundColor Cyan
git push

Write-Host "Klart! Sidan uppdateras pa https://conny-stocks.pages.dev om ca 1 minut." -ForegroundColor Green
