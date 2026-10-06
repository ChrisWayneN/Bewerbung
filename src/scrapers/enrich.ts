import * as cheerio from 'cheerio';
import { fetchText, fetchJson } from './base';
import { extractSections, sanitizeHtml, type ExtractedSections } from './extract';
import {
  getJobsToEnrich, saveEnrichment, markEnrichFailed, countEnrichGivenUp, MAX_ENRICH_ATTEMPTS, type EnrichTarget,
} from '../lib/db';

/**
 * Detail-Anreicherung: öffnet die Seite hinter jeder Stelle und extrahiert
 * "Aufgaben/Tätigkeiten" und "Qualifikationen/Profil".
 *
 * Quellen, in dieser Reihenfolge probiert (die erste mit beiden Abschnitten gewinnt):
 *   1. bereits gespeicherte Beschreibung (z.B. von Workday/Personio mitgeliefert)
 *   2. JSON-LD "JobPosting" – fast alle Portale betten das für Google Jobs ein,
 *      es enthält die reine Stellenbeschreibung ohne Menüs/Footer
 *   3. typische Beschreibungs-Container (itemprop=description, .job-description …)
 *   4. die ganze Seite (ohne Navigation/Footer) als letzter Ausweg
 *
 * Jede Stelle wird nur einmal erfolgreich angereichert. Fehlversuche werden
 * gezählt; nach MAX_ENRICH_ATTEMPTS wird die Stelle bei normalen Läufen nicht
 * mehr geladen (z.B. weil die Seite nur per JavaScript Inhalte nachlädt).
 */

const CONTAINER_SELECTORS = [
  '[itemprop="description"]',
  '.job__description', '.job-description', '#job-description', '.jobdescription', '#jobdescription',
  '.job-details', '.jobDetails', '.job-detail', '.job-posting', '.posting-page',
  '[class*="job-description" i]', '[class*="jobdescription" i]', '[class*="job_description" i]',
  '[id*="description" i]', '[class*="description" i]',
  'article', 'main', '[role="main"]',
  'body',
];

interface Candidate {
  source: string;
  content: string; // HTML oder Text
}

function looksEscaped(s: string): boolean {
  return !/<[a-z][\s\S]*>/i.test(s) && /&lt;[a-z]/i.test(s);
}

/** Greenhouse u.a. liefern die Beschreibung HTML-escaped (&lt;p&gt;…). */
function decodeEntities(s: string): string {
  return cheerio.load(`<div id="x">${s}</div>`)('#x').text();
}

function jsonLdDescriptions($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    const raw = $(s).contents().text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Manche Seiten haben rohe Zeilenumbrüche in Strings – die sind in JSON verboten.
      try { data = JSON.parse(raw.replace(/[\u0000-\u001F]+/g, ' ')); } catch { return; }
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const x = stack.pop();
      if (Array.isArray(x)) { stack.push(...x); continue; }
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const type = o['@type'];
      const isPosting = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
      if (isPosting && typeof o.description === 'string' && o.description.trim()) {
        out.push(looksEscaped(o.description) ? decodeEntities(o.description) : o.description);
      }
      if (o['@graph']) stack.push(o['@graph']);
    }
  });
  return out;
}

