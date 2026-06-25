@echo off
REM ============================================================
REM  Job Tracker München – Doppelklick-Starter
REM  Setzt Abhängigkeiten beim ersten Lauf, startet die UI und
REM  öffnet den Browser.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === Job Tracker München ===
echo.

REM --- Node-Check ----------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] Node.js ist nicht installiert.
  echo Bitte einmalig von https://nodejs.org installieren (LTS).
  echo.
  pause
  exit /b 1
)

REM --- Erstinstallation ----------------------------------------
if not exist node_modules (
  echo [1/3] Installiere Abhaengigkeiten ^(einmalig, ca. 30 Sek.^) ...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [FEHLER] npm install ist fehlgeschlagen.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Abhaengigkeiten OK.
)

REM --- Erst-Scrape, falls DB leer ------------------------------
if not exist db\jobs.db (
  echo [2/3] Erster Import ^(kann 1-2 Min. dauern^) ...
  call npm run scrape
) else (
  echo [2/3] DB vorhanden ^(npm run scrape fuer Aktualisierung^).
)

REM --- Browser oeffnen ----------------------------------------
echo [3/3] Starte Server auf http://localhost:3000/jobs
start "" "http://localhost:3000/jobs"

REM --- Dev-Server (laeuft im Vordergrund, Strg+C zum Stoppen) -
call npm run dev

endlocal
