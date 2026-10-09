@echo off
REM ============================================================
REM  Einmalig ausfuehren (Doppelklick):
REM  Legt "Job Tracker Muenchen" und "Jobs scrapen" als
REM  Verknuepfungen mit Logo an - im Projektordner und auf dem
REM  Desktop - und verschiebt alte Debug-Dateien nach debug\.
REM  Nach dem Verschieben des Projektordners erneut ausfuehren.
REM ============================================================
echo Lege Verknuepfungen an...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verknuepfungen-erstellen.ps1"
if errorlevel 1 (
    echo.
    echo FEHLER beim Anlegen der Verknuepfungen - Meldung oben pruefen.
) else (
    echo.
    echo Fertig. Ab jetzt "Job Tracker Muenchen" doppelklicken.
)
pause
