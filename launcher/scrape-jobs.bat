@echo off
REM ============================================================
REM  Jobs scrapen
REM  Doppelklick holt neue Stellen von allen Portalen und
REM  schreibt sie in die Datenbank. Braucht Internet.
REM  Danach im Tracker (localhost:3000) neu laden.
REM  "scrape-jobs.bat /auto" = ohne Fenster-Pause, Protokoll in
REM  debug\scrape-letzter-lauf.txt (fuer den taeglichen Lauf).
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

REM -- Stiller Modus fuer den taeglichen automatischen Lauf (Aufgabenplanung):
REM    Ausgabe in debug\scrape-letzter-lauf.txt, Fenster schliesst sich selbst.
if /i "%~1"=="/auto" (
    if not exist "debug" mkdir "debug"
    echo Automatischer Lauf %date% %time% > "debug\scrape-letzter-lauf.txt"
    call npm run scrape >> "debug\scrape-letzter-lauf.txt" 2>&1
    exit /b 0
)

echo Starte Scraping aller Firmen...
echo.
call npm run scrape

echo.
echo ============================================================
echo Scraping abgeschlossen. Im Browser (localhost:3000) neu laden.
echo ============================================================
pause
