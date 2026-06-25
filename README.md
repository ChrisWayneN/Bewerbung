# Bewerbung – Job Tracker München

Job-Tracking-Tool für 21 Firmen im Großraum München (30-km-Radius).

## Stack

- **Next.js 15** (App Router) + **Tailwind CSS**
- **better-sqlite3** mit **FTS5** für Volltextsuche
- **cheerio** + **Playwright** (optional, für JS-lastige Seiten)
- Scraper in TypeScript, ausführbar via `tsx`

## Setup

```bash
npm install
npm run scrape    # initialer Import (~1–2 Minuten)
npm run dev       # UI auf http://localhost:3000/jobs
```

`db/jobs.db` wird beim ersten Start automatisch angelegt und ist **bewusst eingecheckt**, damit die History zwischen Sessions erhalten bleibt.

## CLI-Optionen

```bash
npm run scrape                       # alle 21 Firmen
npm run scrape -- --only Airbus      # nur Airbus
npm run scrape -- --only Personio    # alle die "personio" matchen
npm run scrape -- --concurrency 2    # langsam-und-sicher
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

## Firmen-Status (Phase 1)

| Status | Firma | Portal | Notiz |
|---|---|---|---|
| ✅ | Airbus | Workday | `ag.wd3.myworkdayjobs.com/Airbus` |
| ✅ | Quantum Systems | Personio | |
| ✅ | Franka Robotics | Personio | |
| ✅ | Synaos | Personio | meist Hannover, manchmal München |
| ✅ | Neura Robotics | Personio | meist BW, prüfen |
| ✅ | IABG | HTML | Ottobrunn |
| ✅ | Siemens | Phenom People JSON | |
| ⚠️ | Infineon | Workday | Tenant-Variante prüfen |
| ⚠️ | Hensoldt | Workday | |
| ⚠️ | MTU | SuccessFactors | HTML-Fallback |
| ⚠️ | MAN | SuccessFactors | HTML-Fallback |
| ⚠️ | Diehl | SuccessFactors | HTML-Fallback |
| ⚠️ | Magazino | Personio | evtl. eingestellt seit Jungheinrich |
| ⚠️ | Agile Robots SE | Personio | Slug `agilerobots` |
| ⚠️ | Rohde & Schwarz | HTML-Fallback | JSON-Endpoint instabil |
| ❌ | KNDS | — | Karriereportal benötigt JS-Rendering |
| ❌ | Atlas Robotics | — | sehr klein |
| ❌ | Locus Robotics | — | US-Firma, kein DE-Büro München |
| ❌ | Keenon Robotics | — | EU-HQ Düsseldorf |
| ❌ | Faulhaber | — | HQ Schönaich BW |
| ❌ | Dreher Automation | — | klein, kein Online-Portal |

❌-Firmen werden trotzdem in der DB geführt – als „link-only"-Eintrag, der zur Karriereseite zeigt.

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
