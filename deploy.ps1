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

# Versionsnummer = antal commits efter denna. Visas i appens sidomeny, och appen visar
# "Ny version finns - Ladda om" nar servern har ett hogre nummer an sidan som ar oppen.
$version = [int](git rev-list --count HEAD) + 1
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$versionJs = "// Skrivs av deploy.ps1 vid varje deploy - andra inte for hand. Visas i sidomenyn, och`n" +
             "// init.js jamfor med servern for att visa `"ny version finns`".`n" +
             "const APP_VERSION = { number: $version, date: `"$stamp`" };`n"
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot "js/version.js"), $versionJs, (New-Object System.Text.UTF8Encoding $false))
git add js/version.js

Write-Host "Skapar commit (version $version): $Message" -ForegroundColor Cyan
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit misslyckades - inget pushat. (Dubbla citattecken i meddelandet?)" -ForegroundColor Red
    exit 1
}

Write-Host "Laddar upp till GitHub (Cloudflare Pages deployar automatiskt)..." -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push misslyckades - commiten finns bara lokalt." -ForegroundColor Red
    exit 1
}

Write-Host "Klart! Version $version ($stamp) syns i sidomenyn pa https://conny-stocks.pages.dev om ca 1 minut." -ForegroundColor Green
