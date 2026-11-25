# NEXUS Monitor - Start unter Windows mit Docker Desktop
# Aufruf in PowerShell im Projektordner:   .\start-nexus.ps1
# Falls Skripte blockiert sind, einmalig:  Set-ExecutionPolicy -Scope Process Bypass

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host 'Docker wurde nicht gefunden. Bitte Docker Desktop installieren und starten.' -ForegroundColor Red
    exit 1
}

try { docker info *> $null } catch {}
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker läuft nicht. Bitte Docker Desktop starten und warten, bis "Engine running" angezeigt wird.' -ForegroundColor Red
    exit 1
}

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host '.env aus Vorlage angelegt.' -ForegroundColor Yellow
}

# Fehlende Schluessel fuer den Backend-Betrieb zufaellig erzeugen (nur wenn leer)
function New-RandomSecret([int]$Length = 40) {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
$envText = Get-Content -Path .env -Raw -Encoding UTF8
if ($envText -match '(?m)^COMPOSE_PROFILES=.*backend') {
    $changed = $false
    foreach ($key in 'NEXUS_SECRET_KEY', 'NEXUS_COLLECTOR_TOKEN') {
        if ($envText -match "(?m)^$key=\s*$") {
            $envText = $envText -replace "(?m)^$key=\s*$", "$key=$(New-RandomSecret)"
            $changed = $true
            Write-Host "$key wurde erzeugt und in .env eingetragen." -ForegroundColor Yellow
        } elseif ($envText -notmatch "(?m)^$key=") {
            $envText = $envText.TrimEnd() + "`n$key=$(New-RandomSecret)`n"
            $changed = $true
            Write-Host "$key wurde erzeugt und in .env eingetragen." -ForegroundColor Yellow
        }
    }
    if ($changed) { [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot '.env'), $envText) }
    if ($envText -match '(?m)^POSTGRES_PASSWORD=\s*$') {
        Write-Host 'POSTGRES_PASSWORD ist leer - bitte in .env ein langes, zufaelliges Passwort eintragen.' -ForegroundColor Red
        exit 1
    }
}

$port = (Select-String -Path .env -Pattern '^NEXUS_HTTP_PORT=(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }) | Select-Object -First 1
if (-not $port) { $port = 8080 }

Write-Host 'Baue und starte NEXUS Monitor (beim ersten Mal einige Minuten) ...' -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Warte auf Healthcheck ...'
for ($i = 0; $i -lt 30; $i++) {
    $state = docker compose ps --format '{{.Health}}' frontend 2>$null
    if ($state -eq 'healthy') { break }
    Start-Sleep -Seconds 2
}
$profiles = (Select-String -Path .env -Pattern '^COMPOSE_PROFILES=(.*)$' | ForEach-Object { $_.Matches[0].Groups[1].Value }) | Select-Object -First 1
if ($profiles -match 'backend') {
    Write-Host 'Warte auf Backend und Datenbank (erster Start mit Migration ca. 1 Minute) ...'
    for ($i = 0; $i -lt 60; $i++) {
        $state = docker compose ps --format '{{.Health}}' backend 2>$null
        if ($state -eq 'healthy') { break }
        Start-Sleep -Seconds 2
    }
    $generated = docker compose logs backend 2>$null | Select-String 'Erzeugtes Passwort' | Select-Object -Last 1
    if ($generated) {
        Write-Host ''
        Write-Host 'Erstanmeldung - vom Backend erzeugtes Administratorkonto:' -ForegroundColor Yellow
        Write-Host ($generated.Line -replace '^.*Administratorkonto', 'Administratorkonto')
    }
}

docker compose ps
Write-Host ""
Write-Host "NEXUS Monitor: http://localhost:$port" -ForegroundColor Green
Start-Process "http://localhost:$port"
