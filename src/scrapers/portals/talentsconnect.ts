import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractSectionsFromHtml } from '../extract';

/**
 * talentsconnect-AG-hosted careers pages (z. B. jobs.neura-robotics.com).
 * Strategie: HTML der Suchseite parsen — kein offizielles JSON-API bekannt.
 */
export interface TalentsConnectConfig {
  company: string;
  baseUrl: string; // z. B. "https://jobs.neura-robotics.com"
}

export async function scrapeTalentsConnect(cfg: TalentsConnectConfig): Promise<JobInput[]> {
  const searchUrl = `${cfg.baseUrl.replace(/\/$/, '')}/search`;
  const html = await fetchText(searchUrl);
  const $ = cheerio.load(html);
  const out: JobInput[] = [];

  // Verifizierte talentsconnect DOM-Struktur (jobs.neura-robotics.com):
  //   <a data-type="offer" class="item" href="https://.../offer/{slug}/{uuid}">
  //     <span class="h3">Titel</span>
  //     <span class="p cityNames">Munich</span>
  //   </a>
  let anchorsTotal = 0;
  let withOffer = 0;
  let withTitle = 0;
  let withMunich = 0;
  const sampleLocations: string[] = [];

  $('a[data-type="offer"], a[href*="/offer/"]').each((_, a) => {
    anchorsTotal++;
    withOffer++;
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;
    const url = href.startsWith('http') ? href : new URL(href, cfg.baseUrl).toString();
    const title = ($a.find('.h3, h3').first().text() || $a.find('h2').text() || '').trim().replace(/\s+/g, ' ');
    const location = ($a.find('.cityNames, [class*="city"], [class*="location"]').first().text() || '').trim().replace(/\s+/g, ' ');
    if (!title) return;
    withTitle++;
    if (sampleLocations.length < 5) sampleLocations.push(`${title} → "${location}"`);
    if (!isMunichArea(location)) return;
    withMunich++;
    const job: JobInput = {
      company: cfg.company,
      title,
      location: location || null,
      url,
      source_portal: 'talentsconnect',
    };
    job.hash = hashJob(job);
    out.push(job);
  });

  const seen = new Set<string>();
  const deduped = out.filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)));

  if (deduped.length === 0) {
    console.log(`  [debug ${cfg.company}] talentsconnect 0 Treffer:`);
    console.log(`    HTML ${html.length} bytes · ${withOffer} offer-Anchors · ${withTitle} mit Titel · ${withMunich} mit Munich-Match`);
    if (sampleLocations.length) {
      console.log(`    Sample-Einträge (alle Standorte, vor Munich-Filter):`);
      sampleLocations.forEach(s => console.log(`      ${s}`));
    } else {
      console.log(`    Keine Anchors mit a[data-type="offer"] gefunden – DOM-Struktur vermutlich geändert.`);
    }
  }

  return deduped;
}

/** Reichert einen einzelnen Job mit Description + extrahierten Sections an. */
export async function enrichTalentsConnect(job: JobInput): Promise<JobInput> {
  try {
    const html = await fetchText(job.url);
    const $ = cheerio.load(html);
    const main = $('main').html() || $('article').html() || html;
    const sections = extractSectionsFromHtml(main);
    return { ...job, description_raw: main.slice(0, 50_000), tasks: sections.tasks, qualifications: sections.qualifications };
  } catch {
    return job;
  }
}
