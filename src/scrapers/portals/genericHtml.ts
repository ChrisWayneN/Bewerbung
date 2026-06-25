import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractSectionsFromHtml } from '../extract';

/**
 * Generischer HTML-Listen-Scraper für eigene Karriereseiten ohne JSON-API.
 * Sucht alle <a>-Tags, deren href Job-Pfad-Patterns matchen, prüft Kontext
 * gegen die München-Whitelist und dedupliziert nach URL.
 */
export interface GenericHtmlConfig {
  company: string;
  listingUrl: string;
  /** Regex die der href matchen muss um als Job-Link zu zählen. */
  hrefPattern: RegExp;
  /** Wenn gesetzt: Default-Location wenn keine im Kontext gefunden. */
  defaultLocation?: string;
  /** Sourceportal-Bezeichnung für die DB. */
  sourcePortal: string;
  /** Wenn true: schwächere Location-Filterung (Default-Location wird angenommen, alles importieren). */
  assumeLocation?: boolean;
  /** Minimal-/Maximallänge des Titel-Texts. */
  minTitleLen?: number;
  maxTitleLen?: number;
}

export async function scrapeGenericHtml(cfg: GenericHtmlConfig): Promise<JobInput[]> {
  const html = await fetchText(cfg.listingUrl);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];
  const minLen = cfg.minTitleLen ?? 10;
  const maxLen = cfg.maxTitleLen ?? 200;

  $('a').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    if (!cfg.hrefPattern.test(href)) return;
    const title = $a.text().trim().replace(/\s+/g, ' ');
    if (title.length < minLen || title.length > maxLen) return;
    const ctx = $a.closest('article, li, div, tr').text();
    const matchedArea = isMunichArea(ctx) || isMunichArea(title);
    if (!cfg.assumeLocation && !matchedArea) return;
    const url = href.startsWith('http') ? href : new URL(href, cfg.listingUrl).toString();
    const job: JobInput = {
      company: cfg.company,
      title,
      location: matchedArea ? (/[A-ZÄÖÜ][a-zäöüß-]+(?:\s+[A-ZÄÖÜ][a-zäöüß-]+)?/.exec(ctx)?.[0] ?? cfg.defaultLocation ?? null) : (cfg.defaultLocation ?? null),
      url,
      source_portal: cfg.sourcePortal,
    };
    job.hash = hashJob(job);
    out.push(job);
  });

  const seen = new Set<string>();
  return out.filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)));
}

/** Reichert einen Job mit Description + extrahierten Sections an. */
export async function enrichJob(job: JobInput): Promise<JobInput> {
  try {
    const html = await fetchText(job.url);
    const sections = extractSectionsFromHtml(html);
    return { ...job, description_raw: html.slice(0, 50_000), tasks: sections.tasks, qualifications: sections.qualifications };
  } catch {
    return job;
  }
}
