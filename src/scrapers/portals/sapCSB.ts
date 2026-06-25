import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractSectionsFromHtml } from '../extract';

/**
 * SAP SuccessFactors Career Site Builder (CSB).
 * Typischer URL-Pattern:
 *   https://{tenant-domain}/content/search/?locale=de_DE&currentPage=1&pageSize=20
 * z. B. jobs.knds.de.
 *
 * HTML-Struktur (vereinfacht):
 *   <a class="jobTitle-link" href="/job/123/...">Titel</a>
 *   <span class="jobLocation">München, Bayern</span>
 * Es gibt Varianten (id-basiert, data-row-Tabellen), wir versuchen mehrere
 * Selektoren parallel.
 */
export interface SapCSBConfig {
  company: string;
  baseUrl: string;          // z. B. 'https://jobs.knds.de'
  searchPath?: string;      // Default: '/content/search/'
  locale?: string;          // Default: 'de_DE'
  pageSize?: number;        // Default: 100
  maxPages?: number;        // Default: 20 (Sicherheitslimit)
  /** Wenn true: alle Stellen importieren ohne Munich-Filter (selten sinnvoll). */
  noLocationFilter?: boolean;
}

export async function scrapeSapCSB(cfg: SapCSBConfig): Promise<JobInput[]> {
  const searchPath = cfg.searchPath ?? '/content/search/';
  const locale = cfg.locale ?? 'de_DE';
  const pageSize = cfg.pageSize ?? 100;
  const maxPages = cfg.maxPages ?? 20;
  const out: JobInput[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const url = `${cfg.baseUrl}${searchPath}?locale=${encodeURIComponent(locale)}&currentPage=${page}&pageSize=${pageSize}`;
    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const jobLinks = $('a.jobTitle-link, a[id^="job"], a[href*="/job/"]:not([href*="/joblist"])');
    if (!jobLinks.length) break;

    let foundOnPage = 0;
    jobLinks.each((_, a) => {
      const $a = $(a);
      const href = $a.attr('href');
      if (!href) return;
      const title = $a.text().trim().replace(/\s+/g, ' ');
      if (!title) return;

      const row = $a.closest('tr, li, .data-row, .job-tile, .jobItem, article');
      const location = (
        row.find('.jobLocation, [class*="location" i], [class*="jobLocation" i]').first().text() ||
        row.find('span').filter((_, el) => /m[uü]nchen|munich|bayern/i.test($(el).text())).first().text() ||
        ''
      ).trim();

      if (!cfg.noLocationFilter && !isMunichArea(location)) return;

      const fullUrl = href.startsWith('http') ? href : new URL(href, cfg.baseUrl).toString();
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);

      const job: JobInput = {
        company: cfg.company,
        title,
        location: location || 'München',
        url: fullUrl,
        source_portal: 'sap-csb',
      };
      job.hash = hashJob(job);
      out.push(job);
      foundOnPage++;
    });

    // Letzte Seite erkannt: wenig oder keine Treffer mehr.
    if (jobLinks.length < pageSize) break;
    // Sanity: wenn nichts passiert ist, abbrechen
    if (page > 1 && foundOnPage === 0) break;
  }

  return out;
}

/** Optionale Detail-Anreicherung: lädt die Stellen-Seite und extrahiert Aufgaben/Qualifikationen. */
export async function enrichSapCSB(job: JobInput): Promise<JobInput> {
  try {
    const html = await fetchText(job.url);
    const sections = extractSectionsFromHtml(html);
    return { ...job, description_raw: html.slice(0, 50_000), tasks: sections.tasks, qualifications: sections.qualifications };
  } catch {
    return job;
  }
}
