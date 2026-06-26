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

  let totalAnchors = 0;
  let hrefMatched = 0;
  let titleOk = 0;
  let locationOk = 0;
  const samplePatternMatches: string[] = [];

  $('a').each((_, a) => {
    totalAnchors++;
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    if (!cfg.hrefPattern.test(href)) return;
    hrefMatched++;
    if (samplePatternMatches.length < 5) samplePatternMatches.push(href);
    const title = $a.text().trim().replace(/\s+/g, ' ');
    if (title.length < minLen || title.length > maxLen) return;
    titleOk++;
    const ctx = $a.closest('article, li, div, tr').text();
    const matchedArea = isMunichArea(ctx) || isMunichArea(title);
    if (!cfg.assumeLocation && !matchedArea) return;
    locationOk++;
    // jsessionid wandert in Java-Servlets pro Request → bei jedem Scrape
    // andere URL → Duplikate + verlorener Hide-Status. Vor dem Speichern raus.
    const rawUrl = href.startsWith('http') ? href : new URL(href, cfg.listingUrl).toString();
    const url = rawUrl.replace(/;jsessionid=[^?#]*/i, '');
    const job: JobInput = {
      company: cfg.company,
      title,
      location: cfg.defaultLocation ?? null,
      url,
      source_portal: cfg.sourcePortal,
    };
    job.hash = hashJob(job);
    out.push(job);
  });

  const seen = new Set<string>();
  const deduped = out.filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)));

  if (deduped.length === 0) {
    console.log(`  [debug ${cfg.company}] genericHtml 0 Treffer:`);
    console.log(`    HTML ${html.length} bytes · ${totalAnchors} <a>-Tags · ${hrefMatched} matchen hrefPattern · ${titleOk} mit Titel-Länge · ${locationOk} mit Munich-Match`);
    if (samplePatternMatches.length) {
      console.log(`    Sample hrefs (pattern-match):`);
      samplePatternMatches.forEach(h => console.log(`      ${h}`));
    } else {
      const anyHrefs: string[] = [];
      $('a[href]').each((_, a) => { if (anyHrefs.length < 5) anyHrefs.push($(a).attr('href') || ''); });
      console.log(`    Keine href matched pattern ${cfg.hrefPattern}. Erste hrefs:`);
      anyHrefs.forEach(h => console.log(`      ${h}`));
    }
  }

  return deduped;
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
