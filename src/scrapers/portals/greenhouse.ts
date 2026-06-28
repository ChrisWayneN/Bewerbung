import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchJson } from '../base';
import { extractSectionsFromHtml } from '../extract';

/**
 * Greenhouse public Job-Board-API.
 *   https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
 *   https://boards-api.eu.greenhouse.io/v1/boards/{board}/jobs?content=true   (EU-Tenant)
 *
 * Antwortschema (vereinfacht):
 *   { jobs: [{ id, title, absolute_url, location: { name },
 *              offices: [{ id, name }], departments: [{ name }],
 *              content (HTML, mit content=true) }] }
 */
export interface GreenhouseConfig {
  company: string;
  board: string;
  region?: 'us' | 'eu';
  officeIds?: number[];
}

interface GreenhouseJob {
  id: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
  offices?: { id: number; name?: string }[];
  departments?: { name?: string }[];
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

export async function scrapeGreenhouse(cfg: GreenhouseConfig): Promise<JobInput[]> {
  const host = cfg.region === 'eu' ? 'boards-api.eu.greenhouse.io' : 'boards-api.greenhouse.io';
  const url = `https://${host}/v1/boards/${cfg.board}/jobs?content=true`;
  const data = await fetchJson<GreenhouseResponse>(url);
  const out: JobInput[] = [];

  for (const j of data.jobs ?? []) {
    if (!j.title || !j.absolute_url) continue;

    const officeNames = (j.offices ?? []).map(o => o.name ?? '').join(', ');
    const locationName = j.location?.name?.trim() || officeNames || '';

    // Office-ID-Filter ist präziser als Substring-Match auf Standortname.
    if (cfg.officeIds?.length) {
      const hit = (j.offices ?? []).some(o => cfg.officeIds!.includes(o.id));
      if (!hit) continue;
    } else if (!isMunichArea(locationName)) {
      continue;
    }

    const content = decodeHtmlEntities(j.content ?? '');
    const sections = extractSectionsFromHtml(content);

    const job: JobInput = {
      company: cfg.company,
      title: j.title,
      location: locationName || 'München',
      url: j.absolute_url,
      source_portal: 'greenhouse',
      description_raw: content,
      tasks: sections.tasks,
      qualifications: sections.qualifications,
    };
    job.hash = hashJob(job);
    out.push(job);
  }

  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
