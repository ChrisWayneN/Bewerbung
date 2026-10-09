# Legt Verknüpfungen mit dem Job-Tracker-Logo an – im Projektordner und auf dem
# Desktop – und räumt alte Debug-Ausgaben in den Ordner debug\.
# Aufruf über launcher\verknuepfungen-erstellen.bat (einmalig, und erneut, falls
# der Projektordner verschoben wurde).
$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$icon    = Join-Path $PSScriptRoot 'job-tracker.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$shell   = New-Object -ComObject WScript.Shell

$links = @(
  @{ Name = 'Job Tracker München'; Bat = 'start-tracker.bat'; Desc = 'Startet den lokalen Job-Tracker-Server und öffnet den Browser' },
  @{ Name = 'Jobs scrapen';        Bat = 'scrape-jobs.bat';   Desc = 'Holt neue Stellen von allen Firmen in die Datenbank' }
)
foreach ($l in $links) {
  foreach ($dir in @($root, $desktop)) {
    $path = Join-Path $dir ($l.Name + '.lnk')
    $lnk = $shell.CreateShortcut($path)
    # Über cmd.exe statt direkt auf die .bat – so lässt sich die Verknüpfung
    # auch an die Taskleiste bzw. ins Startmenü anheften.
    $lnk.TargetPath       = $env:ComSpec
    $lnk.Arguments        = '/c "' + (Join-Path $PSScriptRoot $l.Bat) + '"'
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation     = "$icon,0"
    $lnk.Description      = $l.Desc
    $lnk.Save()
    Write-Host "  angelegt: $path"
  }
}

# Alte Debug-Ausgaben (z.B. knds-debug.txt) aus dem Projektordner nach debug\ verschieben.
$debug = Join-Path $root 'debug'
New-Item -ItemType Directory -Force $debug | Out-Null
$old = Get-ChildItem $root -File | Where-Object { $_.Name -match '-debug\.txt$|^helsing.*\.(html?|json)$' }
foreach ($f in $old) {
  Move-Item $f.FullName -Destination $debug -Force
  Write-Host "  verschoben nach debug\: $($f.Name)"
}
