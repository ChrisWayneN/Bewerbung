#!/usr/bin/env node
/**
 * Lädt Aufgaben/Tätigkeiten und Qualifikationen/Profil von den Stellenseiten.
 * Läuft auch automatisch am Ende von "npm run scrape".
 *
 *   npm run enrich                         nur Stellen ohne Aufgaben/Profil
 *   npm run enrich -- --only Hensoldt      nur eine Firma (Teil des Namens reicht)
 *   npm run enrich -- --force              alle sichtbaren Stellen neu laden
 *                                          (z.B. nachdem die Extraktion verbessert wurde)
 *   npm run enrich -- --limit 20           höchstens 20 Stellen (zum Testen)
 *   npm run enrich -- --report             Diagnose: Stellen mit fehlenden Abschnitten
 *                                          und deren erkannte Überschriften (lädt nichts)
 *   npm run enrich -- --reextract          gespeicherte Beschreibungen mit den aktuellen
 *                                          Regeln neu zerlegen (lädt nichts, dauert Sekunden)
 */
import { enrichJobs } from '../src/scrapers/enrich';
import { explainHeadings, extractSections } from '../src/scrapers/extract';
import { getIncompleteEnrichments, getStoredDescriptions, updateSections } from '../src/lib/db';

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { only?: string[]; force: boolean; limit?: number; report: boolean; reextract: boolean } =
    { force: false, report: false, reextract: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only' && args[i + 1]) out.only = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--force') out.force = true;
    else if (a === '--limit' && args[i + 1]) out.limit = Number(args[++i]);
    else if (a === '--report') out.report = true;
    else if (a === '--reextract') out.reextract = true;
  }
  return out;
}

function matchesOnly(company: string, only?: string[]): boolean {
  return !only?.length || only.some(n => company.toLowerCase().includes(n.toLowerCase()));
}

/** Neu zerlegen ohne Netz. Übernommen wird nur, was mindestens genauso viele
 *  Abschnitte findet wie bisher – eine Regel-Änderung kann so nichts verschlechtern,
 *  korrigiert aber falsch zugeordnete Inhalte. */
function reextract(only?: string[]) {
  const rows = getStoredDescriptions().filter(r => matchesOnly(r.company, only));
  const score = (t: string | null, q: string | null) => (t ? 1 : 0) + (q ? 1 : 0);
  let changed = 0, improved = 0;
  for (const r of rows) {
    const s = extractSections(r.description_raw);
    if (s.tasks === r.tasks && s.qualifications === r.qualifications) continue;
    const before = score(r.tasks, r.qualifications);
    const after = score(s.tasks, s.qualifications);
    if (after < before) continue;
    updateSections(r.id, s.tasks, s.qualifications);
    changed++;
    if (after > before) improved++;
  }
  console.log(`${rows.length} gespeicherte Beschreibungen neu zerlegt: ${changed} geändert, davon ${improved} mit mehr gefundenen Abschnitten.`);
}

const KIND_LABEL: Record<string, string> = { task: 'Aufgaben', qual: 'Profil', stop: 'Stopp' };

function report(only?: string[]) {
  const rows = getIncompleteEnrichments().filter(r => matchesOnly(r.company, only));
  if (!rows.length) {
    console.log('Keine Stellen mit fehlenden Abschnitten.');
    return;
  }
  for (const r of rows) {
    const missing = [!r.tasks && 'Aufgaben', !r.qualifications && 'Profil'].filter(Boolean).join(' + ');
    console.log(`\n■ ${r.company} – ${r.title}`);
    console.log(`  fehlt: ${missing}`);
    console.log(`  ${r.url}`);
    if (!r.description_raw) {
      console.log('  (keine Beschreibung gespeichert – Seite lieferte keinen Text)');
      continue;
    }
    const headings = explainHeadings(r.description_raw);
    if (!headings.length) {
      console.log('  (keine Überschriften erkannt – Text ohne fette Zeilen/Überschriften)');
      continue;
    }
    for (const h of headings.slice(0, 25)) {
      console.log(`    [${(h.kind ? KIND_LABEL[h.kind] : '?').padEnd(8)}] ${h.text}`);
    }
  }
  console.log(`\n${rows.length} Stellen. Zeilen mit [?] sind unbekannte Überschriften – die bitte an Claude schicken.`);
}

const opts = parseArgs();
if (opts.report) {
  report(opts.only);
} else if (opts.reextract) {
  reextract(opts.only);
} else {
  enrichJobs(opts).catch(err => {
    console.error('Fatal:', err);
    process.exit(2);
  });
}
