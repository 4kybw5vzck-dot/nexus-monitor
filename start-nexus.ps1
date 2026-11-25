# NEXUS Monitor – Start unter Windows mit Docker Desktop
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
docker compose ps
Write-Host ""
Write-Host "NEXUS Monitor: http://localhost:$port" -ForegroundColor Green
Start-Process "http://localhost:$port"
