# Bewerbung – Job Tracker München

Job-Tracking-Tool für 21 Firmen im Großraum München (30-km-Radius).

## Stack

- **Next.js 15** (App Router) + **Tailwind CSS**
- **better-sqlite3** mit **FTS5** für Volltextsuche
- **cheerio** + **Playwright** (optional, für JS-lastige Seiten)
- Scraper in TypeScript, ausführbar via `tsx`

## Setup

### Variante A – Doppelklick (Windows)

1. [Node.js LTS](https://nodejs.org) installieren (einmalig).
2. **`start.bat` doppelklicken** – installiert beim ersten Lauf alles, scrapt, öffnet den Browser.
3. Später: `update.bat` doppelklicken für neuen Job-Import.

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
npm run reset                        # entfernt Einträge alter Firmen aus der DB
```

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
    ├── companies.ts                 # 21 Module + Registry
    ├── runAll.ts                    # Orchestrator
    └── portals/
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
