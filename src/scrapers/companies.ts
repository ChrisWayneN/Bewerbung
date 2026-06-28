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
import { hashJob, isMunichArea, fetchText, fetchJson } from './base';
import { scrapeWorkday } from './portals/workday';
import { scrapePersonio } from './portals/personio';
import { scrapeGenericHtml } from './portals/genericHtml';
import { scrapeTalentsConnect } from './portals/talentsconnect';
import { scrapeTypesense } from './portals/typesense';
import { scrapeRecruitee } from './portals/recruitee';
import { discoverTypesenseUrl } from './discoverTypesenseKey';
import { scrapeSapCSB } from './portals/sapCSB';
import { extractInlineJson } from './inlineJson';

export interface CompanyMeta {
  name: string;
  careersUrl: string;
  portal: string;
  status: '✅' | '⚠️' | '❌';
  note?: string;
}

export const COMPANIES: CompanyMeta[] = [
  { name: 'KNDS',            careersUrl: 'https://jobs.knds.de/',                                portal: 'recruiting-solutions', status: '✅', note: 'recruiting-solutions.org (Azure Cog. Search) – POST production.api.recruiting-solutions.org/search mit customerId=knds-prod und Public x-api-key.' },
  { name: 'Rohde & Schwarz', careersUrl: 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html', portal: 'paulsjob-html',  status: '✅', note: 'paulsjob.ai-Backend, server-rendered. Pagination per &offset=N in 30er-Schritten (Lazy-Load).' },
  { name: 'IABG',            careersUrl: 'https://jobboerse.iabg.de/engage/jobexchange/showJobOfferList.do?j=myjobexchange', portal: 'engage', status: '✅', note: 'jobboerse.iabg.de (Engage-Servlet) – Liste unter showJobOfferList.do, <tr class=joboffer>' },
  { name: 'Agile Robots SE', careersUrl: 'https://agile-robots-se.jobs.personio.de/',            portal: 'personio',       status: '✅', note: 'Slug: agile-robots-se' },
  { name: 'Hensoldt',        careersUrl: 'https://jobs.hensoldt.net/search/?optionsFacetsDD_country=DE', portal: 'sap-sf-search', status: '✅', note: 'SAP SuccessFactors Career Search · Standorte Fürstenfeldbruck/Taufkirchen' },
  { name: 'Diehl',           careersUrl: 'https://www.diehl.com/career/de/jobs-bewerbung',       portal: 'successfactors', status: '⚠️', note: 'Diehl Stiftung – Plattform unklar, HTML-Fallback' },
  { name: 'Siemens',         careersUrl: 'https://jobs.siemens.com/',                            portal: 'phenom',         status: '✅', note: 'Phenom People JSON: /api/jobs' },
  { name: 'MTU',             careersUrl: 'https://www.mtu.de/careers/online-job-market/',        portal: 'html',           status: '✅', note: 'MTU Aero Engines – SSR-HTML, Server-Filter via URL /s/all/münchen_ger/all/professionals/. div.jobs-list__item ohne --filtered.' },
  { name: 'Airbus',          careersUrl: 'https://ag.wd3.myworkdayjobs.com/Airbus',              portal: 'workday',        status: '✅', note: 'wd3, tenant=ag, site=Airbus' },
  { name: 'Quantum Systems', careersUrl: 'https://career.quantum-systems.com/',                  portal: 'personio?',      status: '⚠️', note: 'Eigene Domain – probiert Personio-Slug "quantum-systems" und HTML-Fallback' },
  { name: 'Franka Robotics', careersUrl: 'https://franka-robotics.jobs.personio.de/',            portal: 'personio',       status: '✅', note: 'Tochter von Agile Robots, eigenes Personio' },
  { name: 'Neura Robotics',  careersUrl: 'https://jobs.neura-robotics.com/search',               portal: 'talentsconnect', status: '⚠️', note: 'talentsconnect AG – HTML-Scraping, HQ Metzingen' },
  { name: 'Helsing',         careersUrl: 'https://helsing.ai/de/jobs',                            portal: 'greenhouse',     status: '✅', note: 'boards-api.greenhouse.io/v1/boards/helsing/jobs. Greenhouse-Board hat kein department-Feld → nur Location-Filter (München).' },
  { name: 'Isar Aerospace',  careersUrl: 'https://job-boards.eu.greenhouse.io/isaraerospace?offices%5B%5D=4008032101', portal: 'greenhouse-eu', status: '✅', note: 'boards-api.eu.greenhouse.io/v1/boards/isaraerospace/jobs. Filter per Office-ID 4008032101 (München).' },
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
  // Hensoldt nutzt SAP SuccessFactors Career Search unter jobs.hensoldt.net.
  // Wir holen alle DE-Stellen (ohne Standort-Filter, damit Hensoldt-München-Standorte
  // wie Fürstenfeldbruck + Taufkirchen reinkommen) und lassen unseren Munich-Filter laufen.
  const baseUrl = 'https://jobs.hensoldt.net';
  const out: JobInput[] = [];
  const seen = new Set<string>();
  const pageSize = 25;

  for (let startrow = 0; startrow < 500; startrow += pageSize) {
    const url = `${baseUrl}/search/?createNewAlert=false&q=&optionsFacetsDD_country=DE&startrow=${startrow}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    const links = $('a.jobTitle-link, a[id*="jobTitle"]');
    if (!links.length) break;

    let pageAdded = 0;
    links.each((_, a) => {
      const $a = $(a);
      const href = $a.attr('href');
      if (!href) return;
      const title = $a.text().trim().replace(/\s+/g, ' ');
      if (!title) return;
      const row = $a.closest('tr, li, .data-row, .job-tile, .jobItem, article');
      const location = (
        row.find('.jobLocation, [class*="location" i]').first().text() ||
        row.text()
      ).trim().replace(/\s+/g, ' ');
      if (!isMunichArea(location)) return;
      const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      const job: JobInput = {
        company: 'Hensoldt',
        title,
        location,
        url: fullUrl,
        source_portal: 'sf-search',
      };
      job.hash = hashJob(job);
      out.push(job);
      pageAdded++;
    });

    if (links.length < pageSize) break;
    if (pageAdded === 0 && startrow > 0) break;
  }

  if (out.length === 0) {
    console.log(`  [debug Hensoldt] 0 Treffer:`);
    try {
      const dbgHtml = await fetchText(`${baseUrl}/search/?createNewAlert=false&q=&optionsFacetsDD_country=DE`);
      const $ = cheerio.load(dbgHtml);
      console.log(`    HTML ${dbgHtml.length} bytes · a.jobTitle-link: ${$('a.jobTitle-link').length} · alle a[href*="/job/"]: ${$('a[href*="/job/"]').length}`);
      const samples: string[] = [];
      $('a[href]').each((_, a) => { if (samples.length < 5) samples.push($(a).attr('href') || ''); });
      console.log(`    Erste hrefs: ${samples.join(' | ')}`);
    } catch (e) { console.log(`    HTML-Fetch fehlgeschlagen: ${(e as Error).message}`); }
  }

  return out;
}

async function scrapeAgileRobots(): Promise<JobInput[]> {
  return scrapePersonio({ company: 'Agile Robots SE', tenant: 'agile-robots-se', tld: 'de' });
}

async function scrapeFranka(): Promise<JobInput[]> {
  return scrapePersonio({ company: 'Franka Robotics', tenant: 'franka-robotics', tld: 'de' });
}

async function scrapeQuantum(): Promise<JobInput[]> {
  // Quantum Systems nutzt Recruitee mit Custom-Domain career.quantum-systems.com.
  // Recruitee Public API: /api/offers/ liefert alle Stellen als JSON.
  return scrapeRecruitee({
    company: 'Quantum Systems',
    tenant: 'quantum-systems',
    customDomain: 'career.quantum-systems.com',
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
  // KNDS' Portal jobs.knds.de ist eine SPA auf recruiting-solutions.org
  // (Azure Cognitive Search Backend). Public-Key-Auth: der x-api-key ist
  // ein Frontend-Search-Key, kein Geheimnis – wird vom Browser an alle
  // Besucher ausgeliefert. Falls KNDS ihn rotiert: neuen Key aus DevTools
  // (Network → POST production.api.recruiting-solutions.org/search →
  // Anfragekopfzeilen → x-api-key).
  const apiUrl = 'https://production.api.recruiting-solutions.org/search';
  const headers: Record<string, string> = {
    'accept': '*/*',
    'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
    'content-type': 'application/json;charset=UTF-8',
    'customerId': 'knds-prod',
    'x-api-key': 'pk_knds-prod_vQoHZUfidPgNIsDClPNzfoBaJvKnKpXCNtxVmSctXTwKEYCbjNuFAnAKcVoJpdpjEpuLDuxCTazaJMEODATzaVvrzWwaZNnb',
    'internal': 'false',
    'privateJobBoard': 'false',
    'origin': 'https://jobs.knds.de',
    'referer': 'https://jobs.knds.de/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
  };
  // Azure Cognitive Search OData: top=500 reicht (KNDS hat ~280 Stellen).
  // Kein Server-side Location-Filter – wir filtern client-side über
  // isMunichArea, was tolerant gegenüber Schreibvarianten und Vororten ist.
  const body = {
    count: true,
    facets: [],
    filter: 'datePosted lt 2099-12-31T00:00:00.000Z',
    search: '*',
    skip: 0,
    top: 500,
  };
  const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`KNDS HTTP ${res.status}`);
  const data: Record<string, unknown> = await res.json();
  const items: Record<string, unknown>[] = ((data.value ?? data.results ?? data.items ?? data.jobs) as Record<string, unknown>[]) ?? [];

  const out: JobInput[] = [];
  const seen = new Set<string>();
  let munichMatches = 0;

  for (const it of items) {
    const title = String((it.title ?? it.jobTitle ?? it.name ?? '') as string).trim();
    if (!title) continue;

    // addresses ist eine Collection von {name, ...}. Mehrere Standorte je Stelle möglich.
    const addresses = Array.isArray(it.addresses) ? it.addresses as Array<Record<string, unknown>> : [];
    const locArr = addresses.map(a => String(a.name ?? a.city ?? '')).filter(Boolean);
    const locationStr = locArr.join(', ');
    if (!isMunichArea(locationStr)) continue;
    munichMatches++;

    const id = it.id ?? it.jobId ?? it.requisitionId ?? it.externalId;
    let url: string;
    const navigateLink = (it.url ?? it.applyUrl ?? it.detailUrl ?? it.navigateLink ?? it.permalink) as string | undefined;
    if (typeof navigateLink === 'string' && navigateLink.length > 0) {
      url = navigateLink.startsWith('http') ? navigateLink : new URL(navigateLink, 'https://jobs.knds.de').toString();
    } else if (id != null) {
      url = `https://jobs.knds.de/content/job/${id}/`;
    } else {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const munichLoc = locArr.find(l => /münchen|munich/i.test(l)) ?? 'München';
    const job: JobInput = {
      company: 'KNDS',
      title,
      location: munichLoc,
      url,
      source_portal: 'knds-rs',
    };
    job.hash = hashJob(job);
    out.push(job);
  }

  if (out.length === 0) {
    console.log(`  [debug KNDS] 0 Treffer:`);
    console.log(`    API lieferte ${items.length} Stellen · ${munichMatches} München-Match · keine URL → 0 Output`);
    if (items.length > 0) {
      const sample = items[0];
      console.log(`    Erste-Stelle-Keys: ${Object.keys(sample).join(', ')}`);
      console.log(`    Erste-Stelle: ${JSON.stringify(sample).slice(0, 700)}`);
    } else {
      console.log(`    Antwort-Keys: ${Object.keys(data).join(', ')}`);
      console.log(`    Antwort-Auszug: ${JSON.stringify(data).slice(0, 400)}`);
    }
  }
  return out;
}

async function scrapeRohdeSchwarz(): Promise<JobInput[]> {
  // R&S rendert die Stellen-Liste als Accordion-Items, paginiert per &offset=N
  // in 30er-Schritten (Lazy-Load beim Scrollen ruft dieselbe HTML-URL mit
  // anderem offset auf). Pro Batch: 30 Items im DOM, Stopp wenn nichts Neues.
  const baseUrl = 'https://www.rohde-schwarz.com/de/karriere/stellenangebote/karriere-stellenangebote_251573.html';
  const filterParams = '?term&filter%5BrsCountry%5D%5B%5D=Deutschland&filter%5BrsCity%5D%5B%5D=M%C3%BCnchen';
  const out: JobInput[] = [];
  const seen = new Set<string>();
  const batchSize = 30;
  const maxOffset = 600;

  for (let offset = 0; offset <= maxOffset; offset += batchSize) {
    const url = offset === 0 ? `${baseUrl}${filterParams}` : `${baseUrl}${filterParams}&offset=${offset}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    // Nur Job-Accordions: enthalten data-job-id (Favoriten-Button).
    // Schließt Filter-Sidebar-Accordions wie "Stadt/Region" und "Standort" aus.
    const items = $('div.module-accordion[data-view="accordion-item"], div.module-accordion.accordion-item')
      .filter((_, el) => $(el).find('[data-job-id]').length > 0);
    if (!items.length) break;
    const addedBefore = out.length;
    parseAccordions($, items, listingUrl(), out, seen);
    const addedThisBatch = out.length - addedBefore;
    if (addedThisBatch === 0) break;
  }

  return out;

  function listingUrl(): string { return `${baseUrl}${filterParams}`; }
}

function parseAccordions(
  $: cheerio.CheerioAPI,
  items: cheerio.Cheerio<any>,
  listingUrl: string,
  out: JobInput[],
  seen: Set<string>,
): void {
  items.each((_, el) => {
    const $item = $(el);
    const $title = $item.find('.title').first();

    // Titel ohne den eingebetteten Mobile-Info-Block (favorite-Button etc.)
    const titleClone = $title.clone();
    titleClone.find('div, span, a').remove();
    const title = titleClone.text().trim().replace(/\s+/g, ' ');
    if (!title || title.length < 5) return;

    let url: string | null = null;

    // Strategie 1: data-job-id (im favorite-Link, eindeutige Stellen-ID von R&S)
    const jobId = $item.find('[data-job-id]').first().attr('data-job-id');
    if (jobId) {
      url = `${listingUrl}#job-${jobId}`;
    }

    // Strategie 2: echter Detail-/Apply-Link
    if (!url) {
      $item.find('a[href]').each((_, a) => {
        const href = $(a).attr('href');
        if (!href || /^(#|javascript:|mailto:)/.test(href)) return;
        url = href.startsWith('http') ? href : new URL(href, listingUrl).toString();
        return false;
      });
    }

    // Strategie 3: Heading-Fragment
    if (!url) {
      const headingId = $title.attr('id') || $item.find('[id^="jobboard-search-table-heading"]').attr('id');
      if (headingId) url = `${listingUrl}#${headingId}`;
    }

    if (!url || seen.has(url)) return;
    seen.add(url);

    const job: JobInput = {
      company: 'Rohde & Schwarz',
      title,
      location: 'München',
      url,
      source_portal: 'rohde-html',
    };
    job.hash = hashJob(job);
    out.push(job);
  });

  // Zusätzlich echte Job-Detail-Links (eigene .html-Seiten je Stelle).
  // Ausschluss: die Listing-Datei selbst (UI-Links wie "Alle Favoriten
  // anzeigen" / "Change your location" zeigen mit anderen Query-Params
  // auf dieselbe karriere-stellenangebote_251573.html).
  const listingFile = 'karriere-stellenangebote_251573';
  const linkPattern = /\/karriere\/stellenangebote\/[a-z0-9-]+(?:_\d+)?\.html/i;
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href || !linkPattern.test(href) || href.includes(listingFile)) return;
    const title = $a.text().trim().replace(/\s+/g, ' ');
    if (!title || title.length < 5) return;
    const fullUrl = href.startsWith('http') ? href : new URL(href, listingUrl).toString();
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);
    const job: JobInput = {
      company: 'Rohde & Schwarz',
      title,
      location: 'München',
      url: fullUrl,
      source_portal: 'rohde-html',
    };
    job.hash = hashJob(job);
    out.push(job);
  });
}

