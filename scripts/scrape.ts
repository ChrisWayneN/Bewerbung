#!/usr/bin/env node
/**
 * CLI: npm run scrape
 *      npm run scrape -- --only Airbus,Infineon
 *      npm run scrape -- --only Personio   (matches any company containing "personio")
 */
import { runAllScrapers } from '../src/scrapers/runAll';

function parseArgs(): { only?: string[]; concurrency?: number } {
  const args = process.argv.slice(2);
  const out: { only?: string[]; concurrency?: number } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only' && args[i + 1]) {
      out.only = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--concurrency' && args[i + 1]) {
      out.concurrency = Number(args[++i]);
    }
  }
  return out;
}

(async () => {
  const { only, concurrency } = parseArgs();
  const result = await runAllScrapers({ only, concurrency });
  const failed = result.summary.filter(s => s.status === 'fail').length;
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
