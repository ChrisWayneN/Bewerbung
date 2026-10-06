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
 */
import { enrichJobs } from '../src/scrapers/enrich';

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { only?: string[]; force: boolean; limit?: number } = { force: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only' && args[i + 1]) out.only = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--force') out.force = true;
    else if (a === '--limit' && args[i + 1]) out.limit = Number(args[++i]);
  }
  return out;
}

enrichJobs(parseArgs()).catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
