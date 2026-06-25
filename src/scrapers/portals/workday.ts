import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob } from '../base';
import { extractSectionsFromHtml, extractSectionsFromText } from '../extract';

/**
 * Workday CXS JSON pattern. Public endpoint, no auth:
 *   POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
 *   { "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }
 * Returns { total, jobPostings: [{ title, locationsText, externalPath, ... }] }
 */
interface WorkdayJob {
  title: string;
  externalPath: string;
  locationsText?: string;
  locations?: { locationName?: string; name?: string }[];
  primaryLocation?: { name?: string };
  bulletFields?: string[];
}
interface WorkdayList {
  total: number;
  jobPostings: WorkdayJob[];
}
interface WorkdayDetail {
  jobPostingInfo?: {
    title?: string;
    location?: string;
    jobDescription?: string;
    externalUrl?: string;
  };
}

export interface WorkdayConfig {
  company: string;
  tenant: string;          // e.g. 'airbus'
  wd: number;              // e.g. 3 -> wd3
  site: string;            // e.g. 'Airbus'
  searchText?: string;
  pageSize?: number;
}

export async function scrapeWorkday(cfg: WorkdayConfig, fetchDetails = true): Promise<JobInput[]> {
  const base = `https://${cfg.tenant}.wd${cfg.wd}.myworkdayjobs.com`;
  const listUrl = `${base}/wday/cxs/${cfg.tenant}/${cfg.site}/jobs`;
  const out: JobInput[] = [];
  const limit = cfg.pageSize ?? 20;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    // Manche Tenants (z. B. Hensoldt) lehnen die einfache Variante mit HTTP 422 ab.
    // Wir probieren mehrere Body-Varianten in dieser Reihenfolge.
    const bodies: object[] = [
      { appliedFacets: {}, limit, offset, searchText: cfg.searchText ?? '' },
      { limit, offset, searchText: cfg.searchText ?? '' },
      { appliedFacets: {}, limit, offset },
      { limit, offset },
    ];
    let data: WorkdayList | null = null;
    let lastStatus = 0;
    for (const body of bodies) {
      const res = await fetch(listUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      lastStatus = res.status;
      if (res.ok) {
        data = (await res.json()) as WorkdayList;
        break;
      }
    }
    if (!data) throw new Error(`Workday list HTTP ${lastStatus} (${cfg.company})`);
    total = data.total ?? 0;
    if (!data.jobPostings?.length) break;

    for (const jp of data.jobPostings) {
      const location =
        jp.locationsText
        ?? jp.primaryLocation?.name
        ?? jp.locations?.[0]?.locationName
        ?? jp.locations?.[0]?.name
        ?? null;
      if (!isMunichArea(location)) continue;
      const url = `${base}${jp.externalPath}`;
      const job: JobInput = {
        company: cfg.company,
        title: jp.title,
        location,
        url,
        source_portal: 'workday',
      };

      if (fetchDetails) {
        try {
          const detailUrl = `${base}/wday/cxs/${cfg.tenant}/${cfg.site}${jp.externalPath}`;
          const dres = await fetch(detailUrl, { headers: { accept: 'application/json' } });
          if (dres.ok) {
            const detail = (await dres.json()) as WorkdayDetail;
            const desc = detail.jobPostingInfo?.jobDescription ?? '';
            job.description_raw = desc;
            const sections = desc.includes('<') ? extractSectionsFromHtml(desc) : extractSectionsFromText(desc);
            job.tasks = sections.tasks;
            job.qualifications = sections.qualifications;
          }
        } catch {
          /* ignore detail errors – list-level data still useful */
        }
      }
      job.hash = hashJob(job);
      out.push(job);
    }
    offset += data.jobPostings.length;
    if (data.jobPostings.length < limit) break;
  }
  return out;
}
