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
  { name: 'Hensoldt',        careersUrl: 'https://jobs.hensoldt.net/search/?optionsFacetsDD_country=DE&optionsFacetsDD_customfield2=Engineering&optionsFacetsDD_customfield1=Professionals', portal: 'sap-sf-search', status: '✅', note: 'SAP SuccessFactors, job-tile-DOM. Facetten: country=DE + Engineering (customfield2) + Professionals (customfield1); Standort clientseitig via isMunichArea (Fürstenfeldbruck/Taufkirchen/Ottobrunn). Filter anpassbar über customfield1/2.' },
  { name: 'Diehl',           careersUrl: 'https://www.diehl.com/career/de/jobs-bewerbung',       portal: 'successfactors', status: '⚠️', note: 'Diehl Stiftung – Plattform unklar, HTML-Fallback' },
  { name: 'Siemens',         careersUrl: 'https://jobs.siemens.com/en_US/externaljobs/SearchJobs', portal: 'avature-html',   status: '✅', note: 'Avature SSR-HTML. GET mit echten Location-Facet-IDs (Country=Germany/812132, State=Bavaria/813141, City=München/912803) aus Browser-Netzwerk-Analyse, plus isMunichArea()-Filter auf list-item-jobCity. IDs sind Avature-intern und können bei Siemens-Konfig-Änderung rotieren.' },
  { name: 'MTU',             careersUrl: 'https://www.mtu.de/careers/online-job-market/',        portal: 'html',           status: '✅', note: 'MTU Aero Engines – SSR-HTML, Server-Filter via URL /s/all/münchen_ger/all/professionals/. div.jobs-list__item ohne --filtered.' },
  { name: 'Airbus',          careersUrl: 'https://ag.wd3.myworkdayjobs.com/de-DE/Airbus?locationCountry=dcc5b7608d8644b3a93716604e78e995&locations=f5811cef9cb501a49eac0a694c0a8244&jobFamilyGroup=f5811cef9cb5018463377f3f550a1bf2&jobFamilyGroup=f5811cef9cb501e5d34e803f550a21f2', portal: 'workday', status: '✅', note: 'wd3, tenant=ag, site=Airbus. Server-seitige appliedFacets: München-Standort + 2 bewusst gewählte Job-Familien (nicht alle Kategorien).' },
  { name: 'Quantum Systems', careersUrl: 'https://career.quantum-systems.com/',                  portal: 'personio?',      status: '⚠️', note: 'Eigene Domain – probiert Personio-Slug "quantum-systems" und HTML-Fallback' },
  { name: 'Franka Robotics', careersUrl: 'https://franka-robotics.jobs.personio.de/',            portal: 'personio',       status: '✅', note: 'Tochter von Agile Robots, eigenes Personio' },
  { name: 'Neura Robotics',  careersUrl: 'https://jobs.neura-robotics.com/search',               portal: 'talentsconnect', status: '⚠️', note: 'talentsconnect AG – HTML-Scraping, HQ Metzingen' },
  { name: 'Helsing',         careersUrl: 'https://helsing.ai/de/jobs',                            portal: 'greenhouse',     status: '✅', note: 'boards-api.greenhouse.io/v1/boards/helsing/jobs. Greenhouse-Board hat kein department-Feld → nur Location-Filter (München).' },
  { name: 'Isar Aerospace',  careersUrl: 'https://job-boards.eu.greenhouse.io/isaraerospace?offices%5B%5D=4008032101', portal: 'greenhouse-html-eu', status: '✅', note: 'Greenhouse-Job-Board (job-boards.eu.greenhouse.io), SSR-HTML mit Pagination ?page=N und Server-Filter ?offices[]=4008032101. Die klassische boards-api kennt das Board nicht.' },
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
  // Facet-IDs aus der Browser-Netzwerk-Analyse der gefilterten Karriereseite:
  // Standort München (Germany + spezifischer Standort) + zwei Job-Familien
  // (bewusst gewählt, nicht "alle Kategorien" wie bei anderen Firmen).
  return scrapeWorkday({
    company: 'Airbus',
    tenant: 'ag',
    wd: 3,
    site: 'Airbus',
    appliedFacets: {
      locationCountry: ['dcc5b7608d8644b3a93716604e78e995'],
      locations: ['f5811cef9cb501a49eac0a694c0a8244'],
      jobFamilyGroup: ['f5811cef9cb5018463377f3f550a1bf2', 'f5811cef9cb501e5d34e803f550a21f2'],
    },
  }, true);
}

