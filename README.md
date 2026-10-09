# Job-Scraper München

Job-Tracking-Tool für 21 Firmen im Großraum München (30-km-Radius).

## Stack

- **Next.js 15** (App Router) + **Tailwind CSS**
- **better-sqlite3** mit **FTS5** für Volltextsuche
- **cheerio** + **Playwright** (optional, für JS-lastige Seiten)
- Scraper in TypeScript, ausführbar via `tsx`

## Setup

### Variante A – Doppelklick (Windows)

1. [Node.js LTS](https://nodejs.org) installieren (einmalig).
2. **`launcher\verknuepfungen-erstellen.bat` doppelklicken** (einmalig) – legt
   „Job Tracker München“ und „Jobs scrapen“ mit Logo im Projektordner und auf dem
   Desktop an. Nach dem Verschieben des Projektordners erneut ausführen.
3. **„Job Tracker München“** startet den lokalen Server und öffnet den Browser.
   **„Jobs scrapen“** holt neue Stellen (danach im Browser neu laden).

### Variante B – Kommandozeile

```bash
npm install
npm run scrape    # initialer Import (~1–2 Minuten)
npm run dev       # UI auf http://localhost:3000/jobs
```

`db/jobs.db` wird beim ersten Start automatisch angelegt und ist **bewusst eingecheckt**, damit die History zwischen Sessions erhalten bleibt.

## CLI-Optionen

```bash
npm run scrape                       # alle 14 Firmen
npm run scrape -- --only Airbus      # nur Airbus
npm run scrape -- --only Hensoldt,Airbus,IABG
npm run scrape -- --concurrency 2    # langsam-und-sicher
npm run scrape -- --no-enrich        # ohne Laden von Aufgaben/Profil (schneller)
npm run reset                        # entfernt Einträge alter Firmen aus der DB
```

## Aufgaben & Profil (Detail-Anreicherung)

Am Ende von `npm run scrape` wird für jede Stelle, bei der Aufgaben/Profil noch
fehlen, die Stellenseite geöffnet und beides extrahiert (Quelle: JSON-LD-JobPosting,
sonst typische Beschreibungs-Container). Jede Stelle wird nur einmal erfolgreich
geladen; Fehlschläge werden max. 3× wiederholt. Die Ausgabe zeigt pro Firma, wie
viele Stellen vollständig/teilweise/gar nicht extrahiert wurden.

```bash
npm run enrich                       # nur fehlende Stellen
npm run enrich -- --only Hensoldt    # nur eine Firma
npm run enrich -- --force            # alle Seiten neu laden
npm run enrich -- --report           # Diagnose: unvollständige Stellen + erkannte Überschriften
npm run enrich -- --reextract        # gespeicherte Beschreibungen mit neuen Regeln neu zerlegen (offline)
npm run clear-enrichment             # alle extrahierten Inhalte löschen
npm run inspect-knds -- Leopard       # KNDS: alle API-Felder einer Stelle anzeigen (Diagnose)
```

Stellen, die nicht mehr ausgeschrieben sind (404, „position has been filled“, nicht mehr in
der Firmenliste), werden erkannt und übersprungen; Detailseite und Report nennen den Grund.

Reine Vorlagen-Platzhalter („Lorem Ipsum“) zählen nicht als Beschreibung; `--reextract` setzt
solche Stellen zurück, damit `npm run enrich` sie neu lädt.

Ablauf bei „teilweise“: `--report` zeigt unbekannte Überschriften als `[?]` →
Muster in `extract.ts` ergänzen → `--reextract` (lädt nichts nach).

Neue Überschriften-Varianten einer Firma (z.B. „Your boarding pass“ bei Airbus)
werden in `src/scrapers/extract.ts` in `TASK_PATTERNS` / `QUAL_PATTERNS` /
`STOP_PATTERNS` ergänzt.

## Aktualisierungs-Workflow nach Code-Update

```bash
git pull                # neue Scraper-Konfiguration ziehen
npm install             # nur nötig falls package.json sich änderte
npm run reset           # alte Firmen-Einträge aus DB entfernen
npm run scrape          # frischer Import
# Browser-Tab neu laden – fertig
```

Komplett-Reset (DB plattmachen):
```bash
# Windows
del db\jobs.db && npm run scrape
# Linux/macOS
rm db/jobs.db && npm run scrape
```

## UI

| Pfad | Funktion |
|---|---|
| `/jobs` | Hauptliste mit Volltext-Suche, Firma-Filter, „Nur Neue", „Inkl. Ausgeblendete", Hide-Button |
| `/jobs/[id]` | Detailansicht: Aufgaben + Qualifikationen, Original-Link, Hide |
| `/jobs/status` | Scraper-Status pro Firma (✅ / ⚠️ / ❌) |
| `/api/jobs` | JSON: alle Stellen |
| `/api/jobs/[id]/hide` | POST: Hide-Toggle |

## Ordner im Projekt

| Ordner/Datei | Inhalt |
|---|---|
| `launcher/` | Doppelklick-Starter (`start-tracker.bat`, `scrape-jobs.bat`), Logo und Skript für die Verknüpfungen |
| `src/` | Quellcode: Web-Oberfläche (`src/app`), Datenbank-Zugriff (`src/lib`), Scraper je Firma (`src/scrapers`), Blacklist (`src/config`) |
| `scripts/` | Kommandozeilen-Befehle hinter `npm run …` (scrape, enrich, inspect-…) |
| `db/` | Datenbank `jobs.db` mit allen Stellen, Status und Bewertungen + Tabellen-Definition `schema.sql` |
| `debug/` | Ablage für Diagnose-Ausgaben (wird nicht ins Git übernommen) |
| `node_modules/` | Installierte Bibliotheken (von `npm install`, nie von Hand ändern) |
| `.next/` | Zwischenspeicher des Web-Servers (wird automatisch erzeugt, darf gelöscht werden) |
| `package.json`, `package-lock.json` | Projektname, `npm run`-Befehle, Bibliotheken mit Versionen |
| `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `next-env.d.ts` | Einstellungen für TypeScript, Next.js und das Styling – müssen im Hauptordner liegen, dort suchen die Werkzeuge sie |

## Architektur

```
src/
├── app/
│   ├── jobs/                        # UI (Liste, Detail, Status)
│   └── api/jobs/[id]/hide/          # Hide-Toggle
├── lib/db.ts                        # SQLite + FTS5 + Upsert
└── scrapers/
    ├── base.ts                      # München-Whitelist, fetch helpers, hashJob
    ├── extract.ts                   # Aufgaben/Qualifikation aus HTML/Text
    ├── enrich.ts                    # Detail-Anreicherung: Stellenseiten laden + extrahieren
    ├── companies.ts                 # 21 Module + Registry
    ├── runAll.ts                    # Orchestrator
    └── portals/
        ├── ashby.ts                 # Ashby Job-Board (GraphQL + Posting-API)
        ├── workday.ts               # Workday CXS JSON
        ├── personio.ts              # Personio XML-Feed
        └── successfactors.ts        # SAP SF HTML-Parser
db/
├── schema.sql
└── jobs.db                          # committet
scripts/scrape.ts                    # CLI
```

## Firmen-Status (13 Zielunternehmen)

| Status | Firma | Portal | Endpoint |
|---|---|---|---|
| ✅ | Airbus | Workday | `ag.wd3.myworkdayjobs.com/Airbus` |
| ✅ | Hensoldt | Workday | `hensoldt.wd3.myworkdayjobs.com/External_Career_Site` |
| ✅ | Agile Robots SE | Personio | `agile-robots-se.jobs.personio.de` |
| ✅ | Franka Robotics | Personio | `franka-robotics.jobs.personio.de` |
| ✅ | RobCo | Ashby | `jobs.ashbyhq.com/robco` – Filter Engineering + München per Abteilungs-/Standort-ID aus der rob.co-Karriere-URL |
| ✅ | Siemens | Phenom People | `jobs.siemens.com/api/jobs` |
| ✅ | IABG | Engage-Servlet | `jobboerse.iabg.de/engage/jobexchange/` (HQ Ottobrunn) |
| ✅ | KNDS | SAP SF CSB | `jobs.knds.de/content/search/` |
| ✅ | Infineon | Eightfold AI | `jobs.infineon.com/api/apply/v2/jobs` |
| ⚠️ | Quantum Systems | Personio→HTML | versucht Personio-Slug `quantum-systems`, fällt auf `career.quantum-systems.com` zurück |
| ⚠️ | Neura Robotics | talentsconnect | `jobs.neura-robotics.com/search` |
| ⚠️ | Rohde & Schwarz | HTML | `rohde-schwarz.com` (AEM, kein offenes JSON) |
| ⚠️ | Diehl | HTML | `diehl.com/career/de/jobs-bewerbung/stellenboerse/` |
| ⚠️ | MTU | HTML | `mtu.de/careers/online-job-market` |

⚠️-Scraper: bei Misserfolg wird automatisch ein „link-only"-Eintrag erzeugt, damit die Firma sichtbar bleibt.

## „Neu seit letztem Import"

Logik in `src/lib/db.ts`:

```ts
first_seen > (SELECT run_at FROM imports ORDER BY id DESC LIMIT 1 OFFSET 1)
```

Beim allerersten Import gibt es kein „vorher", also gilt alles als neu. Ab dem zweiten Import wird gegen den vorherigen Lauf verglichen.

## Hide-Button

Setzt `hidden = 1` in der DB. Stelle bleibt erhalten, taucht in Listenansicht nicht mehr auf. Bei späteren Imports wird sie nicht erneut als „neu" gezeigt (`first_seen` bleibt). Über „Inkl. Ausgeblendete" wieder einblendbar.

## Erweitern

Neue Firma: in `src/scrapers/companies.ts` zur `COMPANIES`-Liste und ggf. ein scraper hinzufügen, dann in `scrapers`-Array eintragen.
