#!/usr/bin/env node
/**
 * Setzt description_raw, tasks und qualifications auf NULL für alle
 * jobs-Zeilen. Detail-Seite zeigt danach wieder "— nicht automatisch
 * extrahiert —" statt extrahierter Inhalte.
 *   npm run clear-enrichment
 */
import { getDb } from '../src/lib/db';

const db = getDb();
const before = db
  .prepare(
    `SELECT
       SUM(CASE WHEN description_raw IS NOT NULL THEN 1 ELSE 0 END) AS d,
       SUM(CASE WHEN tasks IS NOT NULL THEN 1 ELSE 0 END) AS t,
       SUM(CASE WHEN qualifications IS NOT NULL THEN 1 ELSE 0 END) AS q
     FROM jobs`,
  )
  .get() as { d: number; t: number; q: number };

const res = db
  .prepare(`UPDATE jobs SET description_raw = NULL, tasks = NULL, qualifications = NULL`)
  .run();

console.log(`Vorher belegt: description_raw=${before.d}, tasks=${before.t}, qualifications=${before.q}`);
console.log(`UPDATE: ${res.changes} Zeilen zurückgesetzt.`);