/** Lädt die Stellenseite und liefert alle Kandidaten für die Beschreibung. */
async function fetchCandidates(job: EnrichTarget): Promise<Candidate[]> {
  const cands: Candidate[] = [];

  // Helsing: helsing.ai blockt Node-Requests (Cloudflare 429), die Inhalte kommen
  // aber ohnehin aus Greenhouse – dort per Job-ID direkt abrufbar.
  const helsing = job.url.match(/helsing\.ai\/(?:[a-z]{2}\/)?jobs\/(\d+)/);
  if (helsing) {
    const d = await fetchJson<{ content?: string }>(`https://boards-api.greenhouse.io/v1/boards/helsing/jobs/${helsing[1]}`);
    if (d.content) cands.push({ source: 'greenhouse-api', content: looksEscaped(d.content) ? decodeEntities(d.content) : d.content });
    return cands;
  }

  // Rohde & Schwarz: unsere URL ist die Ergebnisliste mit Sprungmarke #job-<id>.
  const rs = job.url.match(/^([^#]*karriere-stellenangebote_251573\.html[^#]*)#job-([\w-]+)$/);
  if (rs) return rohdeCandidates(rs[1], rs[2]);

  return candidatesFromPage(await fetchText(job.url));
}

/** JSON-LD + typische Beschreibungs-Container einer Stellenseite. */
function candidatesFromPage(html: string): Candidate[] {
  const cands: Candidate[] = [];
  const $ = cheerio.load(html);
  for (const d of jsonLdDescriptions($)) cands.push({ source: 'json-ld', content: d });

  $('script, style, noscript, nav, footer, form, [role="navigation"]').remove();
  const used = new Set<unknown>();
  for (const sel of CONTAINER_SELECTORS) {
    // Bei mehreren Treffern den textreichsten nehmen (z.B. mehrere [class*=description]).
    let best: any = null;
    let bestLen = 0;
    $(sel).each((_, el) => {
      const len = $(el).text().replace(/\s+/g, ' ').trim().length;
      if (len > bestLen) { bestLen = len; best = el; }
    });
    // Nur leere/fast leere Container aussortieren – kurze Ausschreibungen sind legitim.
    if (!best || bestLen < 40 || used.has(best)) continue;
    used.add(best);
    cands.push({ source: sel, content: $.html(best) });
  }
  return cands;
}

/** Listenseiten werden pro Lauf nur einmal geladen, auch wenn mehrere Stellen darauf stehen. */
let pageCache = new Map<string, Promise<string>>();
function fetchCached(url: string): Promise<string> {
  if (!pageCache.has(url)) pageCache.set(url, fetchText(url));
  return pageCache.get(url)!;
}

/** Rohde & Schwarz: Stelle als Accordion-Eintrag in der (per &offset= nachgeladenen)
 *  Liste suchen. Kandidaten: verlinkte Detailseiten des Eintrags, sonst dessen
 *  aufgeklappter Text. */
async function rohdeCandidates(listingUrl: string, jobId: string): Promise<Candidate[]> {
  for (let offset = 0; offset <= 600; offset += 30) {
    const html = await fetchCached(offset ? `${listingUrl}&offset=${offset}` : listingUrl);
    const $ = cheerio.load(html);
    const marker = $(`[data-job-id="${jobId}"]`).first();
    if (!marker.length) {
      const anyJobs = $('[data-job-id]').length > 0;
      if (!anyJobs) break; // Ende der Liste
      continue;
    }
    const item = marker.closest('div.module-accordion');
    const cands: Candidate[] = [];
    const links = new Set<string>();
    item.find('a[href]').each((_, a) => {
      const href = $(a).attr('href') ?? '';
      if (!href || /^(#|javascript:|mailto:)/i.test(href) || href.includes('karriere-stellenangebote_251573')) return;
      links.add(new URL(href, listingUrl).toString());
    });
    for (const link of links) {
      try {
        cands.push(...candidatesFromPage(await fetchText(link)));
      } catch { /* Link tot – Accordion-Text bleibt als Fallback */ }
    }
    if (item.length) cands.push({ source: 'rs-accordion', content: $.html(item) });
    return cands;
  }
  throw new Error(`Stelle job-${jobId} nicht mehr in der R&S-Liste`);
}

function score(s: ExtractedSections): number {
  return (s.tasks ? 1 : 0) + (s.qualifications ? 1 : 0);
}

type Outcome = 'voll' | 'teilweise' | 'nichts' | 'fehler';

interface Pick { sections: ExtractedSections; cand: Candidate }

/** Bester Kandidat (meiste gefundene Abschnitte; bei Gleichstand der frühere). */
function pickBest(cands: Candidate[], current: Pick | null): Pick | null {
  let best = current;
  for (const cand of cands) {
    if (best && score(best.sections) === 2) break;
    const sections = extractSections(cand.content);
    if (!best || score(sections) > score(best.sections)) best = { sections, cand };
  }
  return best;
}

async function enrichOne(job: EnrichTarget): Promise<{ outcome: Outcome; error?: string }> {
  // 1. Schon gespeicherte Beschreibung (z.B. von Workday/Personio mitgeliefert):
  //    reicht sie, muss die Seite gar nicht geladen werden.
  let best = pickBest(job.description_raw ? [{ source: 'gespeichert', content: job.description_raw }] : [], null);

  // 2. Stellenseite laden.
  let cands: Candidate[] = [];
  if (!best || score(best.sections) < 2) {
    try {
      cands = await fetchCandidates(job);
    } catch (e) {
      // Seite nicht erreichbar – mit dem Gespeicherten weitermachen, falls es etwas hergab.
      if (!best || score(best.sections) === 0) {
        markEnrichFailed(job.id, null);
        return { outcome: 'fehler', error: e instanceof Error ? e.message : String(e) };
      }
    }
    best = pickBest(cands, best);
  }

  // Als Roh-Beschreibung den spezifischsten Kandidaten speichern, nie die ganze Seite.
  const rawCand = best && score(best.sections) > 0 && best.cand.source !== 'body'
    ? best.cand
    : cands.find(c => c.source !== 'body' && c.source !== 'gespeichert');
  // Bereits gespeicherte Beschreibung bleibt unverändert (null → COALESCE behält sie).
  const raw = rawCand && rawCand.source !== 'gespeichert'
    ? sanitizeHtml(rawCand.content).slice(0, 50_000) || null
    : null;

  if (!best || score(best.sections) === 0) {
    markEnrichFailed(job.id, raw);
    return { outcome: 'nichts' };
  }
  saveEnrichment(job.id, { description_raw: raw, ...best.sections });
  return { outcome: score(best.sections) === 2 ? 'voll' : 'teilweise' };
}

export interface EnrichOptions {
  only?: string[];
  force?: boolean;
  limit?: number;
  /** Wie viele Firmen gleichzeitig. Innerhalb einer Firma wird nacheinander geladen. */
  concurrency?: number;
  log?: (msg: string) => void;
}

export async function enrichJobs(opts: EnrichOptions = {}) {
  const log = opts.log ?? console.log;
  pageCache = new Map();
  const jobs = getJobsToEnrich({ only: opts.only, force: opts.force, limit: opts.limit });
  if (!jobs.length) {
    const givenUp = opts.force ? 0 : countEnrichGivenUp();
    log(givenUp
      ? `▶ Details (Aufgaben/Profil): nichts zu tun. ${givenUp} Stellen ohne Ergebnis wurden nach ${MAX_ENRICH_ATTEMPTS} Versuchen aufgegeben (mit "npm run enrich -- --force" erneut versuchen).`
      : '▶ Details (Aufgaben/Profil): nichts zu tun – alle sichtbaren Stellen sind angereichert.');
    return { total: 0, stats: {} as Record<string, Record<Outcome, number>> };
  }

  log(`▶ Details (Aufgaben/Profil) für ${jobs.length} Stellen laden …`);
  const byCompany = new Map<string, EnrichTarget[]>();
  for (const j of jobs) {
    if (!byCompany.has(j.company)) byCompany.set(j.company, []);
    byCompany.get(j.company)!.push(j);
  }

  const stats: Record<string, Record<Outcome, number>> = {};
  const samples: Record<string, string> = {};
  let done = 0;
  const queue = [...byCompany.entries()];

  async function worker() {
    while (queue.length) {
      const [company, list] = queue.shift()!;
      stats[company] = { voll: 0, teilweise: 0, nichts: 0, fehler: 0 };
      for (const job of list) {
        const r = await enrichOne(job);
        stats[company][r.outcome]++;
        if ((r.outcome === 'nichts' || r.outcome === 'fehler') && !samples[company]) {
          samples[company] = r.error ? `${job.url}  (${r.error.slice(0, 120)})` : job.url;
        }
        done++;
        if (done % 25 === 0) log(`  … ${done}/${jobs.length}`);
        await new Promise(res => setTimeout(res, 300)); // höflich zum Server
      }
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, () => worker()));

  log('');
  log('  Firma                 Stellen  vollständig  teilweise  nichts  Fehler');
  for (const [company, s] of Object.entries(stats).sort(([a], [b]) => a.localeCompare(b))) {
    const n = s.voll + s.teilweise + s.nichts + s.fehler;
    const icon = s.nichts + s.fehler === 0 ? '✅' : s.voll + s.teilweise > 0 ? '⚠️' : '❌';
    log(`${icon} ${company.padEnd(20)} ${String(n).padStart(7)}  ${String(s.voll).padStart(11)}  ${String(s.teilweise).padStart(9)}  ${String(s.nichts).padStart(6)}  ${String(s.fehler).padStart(6)}`);
  }
  const failedCompanies = Object.keys(samples);
  if (failedCompanies.length) {
    log('');
    log('  Beispiele ohne Ergebnis (zum Nachprüfen):');
    for (const c of failedCompanies.sort()) log(`    · ${c}: ${samples[c]}`);
    log(`  Fehlgeschlagene Stellen werden bei den nächsten Läufen erneut versucht (max. ${MAX_ENRICH_ATTEMPTS}×).`);
  }
  return { total: jobs.length, stats };
}
