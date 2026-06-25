import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractSectionsFromHtml } from '../extract';

/**
 * SAP SuccessFactors Career Site has many flavors. The most common public
 * surface is the careers HTML page with results in DOM. As a portable default
 * we parse the search results page and pick up jobs whose location matches
 * the Munich whitelist. Per-tenant tweaks live in individual scraper modules.
 */
export interface SuccessFactorsConfig {
  company: string;
  searchUrl: string;             // a tenant-specific search URL returning HTML
  jobRowSelector?: string;       // CSS for one job row in results
  titleSelector?: string;
  locationSelector?: string;
  linkSelector?: string;
  baseUrl?: string;              // for resolving relative hrefs
}

export async function scrapeSuccessFactorsHtml(cfg: SuccessFactorsConfig): Promise<JobInput[]> {
  const html = await fetchText(cfg.searchUrl);
  const $ = cheerio.load(html);
  const rowSel = cfg.jobRowSelector ?? '.jobTitle,.job-row,.job-tile,a[data-job-id]';
  const out: JobInput[] = [];
  $(rowSel).each((_, el) => {
    const $el = $(el);
    const title = (cfg.titleSelector ? $el.find(cfg.titleSelector).text() : $el.text()).trim();
    const location = (cfg.locationSelector ? $el.find(cfg.locationSelector).text() : $el.closest('tr,li,div').find('.jobLocation,.location').text()).trim();
    const href = $el.is('a') ? $el.attr('href') : $el.find('a').attr('href');
    if (!title || !href) return;
    if (!isMunichArea(location)) return;
    const url = href.startsWith('http') ? href : new URL(href, cfg.baseUrl ?? cfg.searchUrl).toString();
    const job: JobInput = {
      company: cfg.company,
      title,
      location,
      url,
      source_portal: 'successfactors',
    };
    job.hash = hashJob(job);
    out.push(job);
  });
  return out;
}

/** Optional: enrich a single job with description by GET-ing its page and running extract. */
export async function enrichWithHtmlDescription(job: JobInput): Promise<JobInput> {
  try {
    const html = await fetchText(job.url);
    const sections = extractSectionsFromHtml(html);
    return { ...job, description_raw: html.slice(0, 50_000), tasks: sections.tasks, qualifications: sections.qualifications };
  } catch {
    return job;
  }
}
