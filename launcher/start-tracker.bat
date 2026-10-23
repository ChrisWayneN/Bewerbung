@echo off
REM ============================================================
REM  Job-Tracker starten
REM  Doppelklick holt zuerst neue Stellen (scrapen), startet dann
REM  den lokalen Web-Server und oeffnet den Browser auf
REM  http://localhost:3000
REM  Zum Beenden das separate Server-Fenster schliessen.
REM ============================================================
REM Liegt in launcher\ - Projektordner ist eine Ebene hoeher.
cd /d "%~dp0.."

REM -- Abhaengigkeiten pruefen (nur beim allerersten Start noetig) --
if not exist "node_modules" (
    echo Erste Einrichtung: installiere Abhaengigkeiten, das dauert einmalig ein paar Minuten...
    call npm install
    if errorlevel 1 (
        echo.
        echo FEHLER bei "npm install". Bitte Meldung oben pruefen.
        pause
        exit /b 1
    )
)

REM -- Vorher neue Stellen holen. Uebersprungen, wenn der letzte Lauf
REM    (z.B. der taegliche automatische) weniger als 2 Stunden her ist.
REM    Fehler einzelner Firmen halten den Start nicht auf.
echo Hole neue Stellen von allen Firmen (dauert ein paar Minuten)...
echo.
call npm run scrape -- --skip-if-recent 120
echo.

echo Starte Job-Tracker Web-Server...
REM Server laeuft in eigenem Fenster weiter (cmd /k haelt es offen).
start "Job-Tracker Server" cmd /k "npm run dev"

echo Warte auf Server-Start...
timeout /t 6 /nobreak >nul

echo Oeffne Browser: http://localhost:3000
start "" "http://localhost:3000"

echo.
echo Fertig. Der Server laeuft im Fenster "Job-Tracker Server".
echo Dieses Fenster kann geschlossen werden - der Server bleibt an.
timeout /t 4 /nobreak >nul
