# Richtet in der Windows-Aufgabenplanung einen täglichen Scrape-Lauf ein
# (Aufgabe "Job-Scraper Muenchen"). Aufruf über taeglich-scrapen-einrichten.bat.
#   - läuft jeden Tag zur unten eingestellten Uhrzeit, nur wenn du angemeldet bist
#     (dafür ist kein Passwort nötig)
#   - war der Rechner um die Uhrzeit aus, wird der Lauf nachgeholt, sobald er wieder an ist
#   - Protokoll des letzten Laufs: debug\scrape-letzter-lauf.txt
# Erneut ausführen ändert die Uhrzeit bzw. den Pfad (nach dem Verschieben des Ordners).
param([string]$Uhrzeit = '07:45')
$ErrorActionPreference = 'Stop'
$name = 'Job-Scraper Muenchen'
$bat  = Join-Path $PSScriptRoot 'scrape-jobs.bat'
$root = Split-Path -Parent $PSScriptRoot

# Minimiertes Fenster, damit der Lauf nicht mitten in die Arbeit springt. Über
# "cmd /c", damit sich das Fenster nach dem Lauf von selbst schließt.
$action   = New-ScheduledTaskAction -Execute $env:ComSpec -Argument ('/c start "Jobs scrapen" /min "' + $env:ComSpec + '" /c ""' + $bat + '" /auto"') -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -Daily -At $Uhrzeit
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Holt täglich neue Stellen für den Job-Tracker München' -Force | Out-Null

Write-Host "  Aufgabe '$name' eingerichtet: täglich um $Uhrzeit Uhr."
Write-Host "  Protokoll des letzten Laufs: $root\debug\scrape-letzter-lauf.txt"
