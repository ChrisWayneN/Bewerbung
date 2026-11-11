import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractSectionsFromHtml } from '../extract';

/**
 * Personio exposes a public XML feed at:
 *   https://{tenant}.jobs.personio.de/xml
 *   https://{tenant}.jobs.personio.com/xml
 * Schema (simplified):
 *   <workzag-jobs><position>
 *     <id/><name/><office/><department/><employmentType/>
 *     <jobDescriptions><jobDescription><name/><value/></jobDescription></jobDescriptions>
 *   </position></workzag-jobs>
 */
export interface PersonioConfig {
  company: string;
  tenant: string;
  tld?: 'de' | 'com';
}

export async function scrapePersonio(cfg: PersonioConfig): Promise<JobInput[]> {
  const tld = cfg.tld ?? 'de';
  const xmlUrl = `https://${cfg.tenant}.jobs.personio.${tld}/xml`;
  const xml = await fetchText(xmlUrl, { headers: { accept: 'application/xml,text/xml' } });
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: JobInput[] = [];
  const otherOffices = new Map<string, number>();
  $('position').each((_, pos) => {
    const $p = $(pos);
    const id = $p.find('id').first().text().trim();
    const title = $p.find('name').first().text().trim();
    const office = $p.find('office').first().text().trim();
    if (!isMunichArea(office)) { otherOffices.set(office || '–', (otherOffices.get(office || '–') ?? 0) + 1); return; }

    const urlTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = `https://${cfg.tenant}.jobs.personio.${tld}/job/${id}?display=${encodeURIComponent(urlTitle)}`;

    const parts: string[] = [];
    $p.find('jobDescription').each((_, d) => {
      const name = $(d).find('name').first().text().trim();
      const value = $(d).find('value').first().text().trim();
      parts.push(`<h3>${name}</h3>${value}`);
    });
    const description = parts.join('\n');
    const sections = extractSectionsFromHtml(description);

    const job: JobInput = {
      company: cfg.company,
      title,
      location: office,
      url,
      source_portal: 'personio',
      description_raw: description,
      tasks: sections.tasks,
      qualifications: sections.qualifications,
    };
    job.hash = hashJob(job);
    out.push(job);
  });
  if (otherOffices.size) {
    console.log(`  [debug ${cfg.company}] ${out.length} Stellen im Großraum München, außerhalb: ${[...otherOffices].map(([o, c]) => `${o} (${c})`).join(', ')}.`);
  }
  return out;
}
