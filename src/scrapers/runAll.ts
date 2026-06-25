import { scrapers } from './companies';
import { upsertJobs, recordImportRun, recordScraperStatus } from '../lib/db';

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

  async function worker() {
    while (queue.length) {
      const s = queue.shift()!;
      const tStart = Date.now();
      try {
        const result = await s.run();
        const up = upsertJobs(result.jobs);
        totalJobs += result.jobs.length;
        totalNew += up.inserted;
        recordScraperStatus(s.company, result.status, result.jobs.length, result.error);
        const icon = result.status === 'ok' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
        const dt = ((Date.now() - tStart) / 1000).toFixed(1);
        log(`${icon} ${s.company.padEnd(20)} ${String(result.jobs.length).padStart(3)} Stellen · +${up.inserted} neu · ${dt}s ${result.error ? '(' + result.error + ')' : ''}`);
        summary.push({ company: s.company, status: result.status, found: result.jobs.length, error: result.error });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        recordScraperStatus(s.company, 'fail', 0, err);
        log(`❌ ${s.company.padEnd(20)}   0 Stellen · Fehler: ${err}`);
        summary.push({ company: s.company, status: 'fail', found: 0, error: err });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  recordImportRun({ jobs_found: totalJobs, jobs_new: totalNew });

  log('');
  log(`▶ Fertig: ${totalJobs} Stellen gesamt · ${totalNew} neue Einträge in der DB`);
  return { totalJobs, totalNew, summary };
}