async function scrapeIABG(): Promise<JobInput[]> {
  // IABG nutzt das Engage-Jobbörsen-System. Stellen-Liste steht unter
  // showJobOfferList.do (searchJobOffersQuick.do ist nur die Such-Maske
  // ohne Liste und liefert daher nur UI-Links wie "Initiativbewerbung",
  // "Offene Stellen", "English"). Jobs sind <tr class="joboffer"> mit
  // <a href="showJobOfferDetail.do?jobOfferId=...">Titel</a>.
  return scrapeGenericHtml({
    company: 'IABG',
    listingUrl: 'https://jobboerse.iabg.de/engage/jobexchange/showJobOfferList.do?j=myjobexchange',
    // Hinweis: zwischen .do und ?jobOfferId= steht oft ;jsessionid=...
    hrefPattern: /showJobOfferDetail\.do[^?]*\?jobOfferId=/i,
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
  // MTU rendert ALLE Job-Items server-seitig ins HTML, unabhängig vom
  // URL-Filter. Die .jobs-list__item--filtered-Klasse wird erst per JS
  // beim Anwenden der UI-Filter gesetzt – im rohen SSR-HTML ist sie noch
  // nicht da, also können wir nicht über die Klasse filtern.
  //
  // Verlässlich sind die data-Attribute jedes Items:
  //   data-location="münchen_ger" oder "münchen_ger,starnberg_ger"
  //   data-target-group="professionals" | "students" | …
  // Darüber filtern wir clientseitig.
  const listingUrl = 'https://www.mtu.de/careers/online-job-market/s/all/m%C3%BCnchen_ger/all/professionals/';
  const html = await fetchText(listingUrl);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];
  const seen = new Set<string>();
  let totalItems = 0;
  let skippedLoc = 0;
  let skippedGroup = 0;

  $('div.jobs-list__item').each((_, el) => {
    totalItems++;
    const $el = $(el);
    const dataLoc = ($el.attr('data-location') ?? '').toLowerCase();
    const dataGroup = ($el.attr('data-target-group') ?? '').toLowerCase();

    // Mehrfach-Standorte sind komma-separiert ("münchen_ger,starnberg_ger").
    if (!dataLoc.split(',').some(l => l.trim() === 'münchen_ger')) { skippedLoc++; return; }
    if (dataGroup !== 'professionals') { skippedGroup++; return; }

    const title = ($el.attr('data-title') || $el.find('h3.jobs-list__title').first().text() || '')
      .trim().replace(/\s+/g, ' ');
    const href = $el.find('a.jobs-list__item_anchor').first().attr('href');
    if (!title || !href) return;

    const url = href.startsWith('http') ? href : new URL(href, listingUrl).toString();
    if (seen.has(url)) return;
    seen.add(url);

    const job: JobInput = {
      company: 'MTU',
      title,
      location: 'München',
      url,
      source_portal: 'mtu-html',
    };
    job.hash = hashJob(job);
    out.push(job);
  });

  if (out.length === 0) {
    console.log(`  [debug MTU] 0 Treffer: ${totalItems} Items, ${skippedLoc} kein münchen_ger, ${skippedGroup} kein professionals.`);
  }
  return out;
}

// Hardcoded letzte bekannte URL als allerletzter Fallback. Wird nur genutzt
// wenn HTML/JS-Discovery und scraper-secrets.json beide nichts liefern.
const NEURA_TYPESENSE_FALLBACK = 'https://api.my-job-shop.com/api/typesense/multi_search?x-typesense-api-key=LzVtSVA3dU5nK2Q5ck5oRklpTnBYdDhUaXZEMnFjY1hYaEdrU2hIQytBUT1sejlxeyJmaWx0ZXJfYnkiOiJ0ZW5hbnRfaWQ6PW5ldXJhLXJvYm90aWNzJiZiYWNrb2ZmaWNlX3Zhbml0eTo9a2FycmllcmUmJnN0YXR1czo9QUNUSVZFIn0%3D';

async function scrapeNeura(): Promise<JobInput[]> {
  // Selbstheilend: Discovery holt den aktuellen Scoped-Key aus dem HTML/JS-Bundle
  // der Search-Seite, fällt sonst auf scraper-secrets.json oder den Fallback zurück.
  const apiUrl = await discoverTypesenseUrl({
    pageUrl: 'https://jobs.neura-robotics.com/search',
    secretsKey: 'neuraTypesenseUrl',
    hardcodedFallback: NEURA_TYPESENSE_FALLBACK,
  });
  return scrapeTypesense({
    company: 'Neura Robotics',
    apiUrl,
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

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string } | null;
  offices?: Array<{ id?: number; name?: string; location?: string }>;
  departments?: Array<{ name?: string }>;
  company_name?: string;
  requisition_id?: string | null;
}

async function scrapeHelsing(): Promise<JobInput[]> {
  // Helsing's eigene Karriere-Seite (helsing.ai/de/jobs) ist Next.js hinter
  // Cloudflare und fingerprinted Node's TLS-Handshake → 429. Aber die Daten
  // kommen ohnehin aus Greenhouse. Direkt die öffentliche Greenhouse-Board-
  // API anzapfen ist sauberer: kein Cloudflare, stabiles JSON-Schema.
  //
  // Hinweis zu Filtern: Helsing's Greenhouse-Board exposed KEIN
  // department/category-Feld – die "Job-Familien", die auf der helsing.ai-
  // Seite als Type-Filter angezeigt werden, kommen nicht über die API mit.
  // Daher hier nur Location-Filter (München, alle Schreibweisen).
  const apiUrl = 'https://boards-api.greenhouse.io/v1/boards/helsing/jobs';
  const data = await fetchJson<{ jobs: GreenhouseJob[] }>(apiUrl);
  const jobs = data.jobs ?? [];

  const out: JobInput[] = [];
  const seen = new Set<string>();
  let locFiltered = 0;

  for (const j of jobs) {
    const locationNames = [
      j.location?.name ?? '',
      ...(j.offices ?? []).flatMap(o => [o.name ?? '', o.location ?? '']),
    ].filter(Boolean);
    const isMunich = locationNames.some(l => /münchen|munich/i.test(l));
    if (!isMunich) { locFiltered++; continue; }

    // helsing.ai/de/jobs/{id} ist die Branding-URL. id matcht Greenhouse-id.
    const url = `https://helsing.ai/de/jobs/${j.id}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const munichLoc = locationNames.find(l => /münchen|munich/i.test(l)) ?? 'München';
    const job: JobInput = {
      company: 'Helsing',
      title: j.title.trim().replace(/\s+/g, ' '),
      location: munichLoc,
      url,
      source_portal: 'helsing-greenhouse',
    };
    job.hash = hashJob(job);
    out.push(job);
  }

  if (out.length === 0) {
    console.log(`  [debug Helsing] 0 Treffer: Greenhouse lieferte ${jobs.length} Jobs, ${locFiltered} fielen am München-Filter.`);
  }
  return out;
}

async function scrapeIsarAerospace(): Promise<JobInput[]> {
  // Isar Aerospace nutzt Greenhouse mit EU-Tenant (job-boards.eu.greenhouse.io).
  // Karriere-URL filtert per Query offices[]=4008032101 — das ist der München-Office.
  // Wir holen alle Stellen und filtern lokal nach Office-ID; fällt das (z.B. weil
  // die API offices ohne id liefert) durch, greift der Munich-Substring-Filter.
  const MUNICH_OFFICE_ID = 4008032101;
  const apiUrl = 'https://boards-api.eu.greenhouse.io/v1/boards/isaraerospace/jobs';
  const data = await fetchJson<{ jobs: GreenhouseJob[] }>(apiUrl);
  const jobs = data.jobs ?? [];

  const out: JobInput[] = [];
  const seen = new Set<string>();
  let officeFiltered = 0;
  let locFiltered = 0;

  for (const j of jobs) {
    const officeIds = (j.offices ?? []).map(o => o.id).filter((x): x is number => typeof x === 'number');
    const officeMatchPossible = officeIds.length > 0;
    const officeHit = officeIds.includes(MUNICH_OFFICE_ID);

    const locationNames = [
      j.location?.name ?? '',
      ...(j.offices ?? []).flatMap(o => [o.name ?? '', o.location ?? '']),
    ].filter(Boolean);
    const isMunich = locationNames.some(l => isMunichArea(l));

    if (officeMatchPossible) {
      if (!officeHit) { officeFiltered++; continue; }
    } else if (!isMunich) {
      locFiltered++;
      continue;
    }

    const url = j.absolute_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const munichLoc = locationNames.find(l => isMunichArea(l)) ?? 'München';
    const job: JobInput = {
      company: 'Isar Aerospace',
      title: j.title.trim().replace(/\s+/g, ' '),
      location: munichLoc,
      url,
      source_portal: 'greenhouse-eu',
    };
    job.hash = hashJob(job);
    out.push(job);
  }

  if (out.length === 0) {
    console.log(`  [debug Isar Aerospace] 0 Treffer: Greenhouse lieferte ${jobs.length} Jobs, ${officeFiltered} fielen am Office-Filter, ${locFiltered} am Munich-Fallback.`);
  }
  return out;
}

/* ---------------- Public registry ---------------- */

export const scrapers: Scraper[] = [
  { company: 'Airbus',          run: wrap('Airbus',          scrapeAirbus) },
  { company: 'Hensoldt',        run: wrap('Hensoldt',        scrapeHensoldt) },
  { company: 'Agile Robots SE', run: wrap('Agile Robots SE', scrapeAgileRobots) },
  { company: 'Franka Robotics', run: wrap('Franka Robotics', scrapeFranka) },
  { company: 'Quantum Systems', run: wrap('Quantum Systems', scrapeQuantum) },
  { company: 'Neura Robotics',  run: wrap('Neura Robotics',  scrapeNeura) },
  { company: 'Siemens',         run: wrap('Siemens',         scrapeSiemens) },
  { company: 'KNDS',            run: wrap('KNDS',            scrapeKNDS) },
  { company: 'Rohde & Schwarz', run: wrap('Rohde & Schwarz', scrapeRohdeSchwarz) },
  { company: 'IABG',            run: wrap('IABG',            scrapeIABG) },
  { company: 'Diehl',           run: wrap('Diehl',           scrapeDiehl) },
  { company: 'MTU',             run: wrap('MTU',             scrapeMTU) },
  { company: 'Helsing',         run: wrap('Helsing',         scrapeHelsing) },
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