async function scrapeHensoldt(): Promise<JobInput[]> {
  // Hensoldt nutzt SAP SuccessFactors (jobs.hensoldt.net) mit "job-tile"-DOM.
  // Server-seitige Facetten (aus der gefilterten Karriereseite-URL des Nutzers):
  // country=DE + Berufsfeld Engineering (customfield2) + Level Professionals
  // (customfield1). Standort wird BEWUSST nicht server-seitig gesetzt, damit
  // alle Münchner Hensoldt-Standorte (Taufkirchen, Ottobrunn, Fürstenfeldbruck …)
  // reinkommen; isMunichArea() filtert danach clientseitig.
  //
  // Zwei DOM-Fallen, die per inspect-hensoldt bestätigt wurden:
  //   • Jede Kachel steht 3× im HTML (Desktop/Tablet/Mobile-Layout) → über
  //     li.job-tile iterieren (1× pro Job) statt über a.jobTitle-link (3×).
  //   • Der Ortswert steht sauber im [id*="-multilocation-value"]-Div; das
  //     umgebende .multilocation enthält zusätzlich das Label "Locations".
  // Kein pageAdded===0-Abbruch mehr: mit Berufsfeld-Filter kann eine ganze
  // Seite ohne München-Treffer vorkommen (z.B. lauter Ulm) – trotzdem
  // weiterblättern, sonst gehen spätere Münchner Stellen verloren.
  const baseUrl = 'https://jobs.hensoldt.net';
  const facets =
    'createNewAlert=false&q=' +
    '&optionsFacetsDD_country=DE' +
    '&optionsFacetsDD_customfield2=Engineering' +
    '&optionsFacetsDD_customfield1=Professionals';
  const out: JobInput[] = [];
  const seen = new Set<string>();
  const pageSize = 25;

  for (let startrow = 0; startrow < 1000; startrow += pageSize) {
    const url = `${baseUrl}/search/?${facets}&startrow=${startrow}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    const tiles = $('li.job-tile');
    if (!tiles.length) break;

    tiles.each((_, el) => {
      const $tile = $(el);
      const dataUrl = $tile.attr('data-url') || $tile.find('a.jobTitle-link').first().attr('href') || '';
      if (!dataUrl) return;
      const fullUrl = dataUrl.startsWith('http') ? dataUrl : new URL(dataUrl, baseUrl).toString();
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);

      const title = $tile.find('a.jobTitle-link').first().text().trim().replace(/\s+/g, ' ');
      if (!title) return;

      // Sauberer Ortswert aus dem -value-Div (ohne "Locations"-Label davor).
      const location = (
        $tile.find('[id*="-multilocation-value"]').first().text() ||
        $tile.find('.multilocation').first().text().replace(/^\s*Locations\s*/i, '')
      ).trim().replace(/\s+/g, ' ');
      if (!isMunichArea(location)) return;

      const job: JobInput = {
        company: 'Hensoldt',
        title,
        location,
        url: fullUrl,
        source_portal: 'sf-search',
      };
      job.hash = hashJob(job);
      out.push(job);
    });

    if (tiles.length < pageSize) break;
  }

  if (out.length === 0) {
    console.log(`  [debug Hensoldt] 0 Treffer – Facetten/DOM per "npm run inspect-hensoldt" prüfen.`);
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

const SIEMENS_SEARCH_URL = 'https://jobs.siemens.com/en_US/externaljobs/SearchJobs';

/** Siemens (Avature, SSR-HTML). Die Volltextsuche nach "München"/"Munich"
 *  lieferte zu viele False-Positives (Stellen, die den Ort nur im
 *  Übersetzungstext erwähnen, aber woanders sind). Robuster: die echten
 *  Location-Facet-IDs verwenden, die aus der Browser-Netzwerk-Analyse
 *  stammen (Country=Germany/812132, State=Bavaria/813141, City=München/
 *  912803) – Avature unterstützt GET mit diesen Query-Params direkt
 *  (kein POST/Session-State nötig). "Field of work" und "Experience Level"
 *  werden bewusst weggelassen, um wie bei den anderen Firmen ALLE Münchner
 *  Stellen zu bekommen statt nur bestimmte Kategorien/Level.
 *  Falls Siemens die IDs mal rotiert: neue URL per DevTools (Netzwerk-
 *  Analyse) beim manuellen Filtern auf München nachschauen und die drei
 *  Facet-IDs unten ersetzen. */
async function scrapeSiemens(): Promise<JobInput[]> {
  const params = new URLSearchParams({
    '42386': '[812132]', // Country: Germany
    '42386_format': '17546',
    '42387': '[813141]', // State: Bavaria
    '42387_format': '17547',
    '42388': '[912803]', // City: München
    '42388_format': '17879',
    listFilterMode: '1',
    folderRecordsPerPage: '100',
  });
  const url = `${SIEMENS_SEARCH_URL}/?${params.toString()}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];
  $('article.article--result').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a.link[href*="JobDetail"]').first();
    const href = a.attr('href');
    const title = a.text().trim().replace(/\s+/g, ' ');
    const city = $el.find('.list-item-jobCity').first().text().trim();
    if (!href || !title) return;
    const job: JobInput = {
      company: 'Siemens',
      title,
      location: city || 'München',
      url: href,
      source_portal: 'avature-html',
    };
    job.hash = hashJob(job);
    out.push(job);
  });
  if (out.length === 0) {
    console.log(`  [debug Siemens] 0 Treffer über Facet-URL – IDs evtl. rotiert, HTML-Länge: ${html.length}`);
  }
  return out.filter(j => isMunichArea(j.location));
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

