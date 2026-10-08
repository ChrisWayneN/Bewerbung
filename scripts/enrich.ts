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
import { explainHeadings, extractSections, looksLikeClosedPosting, isPlaceholderDescription } from '../src/scrapers/extract';
import { getIncompleteEnrichments, getStoredDescriptions, updateSections, markEnrichClosed, resetEnrichment } from '../src/lib/db';

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
 *  korrigiert aber falsch zugeordnete Inhalte. Gespeicherte Hinweisseiten
 *  ("position has been filled") samt daraus extrahiertem Müll werden entfernt. */
function reextract(only?: string[]) {
  const rows = getStoredDescriptions().filter(r => matchesOnly(r.company, only));
  const score = (t: string | null, q: string | null) => (t ? 1 : 0) + (q ? 1 : 0);
  let changed = 0, improved = 0, closed = 0, placeholders = 0;
  for (const r of rows) {
    if (isPlaceholderDescription(r.description_raw)) {
      resetEnrichment(r.id);
      placeholders++;
      continue;
    }
    const s = extractSections(r.description_raw);
    const after = score(s.tasks, s.qualifications);
    if (after < 2 && looksLikeClosedPosting(r.description_raw)) {
      markEnrichClosed(r.id, true);
      closed++;
      continue;
    }
    if (s.tasks === r.tasks && s.qualifications === r.qualifications) continue;
    if (after < score(r.tasks, r.qualifications)) continue;
    updateSections(r.id, s.tasks, s.qualifications);
    changed++;
    if (after > score(r.tasks, r.qualifications)) improved++;
  }
  console.log(`${rows.length} gespeicherte Beschreibungen neu zerlegt: ${changed} geändert, davon ${improved} mit mehr gefundenen Abschnitten.`);
  if (placeholders) console.log(`${placeholders} gespeicherte Beschreibungen enthielten nur Platzhalter ("Lorem Ipsum") – zurückgesetzt, werden beim nächsten "npm run enrich" neu geladen.`);
  if (closed) console.log(`${closed} gespeicherte "Beschreibungen" waren Hinweisseiten (Stelle nicht mehr ausgeschrieben) – entfernt.`);
}

const KIND_LABEL: Record<string, string> = { task: 'Aufgaben', qual: 'Profil', stop: 'Stopp' };

function report(only?: string[]) {
  const all = getIncompleteEnrichments().filter(r => matchesOnly(r.company, only));
  const open = all.filter(r => !r.closed);
  const closed = all.filter(r => r.closed);
  if (!all.length) {
    console.log('Keine Stellen mit fehlenden Abschnitten.');
    return;
  }

  let unknownHeadings = 0;
  if (open.length) console.log(`=== Unvollständig (${open.length}) – hier kann nachgebessert werden`);
  for (const r of open) {
    const missing = [!r.tasks && 'Aufgaben', !r.qualifications && 'Profil'].filter(Boolean).join(' + ');
    console.log(`\n■ ${r.company} – ${r.title}`);
    console.log(`  fehlt: ${missing} · Versuche: ${r.enrich_attempts}`);
    if (r.enrich_note) console.log(`  Grund: ${r.enrich_note}`);
    console.log(`  ${r.url}`);
    if (!r.description_raw) continue;
    const headings = explainHeadings(r.description_raw);
    if (!headings.length) {
      console.log('  (keine Überschriften erkannt – Text ohne fette Zeilen/Überschriften)');
      continue;
    }
    for (const h of headings.slice(0, 25)) {
      if (!h.kind) unknownHeadings++;
      console.log(`    [${(h.kind ? KIND_LABEL[h.kind] : '?').padEnd(8)}] ${h.text}`);
    }
  }

  if (closed.length) {
    console.log(`\n=== Nicht mehr ausgeschrieben (${closed.length}) – nichts zu tun`);
    console.log('    Bleiben nur wegen Status/Bewertung in der Liste bzw. Seite meldet "nicht mehr verfügbar".');
    for (const r of closed) {
      const marks = [r.status, r.rating && `Bewertung ${r.rating}`].filter(Boolean).join(', ');
      const why = r.stale ? `nicht mehr gelistet seit ${r.last_seen.slice(0, 10)}` : 'Seite: nicht mehr verfügbar';
      console.log(`  · ${r.company} – ${r.title}  (${why}${marks ? '; ' + marks : ''})`);
    }
  }

  if (unknownHeadings) console.log(`\nZeilen mit [?] sind unbekannte Überschriften – die bitte an Claude schicken.`);
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
