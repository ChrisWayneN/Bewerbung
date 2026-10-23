@echo off
REM Entfernt den taeglichen automatischen Scrape-Lauf wieder.
schtasks /delete /tn "Job-Scraper Muenchen" /f
pause
