# =============================================================================
# NEXUS Monitor - Wiederherstellung (Windows PowerShell 5.1 / PowerShell 7)
#
# Aufruf (im Projektordner):
#   .\scripts\restore.ps1 .\backups\nexus-<zeitstempel>.tar.gz
#
# Ablauf (wie scripts/restore.sh):
#   1. .env aus der Sicherung uebernehmen (bestehende .env wird umbenannt)
#   2. Datenbank starten, Backend anhalten, Datenbank neu anlegen
#   3. Mit TimescaleDB: Erweiterung anlegen, timescaledb_pre_restore()
#   4. Dump einspielen, timescaledb_post_restore()
#   5. Alle Dienste starten
# =============================================================================
param(
    [Parameter(Mandatory = $true)][string]$Archive,
    # Ohne Rueckfrage (z. B. fuer automatisierte Tests)
    [switch]$Force
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Archive)) { throw "Sicherung nicht gefunden: $Archive" }
$Archive = (Resolve-Path $Archive).Path
Set-Location (Split-Path -Parent $PSScriptRoot)

function Read-DotEnv([string]$Path) {
    $vars = @{}
    if (Test-Path $Path) {
        foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
                $vars[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
            }
        }
    }
    return $vars
}

function Get-Setting($Vars, [string]$Name, [string]$Default) {
    if ($Vars.ContainsKey($Name) -and $Vars[$Name]) { return $Vars[$Name] }
    return $Default
}

function Invoke-Checked([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What fehlgeschlagen (Exit-Code $LASTEXITCODE)" }
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("nexus-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
    Invoke-Checked 'Archiv entpacken' { tar -xzf $Archive -C $work }
    $infoFile = Join-Path $work 'BACKUP_INFO'
    $created = if (Test-Path $infoFile) { (Get-Content $infoFile | Where-Object { $_ -like 'created=*' }) } else { 'unbekannt' }
    Write-Host "[restore] Sicherung: $created"

    if (-not $Force) {
        $answer = Read-Host 'Bestehende Daten dieser Installation werden ueberschrieben. Fortfahren? [j/N]'
        if ($answer -notmatch '^[jJyY]$') { Write-Host 'Abgebrochen.'; exit 1 }
    }

    # 1) Konfiguration
    $envBackup = Join-Path $work 'env'
    if (Test-Path $envBackup) {
        if (Test-Path '.env') { Rename-Item '.env' (".env.vor-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
        Copy-Item $envBackup '.env'
        Write-Host '[restore] .env uebernommen'
    }
    $envVars = Read-DotEnv '.env'
    $db = Get-Setting $envVars 'POSTGRES_DB' 'nexus'
    $u = Get-Setting $envVars 'POSTGRES_USER' 'nexus'

    $dump = Join-Path $work 'database.dump'
    if (Test-Path $dump) {
        Write-Host '[restore] Starte Datenbank ...'
        Invoke-Checked 'Datenbank starten' { docker compose --profile backend up -d db }
        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            docker compose exec -T db pg_isready -U $u -d postgres *> $null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            Start-Sleep -Seconds 2
        }
        if (-not $ready) { throw 'Datenbank wurde nicht bereit (pg_isready).' }

        # 2) Backend anhalten, damit niemand waehrend der Wiederherstellung schreibt
        docker compose stop backend *> $null

        Write-Host "[restore] Lege Datenbank $db neu an ..."
        Invoke-Checked 'dropdb' { docker compose exec -T db dropdb -U $u --if-exists --force $db }
        Invoke-Checked 'createdb' { docker compose exec -T db createdb -U $u -O $u $db }

        # 3) TimescaleDB vorbereiten (falls auf dem Server vorhanden)
        $tsdb = (docker compose exec -T db psql -U $u -d $db -tAc "SELECT count(*) FROM pg_available_extensions WHERE name = 'timescaledb'" | Out-String).Trim()
        if ($tsdb -eq '1') {
            Invoke-Checked 'TimescaleDB vorbereiten' {
                docker compose exec -T db psql -U $u -d $db -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;' -c 'SELECT timescaledb_pre_restore();'
            }
        }

        # 4) Dump in den Container kopieren und dort einspielen (keine Umleitung von Binaerdaten)
        Write-Host '[restore] Spiele Datenbank ein ...'
        $inContainer = '/tmp/nexus-restore.dump'
        Invoke-Checked 'Kopieren des Dumps' { docker compose cp $dump "db:$inContainer" }
        try {
            docker compose exec -T db pg_restore -U $u -d $db --no-owner $inContainer
            if ($LASTEXITCODE -ne 0) {
                Write-Warning '[restore] pg_restore meldete Fehler (Ausgabe oben pruefen).'
            }
        } finally {
            docker compose exec -T db rm -f $inContainer *> $null
        }

        if ($tsdb -eq '1') {
            Invoke-Checked 'TimescaleDB abschliessen' {
                docker compose exec -T db psql -U $u -d $db -v ON_ERROR_STOP=1 -q -c 'SELECT timescaledb_post_restore();'
            }
        }
        Invoke-Checked 'Dienste starten' { docker compose --profile backend up -d }
    } else {
        Write-Host '[restore] Sicherung enthaelt keine Datenbank - starte Dienste.'
        Invoke-Checked 'Dienste starten' { docker compose up -d }
    }
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Host '[restore] Fertig. Status:' -ForegroundColor Green
docker compose ps
