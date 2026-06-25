/**
 * Registry of all 21 target companies with their known careers URLs and the
 * portal technology used (where known). Per-company scraper functions live
 * below. Status legend:
 *   ✅ working scraper – returns structured jobs
 *   ⚠️ partial – list-only, no description extraction, or fragile
 *   ❌ link-only – just provides a single "see careers page" entry
 */

import type { JobInput } from '../lib/db';
import type { Scraper, ScrapeResult } from './base';
import { hashJob } from './base';
import { scrapeWorkday } from './portals/workday';
import { scrapePersonio } from './portals/personio';
import { scrapeSuccessFactorsHtml, enrichWithHtmlDescription } from './portals/successfactors';

type Maybe<T> = T | null;

export interface CompanyMeta {
  name: string;
  careersUrl: string;
  portal: string;
  status: '✅' | '⚠️' | '❌';
  note?: string;
}

export const COMPANIES: CompanyMeta[] = [
  { name: 'KNDS',            careersUrl: 'https://www.knds.com/career/',                              portal: 'custom',         status: '❌', note: 'KNDS Deutschland (München, Krauss-Maffei) – Karriereportal benötigt JS-Rendering' },
  { name: 'Rohde & Schwarz', careersUrl: 'https://www.rohde-schwarz.com/de/karriere/jobs/jobs_232562.html', portal: 'custom',  status: '⚠️', note: 'Eigene Suche, JSON-Endpoint stark verändert sich – HTML-Fallback' },
  { name: 'IABG',            careersUrl: 'https://www.iabg.de/karriere/stellenangebote/',             portal: 'custom',         status: '✅', note: 'HTML-Liste, einfach' },
  { name: 'Agile Robots SE', careersUrl: 'https://www.agile-robots.com/en/careers',                   portal: 'personio',       status: '⚠️', note: 'Tenant-Slug "agilerobots" probieren' },
  { name: 'Hensoldt',        careersUrl: 'https://www.hensoldt.net/karriere/jobs/',                   portal: 'successfactors', status: '⚠️', note: 'SAP SF – HTML-Parsing' },
  { name: 'Diehl',           careersUrl: 'https://www.diehl.com/group/de/karriere/',                  portal: 'successfactors', status: '⚠️' },
  { name: 'Infineon',        careersUrl: 'https://www.infineon.com/cms/en/careers/jobsearch/',        portal: 'workday',        status: '⚠️', note: 'wd3, tenant=infineon' },
  { name: 'Siemens',         careersUrl: 'https://jobs.siemens.com/careers',                          portal: 'custom',         status: '⚠️', note: 'Phenom People – eigene JSON-Suche' },
  { name: 'MTU',             careersUrl: 'https://www.mtu.de/de/karriere/jobsuche/',                  portal: 'successfactors', status: '⚠️' },
  { name: 'MAN',             careersUrl: 'https://www.mantruckandbus.com/de/karriere.html',           portal: 'successfactors', status: '⚠️' },
  { name: 'Airbus',          careersUrl: 'https://ag.wd3.myworkdayjobs.com/Airbus',                   portal: 'workday',        status: '✅', note: 'wd3, tenant=ag, site=Airbus' },
  { name: 'Quantum Systems', careersUrl: 'https://quantum-systems.jobs.personio.de/',                 portal: 'personio',       status: '✅' },
  { name: 'Franka Robotics', careersUrl: 'https://franka-robotics.jobs.personio.de/',                 portal: 'personio',       status: '✅', note: 'früher Franka Emika' },
  { name: 'Magazino',        careersUrl: 'https://magazino.jobs.personio.de/',                        portal: 'personio',       status: '⚠️', note: 'Magazino wurde von Jungheinrich aufgenommen – ggf. eingestellt' },
  { name: 'Neura Robotics',  careersUrl: 'https://neura-robotics.jobs.personio.de/',                  portal: 'personio',       status: '✅', note: 'HQ Metzingen, BW – wenig München, aber prüfen' },
  { name: 'Atlas Robotics',  careersUrl: 'https://atlas-robotics.com/karriere/',                      portal: 'custom',         status: '❌', note: 'Sehr klein, evtl. keine Stellen online' },
  { name: 'Locus Robotics',  careersUrl: 'https://locusrobotics.com/careers/',                        portal: 'greenhouse',     status: '❌', note: 'US-Firma, kein DE-Büro München' },
  { name: 'Keenon Robotics', careersUrl: 'https://www.keenon.com/de/Career.html',                     portal: 'custom',         status: '❌', note: 'EU-HQ Düsseldorf, kein München' },
  { name: 'Synaos',          careersUrl: 'https://synaos.jobs.personio.de/',                          portal: 'personio',       status: '✅', note: 'HQ Hannover, manchmal München' },
  { name: 'Faulhaber',       careersUrl: 'https://www.faulhaber.com/de/karriere/offene-stellen/',     portal: 'custom',         status: '❌', note: 'HQ Schönaich BW, kein München' },
  { name: 'Dreher Automation', careersUrl: 'https://www.dreher-automation.de/karriere/',              portal: 'custom',         status: '❌', note: 'Klein, Karriere meist Aushang' },
];

