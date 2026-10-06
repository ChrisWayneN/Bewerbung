#!/usr/bin/env node
/**
 * CLI: npm run scrape
 *      npm run scrape -- --only Airbus,Infineon
 *      npm run scrape -- --only Personio   (matches any company containing "personio")
 *      npm run scrape -- --no-enrich       (ohne anschließendes Laden von Aufgaben/Profil)
 */
import { runAllScrapers } from '../src/scrapers/runAll';

function parseArgs(): { only?: string[]; concurrency?: number; enrich: boolean } {
  const args = process.argv.slice(2);
  const out: { only?: string[]; concurrency?: number; enrich: boolean } = { enrich: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only' && args[i + 1]) {
      out.only = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--concurrency' && args[i + 1]) {
      out.concurrency = Number(args[++i]);
    } else if (a === '--no-enrich') {
      out.enrich = false;
    }
  }
  return out;
}

(async () => {
  const { only, concurrency, enrich } = parseArgs();
  const result = await runAllScrapers({ only, concurrency, enrich });
  const failed = result.summary.filter(s => s.status === 'fail').length;
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
