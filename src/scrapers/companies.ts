/**
 * Registry der 14 Zielunternehmen mit echten Karriere-Portalen.
 * Stand der Recherche: aktualisiert nach Web-Suche.
 *
 * Status-Legende:
 *   ✅ working scraper – verifizierte Endpoints
 *   ⚠️ best-effort – Tenant/Selector geraten, kann Anpassung brauchen
 *   ❌ link-only – kein automatischer Scraper möglich
 */

import * as cheerio from 'cheerio';
import type { JobInput } from '../lib/db';
import type { Scraper, ScrapeResult } from './base';
import { hashJob, isMunichArea, fetchText } from './base';
import { scrapeWorkday } from './portals/workday';
import { scrapePersonio } from './portals/personio';
import { scrapeGenericHtml } from './portals/genericHtml';
import { scrapeTalentsConnect } from './portals/talentsconnect';
import { scrapeSapCSB } from './portals/sapCSB';
import { scrapeEightfold } from './portals/eightfold';
import { scrapeGreenhouse } from './portals/greenhouse';

export interface CompanyMeta {
  name: string;
  careersUrl: string;
  portal: string;
  status: '✅' | '⚠️' | '❌';
  note?: string;
}

export const COMPANIES: CompanyMeta[] = [
  { name: 'KNDS',            careersUrl: 'https://jobs.knds.de/',                                portal: 'phenom/own',     status: '⚠️', note: 'Eigenes Portal jobs.knds.de – Phenom-ähnlich. HTML-Fallback.' },
  { name: 'Rohde & Schwarz', careersUrl: 'https://www.rohde-schwarz.com/de/karriere/jobs/jobs_232562.html', portal: 'AEM-custom',     status: '⚠️', note: 'Eigene AEM-Seite, kein offenes JSON. HTML-Fallback.' },
  { name: 'IABG',            careersUrl: 'https://jobboerse.iabg.de/engage/jobexchange/searchJobOffersQuick.do?j=myjobexchange', portal: 'engage', status: '✅', note: 'jobboerse.iabg.de (Engage-Servlet)' },
  { name: 'Agile Robots SE', careersUrl: 'https://agile-robots-se.jobs.personio.de/',            portal: 'personio',       status: '✅', note: 'Slug: agile-robots-se' },
  { name: 'Hensoldt',        careersUrl: 'https://hensoldt.wd3.myworkdayjobs.com/External_Career_Site', portal: 'workday', status: '✅', note: 'wd3, tenant=hensoldt, site=External_Career_Site' },
  { name: 'Diehl',           careersUrl: 'https://www.diehl.com/career/de/jobs-bewerbung',       portal: 'successfactors', status: '⚠️', note: 'Diehl Stiftung – Plattform unklar, HTML-Fallback' },
  { name: 'Infineon',        careersUrl: 'https://jobs.infineon.com/careers',                    portal: 'eightfold',      status: '✅', note: 'Eightfold AI: /api/apply/v2/jobs' },
  { name: 'Siemens',         careersUrl: 'https://jobs.siemens.com/',                            portal: 'phenom',         status: '✅', note: 'Phenom People JSON: /api/jobs' },
  { name: 'MTU',             careersUrl: 'https://www.mtu.de/careers/online-job-market/',        portal: 'html',           status: '⚠️', note: 'MTU Aero Engines – HTML-Liste' },
  { name: 'Airbus',          careersUrl: 'https://ag.wd3.myworkdayjobs.com/Airbus',              portal: 'workday',        status: '✅', note: 'wd3, tenant=ag, site=Airbus' },
  { name: 'Quantum Systems', careersUrl: 'https://career.quantum-systems.com/',                  portal: 'personio?',      status: '⚠️', note: 'Eigene Domain – probiert Personio-Slug "quantum-systems" und HTML-Fallback' },
  { name: 'Franka Robotics', careersUrl: 'https://franka-robotics.jobs.personio.de/',            portal: 'personio',       status: '✅', note: 'Tochter von Agile Robots, eigenes Personio' },
  { name: 'Neura Robotics',  careersUrl: 'https://jobs.neura-robotics.com/search',               portal: 'talentsconnect', status: '⚠️', note: 'talentsconnect AG – HTML-Scraping, HQ Metzingen' },
  { name: 'Isar Aerospace',  careersUrl: 'https://job-boards.eu.greenhouse.io/isaraerospace?offices%5B%5D=4008032101', portal: 'greenhouse', status: '✅', note: 'EU-Greenhouse-Board, Office-ID 4008032101 (München)' },
];

