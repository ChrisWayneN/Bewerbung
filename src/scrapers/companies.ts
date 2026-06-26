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
import { scrapeTypesense } from './portals/typesense';
import { scrapeSapCSB } from './portals/sapCSB';
import { scrapeEightfold } from './portals/eightfold';

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
  // Personio liefert bei nicht-existentem Slug oft leeres XML → wir fallen
  // bei 0 Treffern explizit auf den HTML-Pfad zurück.
  try {
    const personio = await scrapePersonio({ company: 'Quantum Systems', tenant: 'quantum-systems', tld: 'de' });
    if (personio.length > 0) return personio;
  } catch { /* fall through */ }
  return scrapeGenericHtml({
    company: 'Quantum Systems',
    listingUrl: 'https://career.quantum-systems.com/',
    hrefPattern: /\/(jobs?|offer|position|stelle|karriere|stellenangebote)\/[^"'\s?#]+/i,
    defaultLocation: 'Gilching',
    sourcePortal: 'qs-html',
    minTitleLen: 5,
  });
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
  // Siemens nutzt Phenom People. Wesentlicher Parameter: domain=siemens.com.
  // Probiere mehrere bekannte Phenom-Endpoint-Varianten.
  const candidates = [
    'https://jobs.siemens.com/api/jobs?domain=siemens.com&location=Munich%2C+Germany&locationName=Munich%2C+Germany&radius=30&num=100&start=0',
    'https://jobs.siemens.com/api/jobs?domain=siemens.com&keyword=&location=Munich&radius=30&num=100',
    'https://jobs.siemens.com/widgets?domain=siemens.com&ddoKey=refineSearch&location=Munich%2C+Germany&radius=30&num=100',
    'https://jobs.siemens.com/api/jobs?keyword=&location=Munich%2C+Germany&radius=30&num=100',
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          referer: 'https://jobs.siemens.com/careers',
        },
      });
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
  // jobs.knds.de ist eine SPA (recruiting-solutions.org / SAP CSB). 31 kb HTML-
  // Shell → keine Job-Links im Markup. Wir probieren bekannte JSON-Endpoints,
  // die solche Career-Portale typischerweise haben, dann Sitemap, dann Inline-JSON.
  const out: JobInput[] = [];
  const seen = new Set<string>();
  const debug: string[] = [];

  // (1) Bekannte JSON-Endpoint-Muster für SAP CSB / recruiting-solutions.org.
  const apiCandidates = [
    'https://jobs.knds.de/api/jobs?locale=de_DE&pageSize=200&currentPage=1',
    'https://jobs.knds.de/api/v1/jobs?locale=de_DE&pageSize=200',
    'https://jobs.knds.de/content/api/search?locale=de_DE&pageSize=200&currentPage=1',
    'https://jobs.knds.de/services/jobsearch?locale=de_DE&pageSize=200',
    'https://jobs.knds.de/jobs.json?locale=de_DE',
  ];
  for (const url of apiCandidates) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      debug.push(`  API ${url} → ${res.status}`);
      if (!res.ok) continue;
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { continue; }
      const arr: any[] = data?.jobs ?? data?.results ?? data?.items ?? data?.content ?? [];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      for (const it of arr) {
        const title = it.title || it.jobTitle || it.name;
        const location = it.location || it.locations || it.city || it.workLocation || '';
        const id = it.id || it.jobId || it.requisitionId;
        const href = it.url || it.applyUrl || it.detailUrl || (id ? `https://jobs.knds.de/job-invite/${id}/` : null);
        if (!title || !href) continue;
        if (!isMunichArea(typeof location === 'string' ? location : JSON.stringify(location))) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const job: JobInput = {
          company: 'KNDS',
          title,
          location: typeof location === 'string' ? location : 'München',
          url: href,
          source_portal: 'knds-api',
        };
        job.hash = hashJob(job);
        out.push(job);
      }
      if (out.length) return out;
    } catch (e) {
      debug.push(`  API ${url} → ${(e as Error).message}`);
    }
  }

  // (2) Sitemap-Fallback
  try {
    const sm = await fetchText('https://jobs.knds.de/sitemap.xml', { headers: { accept: 'application/xml' } });
    debug.push(`  sitemap.xml: ${sm.length} bytes`);
    const urls = Array.from(sm.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]).filter(u => /job-invite|\/job\//.test(u));
    if (urls.length) {
      debug.push(`  sitemap: ${urls.length} job URLs gefunden`);
      // Sitemap liefert nur URLs, kein Standort. Wir können nicht ohne weitere Calls auf München filtern.
      // → Verzicht aus Performance-Gründen; nur loggen.
    }
  } catch (e) {
    debug.push(`  sitemap.xml → ${(e as Error).message}`);
  }

  // (3) Inline-JSON-Slots im HTML-Shell loggen (für nächste Diagnose-Runde)
  let shellHtml = '';
  try {
    shellHtml = await fetchText('https://jobs.knds.de/content/search/?locale=de_DE&pageSize=200');
  } catch { /* ignore */ }

  if (out.length === 0) {
    console.log(`  [debug KNDS] 0 Treffer (alle API/Sitemap-Strategien fehlgeschlagen):`);
    debug.forEach(d => console.log(d));
    if (shellHtml) {
      const slots = extractInlineJson(shellHtml);
      console.log(`  Shell-HTML: ${shellHtml.length} bytes, inline-JSON-Slots: ${slots.map(s => s.source).join(', ') || 'keine'}`);
    }
  }

  return out;
}

