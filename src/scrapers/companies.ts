/**
 * Registry der 14 Zielunternehmen mit echten Karriere-Portalen.
 * Stand der Recherche: aktualisiert nach Web-Suche.
 *
 * Status-Legende:
 *   ✅ working scraper – verifizierte Endpoints
 *   ⚠️ best-effort – Tenant/Selector geraten, kann Anpassung brauchen
 *   ❌ link-only – kein automatischer Scraper möglich
 */

import type { JobInput } from '../lib/db';
import type { Scraper, ScrapeResult } from './base';
import { hashJob } from './base';
import { scrapeWorkday } from './portals/workday';
import { scrapePersonio } from './portals/personio';
import { scrapeGenericHtml } from './portals/genericHtml';
import { scrapeTalentsConnect } from './portals/talentsconnect';

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
  { name: 'IABG',            careersUrl: 'https://www.iabg.de/karriere/stellenangebote',         portal: 'html',           status: '✅', note: 'HQ Ottobrunn – HTML einfach.' },
  { name: 'Agile Robots SE', careersUrl: 'https://agile-robots-se.jobs.personio.de/',            portal: 'personio',       status: '✅', note: 'Slug: agile-robots-se' },
  { name: 'Hensoldt',        careersUrl: 'https://hensoldt.wd3.myworkdayjobs.com/External_Career_Site', portal: 'workday', status: '✅', note: 'wd3, tenant=hensoldt, site=External_Career_Site' },
  { name: 'Diehl',           careersUrl: 'https://www.diehl.com/career/de/jobs-bewerbung',       portal: 'successfactors', status: '⚠️', note: 'Diehl Stiftung – Plattform unklar, HTML-Fallback' },
  { name: 'Infineon',        careersUrl: 'https://jobs.infineon.com/careers',                    portal: 'custom',         status: '⚠️', note: 'jobs.infineon.com – probiert mehrere API-Varianten' },
  { name: 'Siemens',         careersUrl: 'https://jobs.siemens.com/',                            portal: 'phenom',         status: '✅', note: 'Phenom People JSON: /api/jobs' },
  { name: 'MTU',             careersUrl: 'https://www.mtu.de/careers/online-job-market/',        portal: 'html',           status: '⚠️', note: 'MTU Aero Engines – HTML-Liste' },
  { name: 'MAN',             careersUrl: 'https://jobs.man.eu/',                                 portal: 'html',           status: '⚠️', note: 'MAN Truck & Bus – HTML' },
  { name: 'Airbus',          careersUrl: 'https://ag.wd3.myworkdayjobs.com/Airbus',              portal: 'workday',        status: '✅', note: 'wd3, tenant=ag, site=Airbus' },
  { name: 'Quantum Systems', careersUrl: 'https://career.quantum-systems.com/',                  portal: 'personio?',      status: '⚠️', note: 'Eigene Domain – probiert Personio-Slug "quantum-systems" und HTML-Fallback' },
  { name: 'Franka Robotics', careersUrl: 'https://franka-robotics.jobs.personio.de/',            portal: 'personio',       status: '✅', note: 'Tochter von Agile Robots, eigenes Personio' },
  { name: 'Neura Robotics',  careersUrl: 'https://jobs.neura-robotics.com/',                     portal: 'talentsconnect', status: '⚠️', note: 'talentsconnect AG – HTML-Scraping, HQ Metzingen' },
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
  // Infineon nutzt ein eigenes System auf jobs.infineon.com. Wir probieren
  // zuerst die typische Workday-CXS-Variante, dann eine REST-Suche.
  try {
    return await scrapeWorkday({ company: 'Infineon', tenant: 'infineon', wd: 3, site: 'Infineon' }, true);
  } catch {
    return scrapeGenericHtml({
      company: 'Infineon',
      listingUrl: 'https://www.infineon.com/cms/en/careers/jobsearch/jobsearch/?searchLocation=Munich',
      hrefPattern: /(job|jobs?\/details|position)/i,
      defaultLocation: 'München',
      sourcePortal: 'infineon-html',
    });
  }
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
  // KNDS jobs.knds.de – versuche zuerst HTML, dann Phenom-ähnliche API.
  return scrapeGenericHtml({
    company: 'KNDS',
    listingUrl: 'https://jobs.knds.de/viewalljobs/content/search/?locale=de_DE&q=&location=M%C3%BCnchen',
    hrefPattern: /\/job\/|\/career\/|\/stelle\/|jobs?\/[a-z]/i,
    defaultLocation: 'München',
    sourcePortal: 'knds-html',
  });
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
  return scrapeGenericHtml({
    company: 'IABG',
    listingUrl: 'https://www.iabg.de/karriere/stellenangebote',
    hrefPattern: /(stellenangebot|jobs?|karriere|career)/i,
    defaultLocation: 'Ottobrunn',
    sourcePortal: 'iabg-html',
    assumeLocation: true,
    minTitleLen: 5,
  });
}

async function scrapeDiehl(): Promise<JobInput[]> {
  return scrapeGenericHtml({
    company: 'Diehl',
    listingUrl: 'https://www.diehl.com/career/de/jobs-bewerbung',
    hrefPattern: /(stelle|job|position|offer)/i,
    defaultLocation: 'München',
    sourcePortal: 'diehl-html',
  });
}

async function scrapeMTU(): Promise<JobInput[]> {
  // MTU listet alle Standorte – wir filtern hart auf München-Whitelist im Kontext.
  // (vorher: 132 Treffer = alle Stellen weltweit; Filter griff nicht)
  return scrapeGenericHtml({
    company: 'MTU',
    listingUrl: 'https://www.mtu.de/careers/online-job-market/',
    hrefPattern: /\/careers?\/online-job-market\/job-details/i,
    defaultLocation: 'München',
    sourcePortal: 'mtu-html',
    assumeLocation: false,
    minTitleLen: 10,
  });
}

async function scrapeMAN(): Promise<JobInput[]> {
  return scrapeGenericHtml({
    company: 'MAN',
    listingUrl: 'https://jobs.man.eu/?locale=de_DE&location=M%C3%BCnchen',
    hrefPattern: /(job|stelle|position|career)/i,
    defaultLocation: 'München',
    sourcePortal: 'man-html',
  });
}

async function scrapeNeura(): Promise<JobInput[]> {
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
  { company: 'MAN',             run: wrap('MAN',             scrapeMAN) },
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
