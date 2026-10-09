@echo off
REM ============================================================
REM  Jobs scrapen
REM  Doppelklick holt neue Stellen von allen Portalen und
REM  schreibt sie in die Datenbank. Braucht Internet.
REM  Danach im Tracker (localhost:3000) neu laden.
REM ============================================================
REM Liegt in launcher\ - Projektordner ist eine Ebene hoeher.
cd /d "%~dp0.."

if not exist "node_modules" (
    echo Erste Einrichtung: installiere Abhaengigkeiten...
    call npm install
    if errorlevel 1 (
        echo FEHLER bei "npm install".
        pause
        exit /b 1
    )
)

echo Starte Scraping aller Firmen...
echo.
call npm run scrape

echo.
echo ============================================================
echo Scraping abgeschlossen. Im Browser (localhost:3000) neu laden.
echo ============================================================
pause