/** Nuxt-Payload-Format: Array wo Objekte ihre Value als Index-Referenz halten.
 *  `{"tenantId": 346}` bedeutet: der eigentliche Wert steht an payload[346].
 *  Diese Funktion findet den ersten Key mit gegebenem Namen und resolved den Ref. */
function resolveNuxtPayloadValue(payload: unknown[], key: string): string | null {
  for (const el of payload) {
    if (el && typeof el === 'object' && !Array.isArray(el) && key in (el as Record<string, unknown>)) {
      const raw = (el as Record<string, unknown>)[key];
      if (typeof raw === 'string') return raw; // Selten: direkter String-Wert
      if (typeof raw === 'number' && raw >= 0 && raw < payload.length) {
        const target = payload[raw];
        if (typeof target === 'string') return target;
      }
    }
  }
  return null;
}

async function scrapeNeura(): Promise<JobInput[]> {
  // Neuer Neura-Aufbau (Stand nach Frontend-Umbau auf api.my-job-shop.com):
  //   1. HTML der Karriere-Seite fetchen; darin __NUXT_DATA__ als JSON-Payload.
  //      Payload enthält jobShopId (UUID), tenantId (UUID), jobShopCompanyVanity.
  //      Werte stehen als Index-Referenzen: {"tenantId": 346} → payload[346].
  //   2. POST /api/offer/v1/search/api-key?filter=backoffice_vanity:<vanity>
  //      mit Header X-Tenant-Id → liefert einen frischen Typesense-Key.
  //   3. POST /api/typesense/multi_search mit Headers X-Tenant-Id,
  //      X-JobShop-Id, X-Typesense-Api-Key (Key NICHT mehr Query-Param).
  const PAGE = 'https://jobs.neura-robotics.com/search';
  const html = await fetchText(PAGE);

  // Nuxt-Payload aus <script id="__NUXT_DATA__" type="application/json">[…]</script>
  const payloadMatch = html.match(/<script[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  let payload: unknown[] | null = null;
  if (payloadMatch) {
    try {
      const parsed = JSON.parse(payloadMatch[1]);
      if (Array.isArray(parsed)) payload = parsed;
    } catch { /* Payload nicht parsbar */ }
  }

  // jobShopId: primär aus dem Payload, sonst aus dem "typesenseApiKey-<UUID>"-String
  let jobShopId = payload ? resolveNuxtPayloadValue(payload, 'jobShopId') : null;
  if (!jobShopId) {
    const m = html.match(/typesenseApiKey-([a-f0-9-]{36})/);
    jobShopId = m?.[1] ?? null;
  }
  if (!jobShopId) throw new Error('Neura: jobShopId nicht im HTML gefunden');

  // tenantId: nur via Payload-Ref-Resolving auffindbar (im Nuxt-Payload als Zahl)
  const tenantId = payload ? resolveNuxtPayloadValue(payload, 'tenantId') : null;
  if (!tenantId) throw new Error('Neura: tenantId (UUID) nicht via Nuxt-Payload gefunden');

  // vanity: primär Payload, dann Fallbacks
  let vanity = payload ? resolveNuxtPayloadValue(payload, 'jobShopCompanyVanity') : null;
  if (!vanity) {
    const m = html.match(/backoffice_vanity:=?"?([a-zA-Z0-9_-]+)/);
    vanity = m?.[1] ?? 'karriere';
  }

  const keyUrl = `https://api.my-job-shop.com/api/offer/v1/search/api-key?filter=${encodeURIComponent(`backoffice_vanity:${vanity}`)}`;
  const keyRes = await fetch(keyUrl, {
    headers: {
      accept: 'application/json',
      'x-tenant-id': tenantId,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
      origin: 'https://jobs.neura-robotics.com',
      referer: 'https://jobs.neura-robotics.com/',
    },
  });
  if (!keyRes.ok) {
    const body = await keyRes.text().catch(() => '');
    throw new Error(`Neura Key-Endpoint HTTP ${keyRes.status}${body ? ' – ' + body.slice(0, 200) : ''}`);
  }
  const keyPayload = (await keyRes.json()) as any;
  const apiKey: string | undefined =
    keyPayload?.key ?? keyPayload?.data?.key ?? keyPayload?.data?.apiKey ?? keyPayload?.apiKey;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error(`Neura Key-Endpoint: kein Key im Response (${JSON.stringify(keyPayload).slice(0, 200)})`);
  }

  return scrapeTypesense({
    company: 'Neura Robotics',
    apiUrl: 'https://api.my-job-shop.com/api/typesense/multi_search',
    extraHeaders: {
      'x-tenant-id': tenantId,
      'x-jobshop-id': jobShopId,
      'x-typesense-api-key': apiKey,
    },
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
      if (typeof doc.url === 'string' && doc.url.startsWith('http')) return doc.url;
      if (typeof doc.permalink === 'string' && doc.permalink.startsWith('http')) return doc.permalink;
      const id = doc.external_id ?? doc.id ?? doc.slug;
      if (id == null) return null;
      const encoded = Buffer.from(String(id), 'utf8').toString('base64');
      return `https://jobs.neura-robotics.com/de/offer-redirect/?offerApiId=${encodeURIComponent(encoded)}&showApplicationForm=false`;
    },
    sourcePortal: 'typesense-hdr',
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
  // Isar nutzt Greenhouse's neues Job-Board-System (job-boards.eu.greenhouse.io,
  // SSR-HTML, Pagination per ?page=N). Die klassische boards-api.greenhouse.io
  // kennt das Board nicht (fetch failed). Daher HTML-Scrape — der ?offices[]=…
  // Query wird serverseitig ausgewertet, wir bekommen nur München-Stellen.
  //
  // DOM-Struktur pro Job:
  //   <tr class="job-post"><td class="cell">
  //     <a href="…/isaraerospace/jobs/<id>" target="_top">
  //       <p class="body body--medium">Title (m/f/d)</p>
  //       <p class="body body__secondary body--metadata">Ottobrunn, Bavaria, Germany</p>
  //     </a>
  //   </td></tr>
  const baseUrl = 'https://job-boards.eu.greenhouse.io/isaraerospace';
  const officeQuery = 'offices%5B%5D=4008032101';
  const out: JobInput[] = [];
  const seen = new Set<string>();
  let totalJobsHeader: number | null = null;

  for (let page = 1; page <= 20; page++) {
    const url = `${baseUrl}?${officeQuery}&page=${page}`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const $ = cheerio.load(html);

    if (page === 1) {
      const m = $('h2[data-testid="job-count-header"]').first().text().match(/(\d+)/);
      if (m) totalJobsHeader = Number(m[1]);
    }

    const rows = $('tr.job-post');
    if (!rows.length) break;

    let pageAdded = 0;
    rows.each((_, tr) => {
      const $tr = $(tr);
      const a = $tr.find('td.cell a').first();
      const href = a.attr('href');
      if (!href) return;
      const title = a.find('p.body--medium').first().text().trim().replace(/\s+/g, ' ');
      const location = a.find('p.body--metadata').first().text().trim().replace(/\s+/g, ' ');
      if (!title) return;
      const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      const job: JobInput = {
        company: 'Isar Aerospace',
        title,
        location: location || 'München',
        url: fullUrl,
        source_portal: 'greenhouse-html-eu',
      };
      job.hash = hashJob(job);
      out.push(job);
      pageAdded++;
    });

    if (pageAdded === 0) break;
    if (totalJobsHeader !== null && out.length >= totalJobsHeader) break;
  }

  if (out.length === 0) {
    console.log(`  [debug Isar Aerospace] 0 Treffer auf HTML-Listing (Header sagte ${totalJobsHeader ?? '?'} Jobs).`);
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