/** Convenience: build a single "❌ link-only" job for companies without working scraper. */
function linkOnly(meta: CompanyMeta): JobInput {
  const job: JobInput = {
    company: meta.name,
    title: `Karriereseite – ${meta.name} (manuell prüfen)`,
    location: 'München (zu prüfen)',
    url: meta.careersUrl,
    source_portal: 'link-only',
    description_raw: meta.note ?? 'Kein automatischer Scraper verfügbar – bitte Karriereseite manuell prüfen.',
    tasks: null,
    qualifications: null,
  };
  job.hash = hashJob(job);
  return job;
}

/* ---------------- Per-company scrapers ---------------- */

async function scrapeAirbus(): Promise<JobInput[]> {
  return scrapeWorkday({ company: 'Airbus', tenant: 'ag', wd: 3, site: 'Airbus' }, true);
}

async function scrapeInfineon(): Promise<JobInput[]> {
  // Infineon uses Workday under jobs.infineon.com.
  try {
    return await scrapeWorkday({ company: 'Infineon', tenant: 'infineon', wd: 3, site: 'Infineon' }, true);
  } catch {
    return await scrapeWorkday({ company: 'Infineon', tenant: 'infineon', wd: 5, site: 'Infineon_External' }, true);
  }
}

async function scrapePersonioCo(name: string, tenant: string, tld: 'de' | 'com' = 'de'): Promise<JobInput[]> {
  try { return await scrapePersonio({ company: name, tenant, tld }); }
  catch (e) {
    // try opposite TLD as fallback
    return await scrapePersonio({ company: name, tenant, tld: tld === 'de' ? 'com' : 'de' });
  }
}

async function scrapeIABG(): Promise<JobInput[]> {
  // IABG has a simple HTML list at /karriere/stellenangebote/
  const { fetchText } = await import('./base');
  const cheerio = await import('cheerio');
  const url = 'https://www.iabg.de/karriere/stellenangebote/';
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];
  $('a').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    const text = $a.text().trim();
    if (!href || !text) return;
    if (!/stellenangebot|jobs?\/|karriere\//i.test(href)) return;
    if (text.length < 10 || text.length > 200) return;
    const ctx = $a.closest('tr,li,div,article').text();
    const { isMunichArea } = require('./base');
    if (!isMunichArea(ctx) && !isMunichArea(text)) return;
    const full = href.startsWith('http') ? href : new URL(href, url).toString();
    const job: JobInput = {
      company: 'IABG',
      title: text,
      location: /münchen|ottobrunn|taufkirchen/i.exec(ctx)?.[0] ?? 'Ottobrunn',
      url: full,
      source_portal: 'iabg-html',
    };
    job.hash = hashJob(job);
    out.push(job);
  });
  // Deduplicate by URL
  const seen = new Set<string>();
  return out.filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)));
}

async function scrapeHensoldt(): Promise<JobInput[]> {
  return scrapeSuccessFactorsHtml({
    company: 'Hensoldt',
    searchUrl: 'https://hensoldt.wd3.myworkdayjobs.com/Hensoldt',
    baseUrl: 'https://hensoldt.wd3.myworkdayjobs.com/',
  }).catch(async () => {
    // Hensoldt is actually on Workday — try that:
    return scrapeWorkday({ company: 'Hensoldt', tenant: 'hensoldt', wd: 3, site: 'Hensoldt' });
  });
}

async function scrapeMTU(): Promise<JobInput[]> {
  // MTU uses SAP SF careers under mtu.epost-easycruit or career5.successfactors.eu
  return scrapeSuccessFactorsHtml({
    company: 'MTU',
    searchUrl: 'https://career5.successfactors.eu/career?company=MTUAERO',
    baseUrl: 'https://career5.successfactors.eu/',
  });
}

async function scrapeMAN(): Promise<JobInput[]> {
  return scrapeSuccessFactorsHtml({
    company: 'MAN',
    searchUrl: 'https://career012.successfactors.eu/careers?company=mantruckanZ',
    baseUrl: 'https://career012.successfactors.eu/',
  });
}

async function scrapeDiehl(): Promise<JobInput[]> {
  return scrapeSuccessFactorsHtml({
    company: 'Diehl',
    searchUrl: 'https://career5.successfactors.eu/career?company=DiehlStif',
    baseUrl: 'https://career5.successfactors.eu/',
  });
}

