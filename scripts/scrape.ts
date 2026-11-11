#!/usr/bin/env node
/**
 * CLI: npm run scrape
 *      npm run scrape -- --only Airbus,Infineon
 *      npm run scrape -- --only Personio   (matches any company containing "personio")
 *      npm run scrape -- --no-enrich       (ohne anschließendes Laden von Aufgaben/Profil)
 *      npm run scrape -- --skip-if-recent 120
 *                                          (nichts tun, wenn der letzte Lauf < 120 Min. her ist –
 *                                           für den automatischen Lauf beim Start des Trackers)
 */
import { runAllScrapers } from '../src/scrapers/runAll';
import { getLastImportTimestamp } from '../src/lib/db';
import { acquireLock, readActiveLock } from '../src/lib/scrapeRun';

function parseArgs(): { only?: string[]; concurrency?: number; enrich: boolean; skipIfRecentMin?: number } {
  const args = process.argv.slice(2);
  const out: { only?: string[]; concurrency?: number; enrich: boolean; skipIfRecentMin?: number } = { enrich: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only' && args[i + 1]) {
      out.only = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--concurrency' && args[i + 1]) {
      out.concurrency = Number(args[++i]);
    } else if (a === '--no-enrich') {
      out.enrich = false;
    } else if (a === '--skip-if-recent' && args[i + 1]) {
      out.skipIfRecentMin = Number(args[++i]);
    }
  }
  return out;
}

(async () => {
  const { only, concurrency, enrich, skipIfRecentMin } = parseArgs();
  if (skipIfRecentMin && !only) {
    const last = getLastImportTimestamp();
    const ageMin = last ? (Date.now() - Date.parse(last)) / 60000 : Infinity;
    if (ageMin < skipIfRecentMin) {
      console.log(`Letzter Scrape-Lauf vor ${Math.round(ageMin)} Min. – übersprungen (neu erst nach ${skipIfRecentMin} Min.).`);
      process.exit(0);
    }
  }
  // Nie zwei Läufe gleichzeitig (Button auf der Seite, Starter, täglicher Lauf).
  if (!acquireLock()) {
    const lock = readActiveLock();
    console.log(`Es läuft bereits ein Scrape-Lauf (seit ${lock ? new Date(lock.startedAt).toLocaleTimeString('de-DE') : '?'}) – nichts zu tun.`);
    process.exit(0);
  }
  const result = await runAllScrapers({ only, concurrency, enrich });
  const failed = result.summary.filter(s => s.status === 'fail').length;
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