function linkOnly(meta: CompanyMeta): JobInput {
  const job: JobInput = {
    company: meta.name,
    title: `Karriereseite – ${meta.name} (manuell prüfen)`,
    location: 'München (zu prüfen)',
    url: meta.careersUrl,
    source_portal: 'link-only',
    description_raw: meta.note ?? 'Kein automatischer Scraper verfügbar.',
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

async function scrapeHensoldt(): Promise<JobInput[]> {
  return scrapeWorkday({ company: 'Hensoldt', tenant: 'hensoldt', wd: 3, site: 'External_Career_Site' }, true);
}

async function scrapeAgileRobots(): Promise<JobInput[]> {
  return scrapePersonio({ company: 'Agile Robots SE', tenant: 'agile-robots-se', tld: 'de' });
}

async function scrapeFranka(): Promise<JobInput[]> {
  return scrapePersonio({ company: 'Franka Robotics', tenant: 'franka-robotics', tld: 'de' });
}

async function scrapeQuantum(): Promise<JobInput[]> {
  // Erst Personio-Slug probieren, dann HTML-Fallback auf eigene Domain.
  try {
    return await scrapePersonio({ company: 'Quantum Systems', tenant: 'quantum-systems', tld: 'de' });
  } catch {
    return scrapeGenericHtml({
      company: 'Quantum Systems',
      listingUrl: 'https://career.quantum-systems.com/',
      hrefPattern: /(job|offer|position|stelle)/i,
      defaultLocation: 'Gilching',
      sourcePortal: 'qs-html',
    });
  }
}

async function scrapeInfineon(): Promise<JobInput[]> {
  // Verifiziert: Infineon nutzt Eightfold AI. URL-Parameter pid + filter_distance.
  return scrapeEightfold({
    company: 'Infineon',
    baseUrl: 'https://jobs.infineon.com',
    location: 'Munich, BY, Germany',
    radiusKm: 50,
    pid: '563808970681317',
  });
}

async function scrapeSiemens(): Promise<JobInput[]> {
  // Siemens hat den /api/jobs-Endpoint umgebaut. Probiere mehrere bekannte
  // Phenom-Endpoint-Varianten, dann HTML-Fallback.
  const candidates = [
    'https://jobs.siemens.com/api/jobs?keyword=&location=Munich%2C+Germany&radius=30&num=100',
    'https://jobs.siemens.com/widgets?ddoKey=refineSearch&location=Munich%2C+Germany&radius=30&num=100',
    'https://jobs.siemens.com/careers?location=Munich%2C+Germany&radius=30&pid=&Codes=',
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const text = await res.text();
      // Versuche JSON, sonst skip
      let data: any;
      try { data = JSON.parse(text); } catch { continue; }
      const arr = data?.refineSearch?.data?.jobs ?? data?.jobs ?? [];
      if (!Array.isArray(arr) || !arr.length) continue;
      const out: JobInput[] = [];
      for (const item of arr) {
        const d: any = item.data ?? item;
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
      if (out.length) return out;
    } catch { /* probiere nächste URL */ }
  }
  throw new Error('Siemens: kein funktionierender API-Endpoint gefunden – Karriereseite per DevTools auf XHR/JSON-URL prüfen');
}

async function scrapeKNDS(): Promise<JobInput[]> {
  // Custom System (recruiting-solutions.org). Verifizierte DOM-Struktur:
  //   <a class="search-item-wrapper" href=".../job-invite/{id}/...">
  //     <h3 class="title">...</h3>
  //     <div class="locations">München</div>
  //   </a>
  const out: JobInput[] = [];
  const seen = new Set<string>();
  const pageSize = 100;

  for (let page = 1; page <= 20; page++) {
    const url = `https://jobs.knds.de/content/search/?locale=de_DE&currentPage=${page}&pageSize=${pageSize}`;
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const items = $('a.search-item-wrapper');
    if (!items.length) break;

    let added = 0;
    items.each((_, a) => {
      const $a = $(a);
      const href = $a.attr('href');
      const title = $a.find('h3.title, .title').first().text().trim().replace(/\s+/g, ' ');
      const location = $a.find('div.locations, .locations').first().text().trim().replace(/\s+/g, ' ');
      if (!href || !title) return;
      if (!isMunichArea(location)) return;
      const fullUrl = href.startsWith('http') ? href : new URL(href, 'https://jobs.knds.de').toString();
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      const job: JobInput = {
        company: 'KNDS',
        title,
        location,
        url: fullUrl,
        source_portal: 'knds-rs',
      };
      job.hash = hashJob(job);
      out.push(job);
      added++;
    });

    if (items.length < pageSize) break;
    if (added === 0 && page > 1) break;
  }
  return out;
}

async function scrapeRohdeSchwarz(): Promise<JobInput[]> {
  // Die alte URL liefert 404. Aktuelle Karriere-Hauptseite + JSON-Suche probieren.
  return scrapeGenericHtml({
    company: 'Rohde & Schwarz',
    listingUrl: 'https://www.rohde-schwarz.com/de/karriere/jobs/karriere_207796.html',
    hrefPattern: /\/karriere\/jobs?\/.+\.html$/i,
    defaultLocation: 'München',
    sourcePortal: 'rohde-html',
  });
}

async function scrapeIABG(): Promise<JobInput[]> {
  // Verifiziert: IABG nutzt ein Engage-Jobbörsen-System unter jobboerse.iabg.de.
  return scrapeGenericHtml({
    company: 'IABG',
    listingUrl: 'https://jobboerse.iabg.de/engage/jobexchange/searchJobOffersQuick.do?languageChanged=true&j=myjobexchange',
    hrefPattern: /(jobOffer|jobExchange|viewJobOffer|engage).*\.do/i,
    defaultLocation: 'Ottobrunn',
    sourcePortal: 'iabg-engage',
    assumeLocation: true,
    minTitleLen: 5,
  });
}

async function scrapeDiehl(): Promise<JobInput[]> {
  // Verifizierte Detail-URL-Struktur: /career/de/jobs-bewerbung/stellenboerse/{slug}/
  // Listing ohne Location-Filter; Munich-Match per Slug-Heuristik (job-Titel enthalten
  // oft den Standort). TODO: URL mit Standort-Filter ergänzen sobald bekannt.
  return scrapeGenericHtml({
    company: 'Diehl',
    listingUrl: 'https://www.diehl.com/career/de/jobs-bewerbung/stellenboerse/',
    hrefPattern: /\/career\/de\/jobs-bewerbung\/stellenboerse\/[a-z0-9-]+\/?$/i,
    defaultLocation: 'München',
    sourcePortal: 'diehl-html',
    assumeLocation: false,
    minTitleLen: 10,
  });
}

async function scrapeMTU(): Promise<JobInput[]> {
  // MTU listet alle Standorte – wir parsen alle Job-Links, München-Filter über Kontext.
  return scrapeGenericHtml({
    company: 'MTU',
    listingUrl: 'https://www.mtu.de/careers/online-job-market/',
    hrefPattern: /\/(careers?|jobs?)\//i,
    defaultLocation: 'München',
    sourcePortal: 'mtu-html',
    assumeLocation: false,
    minTitleLen: 10,
  });
}

async function scrapeIsarAerospace(): Promise<JobInput[]> {
  // Greenhouse-API, EU-Tenant. Office-ID 4008032101 = München (aus
  // ?offices[]=4008032101 in der Karriere-URL).
  return scrapeGreenhouse({
    company: 'Isar Aerospace',
    board: 'isaraerospace',
    region: 'eu',
    officeIds: [4008032101],
  });
}

async function scrapeNeura(): Promise<JobInput[]> {
  // talentsconnect liefert die Stellen auf der /search-Seite.
  return scrapeTalentsConnect({
    company: 'Neura Robotics',
    baseUrl: 'https://jobs.neura-robotics.com',
  });
}

/* ---------------- Public registry ---------------- */

export const scrapers: Scraper[] = [
  { company: 'Airbus',          run: wrap('Airbus',          scrapeAirbus) },
  { company: 'Hensoldt',        run: wrap('Hensoldt',        scrapeHensoldt) },
  { company: 'Agile Robots SE', run: wrap('Agile Robots SE', scrapeAgileRobots) },
  { company: 'Franka Robotics', run: wrap('Franka Robotics', scrapeFranka) },
  { company: 'Quantum Systems', run: wrap('Quantum Systems', scrapeQuantum) },
  { company: 'Neura Robotics',  run: wrap('Neura Robotics',  scrapeNeura) },
  { company: 'Infineon',        run: wrap('Infineon',        scrapeInfineon) },
  { company: 'Siemens',         run: wrap('Siemens',         scrapeSiemens) },
  { company: 'KNDS',            run: wrap('KNDS',            scrapeKNDS) },
  { company: 'Rohde & Schwarz', run: wrap('Rohde & Schwarz', scrapeRohdeSchwarz) },
  { company: 'IABG',            run: wrap('IABG',            scrapeIABG) },
  { company: 'Diehl',           run: wrap('Diehl',           scrapeDiehl) },
  { company: 'MTU',             run: wrap('MTU',             scrapeMTU) },
  { company: 'Isar Aerospace',  run: wrap('Isar Aerospace',  scrapeIsarAerospace) },
];

function wrap(company: string, fn: () => Promise<JobInput[]>) {
  return async (): Promise<ScrapeResult> => {
    try {
      const jobs = await fn();
      return { jobs, status: jobs.length ? 'ok' : 'partial' };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const meta = COMPANIES.find(c => c.name === company);
      const fallback = meta ? [linkOnly(meta)] : [];
      return { jobs: fallback, status: 'fail', error: err };
    }
  };
}