async function scrapeRohdeSchwarz(): Promise<JobInput[]> {
  // R&S has its own JSON endpoint that frequently changes. Fall back to HTML list scraping.
  const { fetchText, isMunichArea } = await import('./base');
  const cheerio = await import('cheerio');
  const url = 'https://www.rohde-schwarz.com/de/karriere/jobs/jobs_232562.html';
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];
  $('a').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    const text = $a.text().trim();
    if (!href || !text) return;
    if (!/jobs?\/|stelle|career/i.test(href)) return;
    if (text.length < 10 || text.length > 200) return;
    const ctx = $a.closest('article,li,div').text();
    if (!isMunichArea(ctx) && !isMunichArea(text)) return;
    const full = href.startsWith('http') ? href : new URL(href, url).toString();
    const job: JobInput = {
      company: 'Rohde & Schwarz',
      title: text,
      location: 'München',
      url: full,
      source_portal: 'rohde-html',
    };
    job.hash = hashJob(job);
    out.push(job);
  });
  const seen = new Set<string>();
  return out.filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)));
}

async function scrapeSiemens(): Promise<JobInput[]> {
  // Siemens uses Phenom People. Public search JSON:
  // https://jobs.siemens.com/api/jobs?keyword=&location=Munich&country=Germany&radius=30&num=100
  const url = 'https://jobs.siemens.com/api/jobs?keyword=&location=Munich%2C+Germany&radius=30&num=100&pid=&offset=0&filter=&Codes=';
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Siemens HTTP ' + res.status);
  const data = (await res.json()) as { jobs?: { data?: any }[]; refineSearch?: unknown };
  const arr = data.jobs ?? [];
  const out: JobInput[] = [];
  for (const item of arr) {
    const d: any = (item as any).data ?? item;
    const title = d.title || d.jobTitle;
    const loc = d.city ? `${d.city}${d.state ? ', ' + d.state : ''}` : d.location;
    const path = d.applyUrl || d.url || (d.jobId ? `https://jobs.siemens.com/jobs/${d.jobId}` : null);
    if (!title || !path) continue;
    const job: JobInput = {
      company: 'Siemens',
      title,
      location: loc ?? 'München',
      url: path.startsWith('http') ? path : `https://jobs.siemens.com${path}`,
      source_portal: 'phenom',
      description_raw: d.description ?? null,
    };
    job.hash = hashJob(job);
    out.push(job);
  }
  return out;
}

/* ---------------- Public registry ---------------- */

export const scrapers: Scraper[] = [
  { company: 'Airbus',          run: wrap('Airbus',          scrapeAirbus) },
  { company: 'Infineon',        run: wrap('Infineon',        scrapeInfineon) },
  { company: 'Quantum Systems', run: wrap('Quantum Systems', () => scrapePersonioCo('Quantum Systems', 'quantum-systems')) },
  { company: 'Franka Robotics', run: wrap('Franka Robotics', () => scrapePersonioCo('Franka Robotics', 'franka-robotics')) },
  { company: 'Magazino',        run: wrap('Magazino',        () => scrapePersonioCo('Magazino', 'magazino')) },
  { company: 'Neura Robotics',  run: wrap('Neura Robotics',  () => scrapePersonioCo('Neura Robotics', 'neura-robotics')) },
  { company: 'Agile Robots SE', run: wrap('Agile Robots SE', () => scrapePersonioCo('Agile Robots SE', 'agilerobots')) },
  { company: 'Synaos',          run: wrap('Synaos',          () => scrapePersonioCo('Synaos', 'synaos')) },
  { company: 'IABG',            run: wrap('IABG',            scrapeIABG) },
  { company: 'Hensoldt',        run: wrap('Hensoldt',        scrapeHensoldt) },
  { company: 'MTU',             run: wrap('MTU',             scrapeMTU) },
  { company: 'MAN',             run: wrap('MAN',             scrapeMAN) },
  { company: 'Diehl',           run: wrap('Diehl',           scrapeDiehl) },
  { company: 'Rohde & Schwarz', run: wrap('Rohde & Schwarz', scrapeRohdeSchwarz) },
  { company: 'Siemens',         run: wrap('Siemens',         scrapeSiemens) },
  // Link-only fallbacks:
  { company: 'KNDS',              run: linkOnlyRunner('KNDS') },
  { company: 'Atlas Robotics',    run: linkOnlyRunner('Atlas Robotics') },
  { company: 'Locus Robotics',    run: linkOnlyRunner('Locus Robotics') },
  { company: 'Keenon Robotics',   run: linkOnlyRunner('Keenon Robotics') },
  { company: 'Faulhaber',         run: linkOnlyRunner('Faulhaber') },
  { company: 'Dreher Automation', run: linkOnlyRunner('Dreher Automation') },
];

function wrap(company: string, fn: () => Promise<JobInput[]>) {
  return async (): Promise<ScrapeResult> => {
    try {
      const jobs = await fn();
      return { jobs, status: jobs.length ? 'ok' : 'partial' };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      // graceful: emit a single link-only marker so user still sees the company
      const meta = COMPANIES.find(c => c.name === company);
      const fallback = meta ? [linkOnly(meta)] : [];
      return { jobs: fallback, status: 'fail', error: err };
    }
  };
}

function linkOnlyRunner(company: string) {
  return async (): Promise<ScrapeResult> => {
    const meta = COMPANIES.find(c => c.name === company);
    return { jobs: meta ? [linkOnly(meta)] : [], status: 'partial' };
  };
}
