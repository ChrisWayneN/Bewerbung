import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractSectionsFromHtml } from '../extract';

/**
 * talentsconnect-AG-hosted careers pages (z. B. jobs.neura-robotics.com).
 * Strategie: HTML der Suchseite parsen — kein offizielles JSON-API bekannt.
 */
export interface TalentsConnectConfig {
  company: string;
  baseUrl: string; // z. B. "https://jobs.neura-robotics.com"
}

export async function scrapeTalentsConnect(cfg: TalentsConnectConfig): Promise<JobInput[]> {
  const searchUrl = `${cfg.baseUrl.replace(/\/$/, '')}/search`;
  const html = await fetchText(searchUrl);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];

  // talentsconnect-Templates rendern Job-Karten meist als <a href="/offer/...">.
  $('a[href*="/offer/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    const url = href.startsWith('http') ? href : new URL(href, cfg.baseUrl).toString();
    const card = $a.closest('article, li, div');
    const title = ($a.find('h2,h3').first().text() || $a.text()).trim().replace(/\s+/g, ' ');
    const location = card.find('[class*="location"], [class*="city"]').first().text().trim()
      || /\(([^)]+)\)/.exec($a.text())?.[1]
      || '';
    if (!title) return;
    if (!isMunichArea(location)) return;
    const job: JobInput = {
      company: cfg.company,
      title,
      location: location || null,
      url,
      source_portal: 'talentsconnect',
    };
    job.hash = hashJob(job);
    out.push(job);
  });

  const seen = new Set<string>();
  return out.filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)));
}

/** Reichert einen einzelnen Job mit Description + extrahierten Sections an. */
export async function enrichTalentsConnect(job: JobInput): Promise<JobInput> {
  try {
    const html = await fetchText(job.url);
    const $ = cheerio.load(html);
    const main = $('main').html() || $('article').html() || html;
    const sections = extractSectionsFromHtml(main);
    return { ...job, description_raw: main.slice(0, 50_000), tasks: sections.tasks, qualifications: sections.qualifications };
  } catch {
    return job;
  }
}
