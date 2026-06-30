#!/usr/bin/env node
/**
 * Setzt alle status='abgelehnt'-Markierungen zurück auf status=NULL.
 * Wird gebraucht, um den Schaden einer Migration auszubügeln, die zu
 * Unrecht alle hidden=1-Stellen ohne Status auf 'abgelehnt' umgestempelt
 * hat. hidden=1 bleibt bestehen — die Stellen sind danach wieder NUR
 * ausgeblendet (alter Zustand), nicht abgelehnt.
 *
 * VORSICHT: Wenn du seit dem Bug-Commit Stellen tatsächlich manuell als
 * "5: Abgelehnt" markiert hast, gehen die hier ebenfalls verloren — sie
 * sind in der DB nicht von den Migrations-Umstempelungen unterscheidbar.
 *
 *   npm run reset-rejected
 */
import { getDb } from '../src/lib/db';

const db = getDb();

const cnt = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status = 'abgelehnt'").get() as { c: number };
console.log(`Vorher: ${cnt.c} Stellen mit status='abgelehnt'.`);

const tx = db.transaction(() => {
  db.prepare("UPDATE jobs SET status = NULL WHERE status = 'abgelehnt'").run();
  db.prepare("DELETE FROM status_urls WHERE status = 'abgelehnt'").run();
});
tx();

const after = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status = 'abgelehnt'").get() as { c: number };
const stillHidden = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE hidden = 1").get() as { c: number };
console.log(`Nachher: ${after.c} Stellen mit status='abgelehnt', ${stillHidden.c} Stellen weiter hidden=1 (nur ausgeblendet).`);
