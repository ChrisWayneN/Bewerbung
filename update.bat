@echo off
REM Aktualisiert die Job-DB (laeuft alle 21 Scraper, ~1-2 Min).
setlocal
cd /d "%~dp0"
echo === Job-Update ===
call npm run scrape
echo.
echo Fertig. Druecke eine Taste zum Schliessen.
pause >nul
endlocal
