@echo off
REM ============================================================
REM  Einmalig ausfuehren (Doppelklick):
REM  Richtet in der Windows-Aufgabenplanung einen taeglichen
REM  Scrape-Lauf um 07:45 Uhr ein. Andere Uhrzeit: unten die
REM  Zahl hinter -Uhrzeit aendern und erneut ausfuehren.
REM  Wieder entfernen: taeglich-scrapen-entfernen.bat
REM ============================================================
echo Richte taeglichen Scrape-Lauf ein...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0taeglich-scrapen-einrichten.ps1" -Uhrzeit 07:45
if errorlevel 1 (
    echo.
    echo FEHLER beim Einrichten - Meldung oben pruefen.
) else (
    echo.
    echo Fertig. Zu sehen unter Start - "Aufgabenplanung" - "Job-Scraper Muenchen".
)
pause
