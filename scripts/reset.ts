#!/usr/bin/env node
/**
 * Löscht alle Job-Einträge von Firmen, die nicht (mehr) in der COMPANIES-Liste
 * stehen. Nützlich nachdem Firmen aus der Konfiguration entfernt wurden.
 *   npm run reset
 * Komplett-Reset (DB-Datei löschen): einfach db/jobs.db wegwerfen.
 */
import { getDb } from '../src/lib/db';
import { COMPANIES } from '../src/scrapers/companies';

const db = getDb();
const wanted = COMPANIES.map(c => c.name);
const placeholders = wanted.map(() => '?').join(',');
const before = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
const result = db.prepare(`DELETE FROM jobs WHERE company NOT IN (${placeholders})`).run(...wanted);
const after = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
db.prepare(`DELETE FROM scraper_status WHERE company NOT IN (${placeholders})`).run(...wanted);

console.log(`Jobs vorher: ${before.n}, nachher: ${after.n} (entfernt: ${result.changes})`);
console.log('Behaltene Firmen:', wanted.join(', '));
