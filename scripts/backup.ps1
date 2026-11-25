# =============================================================================
# NEXUS Monitor - Datensicherung (Windows PowerShell 5.1 / PowerShell 7)
#
# Sichert in EIN Archiv:
#   - .env (Konfiguration, enthaelt Geheimnisse)
#   - docker-compose.yml
#   - Datenbank (pg_dump im Custom-Format, inkl. TimescaleDB), falls sie laeuft
#   - Versionsinformationen
#
# Aufruf (im Projektordner):   .\scripts\backup.ps1
# Ergebnis:                    <NEXUS_BACKUP_DIR>\nexus-<zeitstempel>.tar.gz
#
# Gleiches Archivformat wie scripts/backup.sh - Sicherungen sind zwischen
# Windows und Linux austauschbar.
# =============================================================================
$ErrorActionPreference = 'Stop'
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

# Externe Befehle ausfuehren und bei Fehler abbrechen
function Invoke-Checked([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What fehlgeschlagen (Exit-Code $LASTEXITCODE)" }
}

$envVars = Read-DotEnv '.env'
$backupDir = Get-Setting $envVars 'NEXUS_BACKUP_DIR' './backups'
$keep = [int](Get-Setting $envVars 'NEXUS_BACKUP_KEEP' '14')
$dbName = Get-Setting $envVars 'POSTGRES_DB' 'nexus'
$dbUser = Get-Setting $envVars 'POSTGRES_USER' 'nexus'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw 'tar wurde nicht gefunden (in Windows 10/11 und Server 2019+ enthalten).'
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$work = Join-Path ([System.IO.Path]::GetTempPath()) "nexus-backup-$stamp"
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
    Write-Host "[backup] Starte Sicherung $stamp"

    # 1) Konfiguration
    if (Test-Path '.env') { Copy-Item '.env' (Join-Path $work 'env') }
    Copy-Item 'docker-compose.yml' (Join-Path $work 'docker-compose.yml')

    # 2) Datenbank (nur wenn der Dienst laeuft). Der Dump entsteht im Container
    #    und wird per "docker compose cp" kopiert - eine Umleitung mit ">" wuerde
    #    die Binaerdaten unter Windows PowerShell beschaedigen.
    $running = @(docker compose ps --status running --services 2>$null)
    if ($running -contains 'db') {
        Write-Host "[backup] Sichere Datenbank $dbName ..."
        $inContainer = "/tmp/nexus-backup-$stamp.dump"
        Invoke-Checked 'pg_dump' { docker compose exec -T db pg_dump -U $dbUser -d $dbName -Fc -f $inContainer }
        try {
            Invoke-Checked 'Kopieren des Dumps' { docker compose cp "db:$inContainer" (Join-Path $work 'database.dump') }
        } finally {
            docker compose exec -T db rm -f $inContainer | Out-Null
        }
    } else {
        Write-Host '[backup] Datenbankdienst laeuft nicht - nur Konfiguration wird gesichert.'
    }

    # 3) Metadaten (LF-Zeilenenden wie unter Linux)
    $info = "created=$stamp`nnexus_version=$(Get-Setting $envVars 'NEXUS_VERSION' 'latest')`nhost=$env:COMPUTERNAME`n"
    [System.IO.File]::WriteAllText((Join-Path $work 'BACKUP_INFO'), $info)

    $archive = Join-Path (Resolve-Path $backupDir) "nexus-$stamp.tar.gz"
    Invoke-Checked 'Archiv erstellen' { tar -czf $archive -C $work . }
    Write-Host "[backup] Fertig: $archive" -ForegroundColor Green
    Write-Host '[backup] Hinweis: Das Archiv enthaelt Passwoerter (.env) - geschuetzt aufbewahren.'
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

# 4) Alte Sicherungen entfernen
$old = Get-ChildItem -Path $backupDir -Filter 'nexus-*.tar.gz' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $keep
foreach ($f in $old) {
    Remove-Item -Force $f.FullName
    Write-Host "[backup] Alte Sicherung entfernt: $($f.Name)"
}
