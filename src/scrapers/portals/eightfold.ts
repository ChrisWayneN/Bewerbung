import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob } from '../base';

/**
 * Eightfold AI Talent Intelligence Platform.
 * Öffentlicher Such-Endpoint (von Eightfold-betriebenen Karriereseiten genutzt):
 *   GET /api/apply/v2/jobs?domain={domain}&start={offset}&num={limit}&location={loc}&pid={pid}
 *
 * Erkennt man an URL-Parametern wie pid=..., filter_distance=..., start=...
 * Beispiel-Tenant: jobs.infineon.com.
 *
 * Response-Struktur:
 *   { positions: [{ id, name, location, url, job_description, ... }], count }
 */
export interface EightfoldConfig {
  company: string;
  baseUrl: string;          // z. B. 'https://jobs.infineon.com'
  domain?: string;          // optional, manchmal nötig (z. B. 'infineon.com')
  location?: string;        // Default: 'Munich, BY, Germany'
  radiusKm?: number;        // Default: 50
  pageSize?: number;        // Default: 50
  maxPages?: number;        // Default: 20
  pid?: string;             // optionaler primary ID-Filter
}

interface EightfoldJob {
  id?: string | number;
  name?: string;
  display_job_title?: string;
  location?: string;
  display_location?: string;
  canonicalPositionUrl?: string;
  url?: string;
  job_description?: string;
}

interface EightfoldResponse {
  positions?: EightfoldJob[];
  count?: number;
}

export async function scrapeEightfold(cfg: EightfoldConfig): Promise<JobInput[]> {
  const baseUrl = cfg.baseUrl.replace(/\/$/, '');
  const location = cfg.location ?? 'Munich, BY, Germany';
  const pageSize = cfg.pageSize ?? 50;
  const maxPages = cfg.maxPages ?? 20;
  const out: JobInput[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      start: String(page * pageSize),
      num: String(pageSize),
      location,
      radius: String(cfg.radiusKm ?? 50),
      sort_by: 'distance',
    });
    if (cfg.domain) params.set('domain', cfg.domain);
    if (cfg.pid) params.set('pid', cfg.pid);

    const url = `${baseUrl}/api/apply/v2/jobs?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        referer: `${baseUrl}/careers`,
      },
    });
    if (!res.ok) throw new Error(`Eightfold HTTP ${res.status} (${cfg.company})`);
    const data = (await res.json()) as EightfoldResponse;
    const positions = data.positions ?? [];
    if (!positions.length) break;

    let added = 0;
    for (const p of positions) {
      const title = p.name ?? p.display_job_title;
      const loc = p.display_location ?? p.location ?? '';
      // Eightfold filtert serverseitig auf radius, dennoch hier prüfen.
      if (!isMunichArea(loc)) continue;
      const detailUrl = p.canonicalPositionUrl ?? p.url ?? (p.id ? `${baseUrl}/careers/job/${p.id}` : null);
      if (!title || !detailUrl) continue;
      if (seen.has(detailUrl)) continue;
      seen.add(detailUrl);
      const job: JobInput = {
        company: cfg.company,
        title,
        location: loc,
        url: detailUrl,
        source_portal: 'eightfold',
        description_raw: p.job_description ?? null,
      };
      job.hash = hashJob(job);
      out.push(job);
      added++;
    }
    if (positions.length < pageSize) break;
    if (added === 0 && page > 0) break;
  }
  return out;
}
