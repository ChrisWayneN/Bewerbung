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
  /** Server-seitige Workday-Facetten (z.B. locationCountry/locations/jobFamilyGroup),
   *  IDs aus der Browser-Netzwerk-Analyse der gefilterten Karriereseite. Wenn gesetzt,
   *  wird NUR dieser Body probiert (kein ungefilterter Fallback), damit die Facetten
   *  garantiert greifen statt versehentlich auf ungefilterte Ergebnisse zurückzufallen. */
  appliedFacets?: Record<string, string[]>;
}

export async function scrapeWorkday(cfg: WorkdayConfig, fetchDetails = true): Promise<JobInput[]> {
  const base = `https://${cfg.tenant}.wd${cfg.wd}.myworkdayjobs.com`;
  // Manche Tenants brauchen einen Locale-Pfad. Wir probieren site-as-is und
  // gängige Locale-Varianten falls die einfache fehlschlägt.
  const siteCandidates = Array.from(new Set([
    cfg.site,
    `en-US/${cfg.site}`,
    `de-DE/${cfg.site}`,
  ]));
  const out: JobInput[] = [];
  const limit = cfg.pageSize ?? 20;
  let offset = 0;
  let total = Infinity;
  let listUrl = `${base}/wday/cxs/${cfg.tenant}/${cfg.site}/jobs`;
  let workingSite = cfg.site;
  let firstCall = true;

  while (offset < total) {
    // Wenn Facetten vorgegeben sind: NUR diesen Body probieren, damit nicht
    // versehentlich auf einen ungefilterten Fallback-Body zurückgefallen wird.
    const bodies: object[] = cfg.appliedFacets
      ? [{ appliedFacets: cfg.appliedFacets, limit, offset, searchText: cfg.searchText ?? '' }]
      : [
          { appliedFacets: {}, limit, offset, searchText: cfg.searchText ?? '' },
          { appliedFacets: { locations: [], jobFamilyGroup: [] }, limit, offset, searchText: cfg.searchText ?? '' },
          { limit, offset, searchText: cfg.searchText ?? '' },
          { appliedFacets: {}, limit, offset },
          { limit, offset },
        ];
    let data: WorkdayList | null = null;
    let lastStatus = 0;

    // Beim ersten Call: probiere alle siteCandidates mit allen bodies bis was klappt.
    // Danach: behalte den funktionierenden listUrl bei.
    const sitesToTry = firstCall ? siteCandidates : [workingSite];

    outer: for (const site of sitesToTry) {
      const url = `${base}/wday/cxs/${cfg.tenant}/${site}/jobs`;
      for (const body of bodies) {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            referer: `${base}/${site}`,
            origin: base,
          },
          body: JSON.stringify(body),
        });
        lastStatus = res.status;
        if (res.ok) {
          data = (await res.json()) as WorkdayList;
          workingSite = site;
          listUrl = url;
          firstCall = false;
          break outer;
        }
      }
    }
    if (!data) throw new Error(`Workday list HTTP ${lastStatus} (${cfg.company}) – Body- und Site-Varianten erschöpft. Tenant/Site per DevTools verifizieren.`);
    total = data.total ?? 0;
    if (!data.jobPostings?.length) break;

    // Debug-Log immer wenn die ersten Postings kommen aber Filter alles wegwirft,
    // oder wenn SCRAPE_DEBUG=1 gesetzt ist.
    const debugOn = process.env.SCRAPE_DEBUG === '1';
    if ((debugOn || (offset === 0 && out.length === 0)) && data.jobPostings[0]) {
      const sample = data.jobPostings[0];
      console.log(`  [debug ${cfg.company}] erste Stelle:`, JSON.stringify({
        title: sample.title,
        locationsText: sample.locationsText,
        locations: sample.locations,
        primaryLocation: sample.primaryLocation,
      }, null, 2));
    }

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
          const detailUrl = `${base}/wday/cxs/${cfg.tenant}/${workingSite}${jp.externalPath}`;
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
