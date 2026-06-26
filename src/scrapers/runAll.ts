import { scrapers } from './companies';
import { upsertJobs, recordImportRun, recordScraperStatus, deleteJobsByTitleKeywords } from '../lib/db';
import { getBlacklistKeywords, matchedBlacklistTerm } from '../lib/blacklist';

export interface RunOptions {
  only?: string[];        // company-name filter
  concurrency?: number;
  log?: (msg: string) => void;
}

export async function runAllScrapers(opts: RunOptions = {}) {
  const log = opts.log ?? console.log;
  const concurrency = opts.concurrency ?? 4;
  const filtered = opts.only?.length
    ? scrapers.filter(s => opts.only!.some(n => s.company.toLowerCase().includes(n.toLowerCase())))
    : scrapers;

  log(`▶ Starte ${filtered.length} Scraper (Parallelität ${concurrency})`);

  const queue = [...filtered];
  let totalJobs = 0;
  let totalNew = 0;
  const summary: { company: string; status: string; found: number; error?: string }[] = [];

  let totalBlacklisted = 0;

  async function worker() {
    while (queue.length) {
      const s = queue.shift()!;
      const tStart = Date.now();
      try {
        const result = await s.run();
        // Blacklist-Filter vor Upsert: rausgefilterte Jobs landen gar nicht erst in der DB.
        const allowed = result.jobs.filter(j => {
          const term = matchedBlacklistTerm(j.title);
          if (term) { totalBlacklisted++; return false; }
          return true;
        });
        const up = upsertJobs(allowed);
        totalJobs += allowed.length;
        totalNew += up.inserted;
        recordScraperStatus(s.company, result.status, allowed.length, result.error);
        const icon = result.status === 'ok' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
        const dt = ((Date.now() - tStart) / 1000).toFixed(1);
        const skip = result.jobs.length - allowed.length;
        const skipStr = skip > 0 ? ` (-${skip} blacklist)` : '';
        log(`${icon} ${s.company.padEnd(20)} ${String(allowed.length).padStart(3)} Stellen · +${up.inserted} neu${skipStr} · ${dt}s ${result.error ? '(' + result.error + ')' : ''}`);
        summary.push({ company: s.company, status: result.status, found: allowed.length, error: result.error });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        recordScraperStatus(s.company, 'fail', 0, err);
        log(`❌ ${s.company.padEnd(20)}   0 Stellen · Fehler: ${err}`);
        summary.push({ company: s.company, status: 'fail', found: 0, error: err });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // DB-Bereinigung: Altbestand, der unter aktualisierte Blacklist fällt, wird gelöscht.
  const keywords = getBlacklistKeywords();
  const cleanup = deleteJobsByTitleKeywords(keywords);

  recordImportRun({ jobs_found: totalJobs, jobs_new: totalNew });

  log('');
  log(`▶ Fertig: ${totalJobs} Stellen gesamt · ${totalNew} neue Einträge in der DB`);
  if (totalBlacklisted > 0) log(`  → ${totalBlacklisted} Stellen wegen Blacklist-Treffer im Titel beim Scrapen übersprungen.`);
  if (cleanup.deleted > 0) {
    log(`  → ${cleanup.deleted} Altbestand-Stellen mit Blacklist-Treffer aus DB gelöscht. Beispiele:`);
    cleanup.samples.forEach(t => log(`    · ${t}`));
  }
  if (keywords.length === 0) log(`  ⚠️  Blacklist leer (src/config/blacklist.json).`);

  return { totalJobs, totalNew, totalBlacklisted, blacklistDeleted: cleanup.deleted, summary };
}
