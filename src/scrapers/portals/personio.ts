import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractSectionsFromHtml } from '../extract';
import { scrapeCareerSite } from './careerSite';

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
  let xml: string;
  try {
    xml = await fetchText(xmlUrl, { headers: { accept: 'application/xml,text/xml' } });
  } catch (e) {
    // Manche Firmen schalten den XML-Feed ab (404) – dann die Stellenseite des Boards lesen.
    if (e instanceof Error && /^HTTP 404\b/.test(e.message)) return scrapePersonioHtml(cfg, 'XML-Feed abgeschaltet (404)');
    throw e;
  }
  const $ = cheerio.load(xml, { xmlMode: true });
  if ($('position').length === 0) return scrapePersonioHtml(cfg, 'XML-Feed leer');
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

/** Fallback ohne XML-Feed: Stellenliste des Personio-Boards (Links /job/<id>),
 *  Ort aus der Liste bzw. dem JSON-LD der Stellenseite. Beschreibung lädt die
 *  Detail-Anreicherung danach von der Stellenseite. */
async function scrapePersonioHtml(cfg: PersonioConfig, why: string): Promise<JobInput[]> {
  const tld = cfg.tld ?? 'de';
  console.log(`  [debug ${cfg.company}] ${why} – lese stattdessen die Stellenseite des Personio-Boards.`);
  return scrapeCareerSite({
    company: cfg.company,
    listUrl: `https://${cfg.tenant}.jobs.personio.${tld}/`,
    jobPath: /^\/job\/\d+\/?$/,
    sourcePortal: 'personio',
    noPersonioDelegate: true,
  });
}