async function scrapeRohdeSchwarz(): Promise<JobInput[]> {
  // Die alte 207796.html liefert 404. Aktuelle bekannte Listing-URLs probieren.
  const candidates = [
    'https://www.rohde-schwarz.com/de/karriere/jobs/jobs_232562.html',
    'https://www.rohde-schwarz.com/de/karriere/stellenangebote/stellenangebote_55440.html',
    'https://www.rohde-schwarz.com/de/karriere/karriere_3692.html',
    'https://www.rohde-schwarz.com/de/karriere/jobs/karriere_207796.html',
  ];
  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      return await scrapeGenericHtml({
        company: 'Rohde & Schwarz',
        listingUrl: url,
        hrefPattern: /\/karriere\/(jobs?|stellenangebote)\/.+\.html$/i,
        defaultLocation: 'München',
        sourcePortal: 'rohde-html',
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('R&S: alle Listing-URL-Kandidaten lieferten Fehler');
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
  // Diehl-spezifischer Selector basierend auf der bekannten DOM-Struktur:
  //   <a class="distributor-link-item" href="...">
  //     <h.. class="headline">Titel</h..>
  //     <div class="item-header|item-footer|summary">... Standort ...</div>
  //   </a>
  // URL filtert server-seitig auf München + 25 km (deckt Ottobrunn, Gilching etc.).
  const listingUrl = 'https://www.diehl.com/career/de/jobs-bewerbung/stellenboerse/?c=de&location=M%C3%BCnchen&radius=25&lat=48.1351253&lng=11.5819806';
  const html = await fetchText(listingUrl);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];
  const seen = new Set<string>();

  // Primärselektor: die Card-Klasse, die wir aus den Computed Styles kennen.
  let cards = $('a.distributor-link-item, .distributor-link-item a[href]');
  // Fallback: falls Klasse umbenannt, suche nach typischen Job-href-Mustern.
  if (cards.length === 0) {
    cards = $('a[href*="/jobs-bewerbung/"], a[href*="/stellenboerse/"]');
  }

  cards.each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    if (/^#|^javascript:/.test(href)) return;
    const $card = $a.is('a.distributor-link-item') ? $a : $a.closest('.distributor-link-item, article, li');
    const title = ($card.find('.headline, h2, h3, h4').first().text() || $a.text()).trim().replace(/\s+/g, ' ');
    if (!title || title.length < 5) return;
    const locationCtx = $card.find('.item-header, .item-footer, .summary, [class*="location"], [class*="standort"]').text().trim().replace(/\s+/g, ' ');
    const url = href.startsWith('http') ? href : new URL(href, listingUrl).toString();
    if (seen.has(url)) return;
    seen.add(url);
    // URL ist bereits Munich-gefiltert → assumeLocation
    const job: JobInput = {
      company: 'Diehl',
      title,
      location: locationCtx || 'München',
      url,
      source_portal: 'diehl-html',
    };
    job.hash = hashJob(job);
    out.push(job);
  });

  if (out.length === 0) {
    console.log(`  [debug Diehl] 0 Treffer trotz neuer URL+Selector:`);
    console.log(`    HTML ${html.length} bytes`);
    console.log(`    a.distributor-link-item: ${$('a.distributor-link-item').length}`);
    console.log(`    .distributor-link-item: ${$('.distributor-link-item').length}`);
    console.log(`    a[href*="/jobs-bewerbung/"]: ${$('a[href*="/jobs-bewerbung/"]').length}`);
    console.log(`    a[href*="/stellenboerse/"]: ${$('a[href*="/stellenboerse/"]').length}`);
    const samples: string[] = [];
    $('a[href]').each((_, a) => { if (samples.length < 8) samples.push($(a).attr('href') || ''); });
    console.log(`    Erste 8 hrefs: ${samples.join(' | ')}`);
  }

  return out;
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

async function scrapeNeura(): Promise<JobInput[]> {
  // Neura nutzt das my-job-shop.com / talentsconnect Backend, das auf Typesense
  // (Open-Source-Suchengine) basiert. Direkt die Multi-Search-API ansprechen.
  // Der Scoped-Search-Key enthält am Ende einen base64-Filter:
  //   tenant_id:=neura-robotics && backoffice_vanity:=karriere && status:=ACTIVE
  // → der Key liefert von Haus aus nur Neura-Robotics Stellen.
  return scrapeTypesense({
    company: 'Neura Robotics',
    apiUrl: 'https://api.my-job-shop.com/api/typesense/multi_search?x-typesense-api-key=Y0xpcjhoMHpxMUZsOG1XSGxFOTRvc0F5Vkg0NDZOSEpsZ2d0ZzFES3haZz1QOXp4eyJmaWx0ZXJfYnkiOiJ0ZW5hbnRfaWQ6PW5ldXJhLXJvYm90aWNzJiZiYWNrb2ZmaWNlX3Zhbml0eTo9a2FycmllcmUmJnN0YXR1czo9QUNUSVZFIn0%3D',
    searchBody: {
      searches: [{
        collection: 'offers',
        exclude_fields: 'title_embed,description,expectation,introduction,about,offering,contact_text,additional,benefits',
        facet_by: 'department,location',
        highlight_full_fields: 'title,location,external_id,company,full_address,title_embed',
        max_facet_values: 1000,
        per_page: 50,
        q: '*',
        query_by: 'title,location,external_id,company,full_address,title_embed',
        sort_by: '_text_match:desc,title:asc,location_count:desc',
      }],
    },
    buildDetailUrl: (doc) => {
      // Beobachtete Detail-URL aus dem DOM:
      //   https://jobs.neura-robotics.com/de/offer-redirect/?offerApiId={base64(external_id)}&showApplicationForm=false
      // Falls external_id fehlt: auf vorhandene URL-Felder zurückfallen.
      if (typeof doc.url === 'string' && doc.url.startsWith('http')) return doc.url;
      if (typeof doc.permalink === 'string' && doc.permalink.startsWith('http')) return doc.permalink;
      const id = doc.external_id ?? doc.id ?? doc.slug;
      if (id == null) return null;
      const encoded = Buffer.from(String(id), 'utf8').toString('base64');
      return `https://jobs.neura-robotics.com/de/offer-redirect/?offerApiId=${encodeURIComponent(encoded)}&showApplicationForm=false`;
    },
    sourcePortal: 'typesense',
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
