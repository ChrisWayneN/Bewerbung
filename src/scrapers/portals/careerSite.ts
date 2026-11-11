import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';
import { extractInlineJson } from '../inlineJson';
import { scrapePersonio } from './personio';

/**
 * Eigene Karriereseite ohne Filter und ohne bekanntes Bewerbungsportal
 * (z.B. microagi.ai/careers, rocket.gmbh/jobs): Liste laden, alle Links auf
 * Stellenseiten einsammeln, je Stelle den Ort bestimmen (Karte in der Liste,
 * sonst Kopf der Stellenseite) und nur Stellen im Großraum München behalten.
 *
 * Stellen-Links werden aus echten <a> UND aus dem Rohtext geholt – manche
 * Seiten rendern die Liste erst per JavaScript und haben die Pfade nur im
 * eingebetteten Seitenzustand.
 */
export interface CareerSiteConfig {
  company: string;
  listUrl: string;
  /** Pfad einer Stellenseite, z.B. /^\/careers\/[a-z0-9-]+\/?$/i */
  jobPath: RegExp;
  sourcePortal: string;
  /** Titel, die keine Stelle sind (z.B. Initiativbewerbung). */
  skipTitle?: RegExp;
  /** Höchstzahl geladener Stellenseiten (Schutz vor Fehlerkennung). */
  maxDetailPages?: number;  /** Nicht an ein eingebettetes Personio-Board weiterreichen (Aufruf kommt von dort). */
  noPersonioDelegate?: boolean;
  /** Ort aus der Stellen-URL, falls weder Liste noch Stellenseite einen nennen. */
  locationFromUrl?: (url: string) => string | null;
}

/** Orte, an denen eine Ortszeile erkannt wird (neben allen München-Orten). */
const CITY_RE = /m(?:ü|ue|u)nchen|munich|z(?:ü|ue|u)rich|new york|\bnyc\b|aachen|berlin|london|san francisco|paris|hamburg|frankfurt|k(?:ö|oe)ln|cologne|stuttgart|d(?:ü|ue)sseldorf|n(?:ü|ue)rnberg|nuremberg|augsburg|ingolstadt|regensburg|wien|vienna|dresden|leipzig|hannover|bremen|karlsruhe|mannheim|ulm|\bremote\b|home\s*office|deutschlandweit/i;
const isCityText = (t: string) => CITY_RE.test(t) || isMunichArea(t);

/** Kürzeste Ortszeile (z.B. "Zürich or Munich · Full-time") in einem Bereich der Seite. */
function locationLine($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, afterH1: boolean): string | null {
  const els = root.find('*').toArray().filter(el => !$(el).closest('nav, footer, script, style, noscript').length);
  const start = afterH1 ? Math.max(0, els.findIndex(el => (el as any).tagName === 'h1')) : 0;
  for (const el of els.slice(start)) {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (!t || t.length >= 120 || !isCityText(t)) continue;
    // Tiefstes passendes Element nehmen, nicht den Container drumherum.
    if ($(el).children().toArray().some(c => { const ct = $(c).text().trim(); return ct.length < t.length && isCityText(ct); })) continue;
    return t;
  }
  return null;
}

/** Ort aus JSON-LD JobPosting.jobLocation. */
function jsonLdLocation(html: string): string | null {
  for (const hit of extractInlineJson(html)) {
    const stack: unknown[] = [hit.data];
    while (stack.length) {
      const x = stack.pop();
      if (Array.isArray(x)) { stack.push(...x); continue; }
      if (!x || typeof x !== 'object') continue;
      const d = x as Record<string, any>;
      if (d['@graph']) stack.push(d['@graph']);
      const type = d['@type'];
      if (!(type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) || !d.jobLocation) continue;
      const locs = (Array.isArray(d.jobLocation) ? d.jobLocation : [d.jobLocation])
        .map((l: any) => l?.address?.addressLocality ?? l?.name)
        .filter((l: unknown): l is string => typeof l === 'string' && !!l.trim());
      if (locs.length) return locs.join(' / ');
    }
  }
  return null;
}

/** "Head of Hardware · microagi" → "Head of Hardware" */
function cleanTitle(t: string): string {
  return t.replace(/\s+/g, ' ').trim().replace(/\s+[·|–—-]\s+[^·|–—-]{1,40}$/, '').trim();
}

/** Weitere Listenseiten (…/page/2/, ?page=2, ?paged=2) derselben Liste. */
function paginationUrls($: cheerio.CheerioAPI, listUrl: string): string[] {
  const base = new URL(listUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const out = new Set<string>();
  $('a[href]').each((_, a) => {
    let u: URL;
    try { u = new URL($(a).attr('href')!, listUrl); } catch { return; }
    if (u.hostname !== base.hostname) return;
    const path = u.pathname.replace(/\/+$/, '');
    const pageInPath = path.startsWith(basePath + '/page/') && /\/page\/\d+$/.test(path);
    const pageInQuery = path === basePath && /^\d+$/.test(u.searchParams.get('page') ?? u.searchParams.get('paged') ?? '');
    if (pageInPath || pageInQuery) out.add(u.toString().replace(/#.*$/, ''));
  });
  return [...out];
}

export async function scrapeCareerSite(cfg: CareerSiteConfig): Promise<JobInput[]> {
  const html = await fetchText(cfg.listUrl);
  let $ = cheerio.load(html);
  const base = new URL(cfg.listUrl);
  const host = base.hostname.replace(/^www\./, '');
  const sameHost = (u: URL) => u.hostname.replace(/^www\./, '') === host;
  const tag = `[debug ${cfg.company}]`;

  // url → Kartentext + Überschrift aus der Liste
  const cards = new Map<string, { text: string; heading: string; $card: cheerio.Cheerio<any> | null; $doc: cheerio.CheerioAPI }>();
  const jobUrl = (href: string | undefined): string | null => {
    let u: URL;
    try { u = new URL(href ?? '', cfg.listUrl); } catch { return null; }
    return sameHost(u) && cfg.jobPath.test(u.pathname) ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : null;
  };
  const collect = () => $('a[href]').each((_, a) => {
    const url = jobUrl($(a).attr('href'));
    if (!url) return;
    const $a = $(a);
    // Karte: der kleinste umgebende Container, der nur diese eine Stelle enthält
    // (dort stehen meist Ort/Arbeitszeit); sonst der Link selbst.
    let $c = $a;
    for (const el of $a.parents().toArray()) {
      if ((el as any).tagName === 'body') break;
      const urls = new Set($(el).find('a[href]').toArray().map(x => jobUrl($(x).attr('href'))).filter(Boolean));
      if (urls.size > 1) break;
      $c = $(el);
      if ($c.text().length > 600) break;
    }
    const heading = $c.find('h1, h2, h3, h4, h5, [class*="title" i]').first().text().replace(/\s+/g, ' ').trim();
    const prev = cards.get(url);
    const text = $c.text().replace(/\s+/g, ' ').trim();
    if (!prev || text.length > prev.text.length) cards.set(url, { text, heading: heading || prev?.heading || '', $card: $c, $doc: $ });
  });
  collect();
  // Blättern: weitere Listenseiten (max. 10) mit einsammeln.
  const pages = new Set([cfg.listUrl]);
  for (let i = 0, todo = paginationUrls($, cfg.listUrl); i < todo.length && pages.size <= 10; i++) {
    if (pages.has(todo[i])) continue;
    pages.add(todo[i]);
    try {
      $ = cheerio.load(await fetchText(todo[i]));
      collect();
      todo.push(...paginationUrls($, cfg.listUrl).filter(u => !pages.has(u)));
    } catch (e) {
      console.log(`  ${tag} Listenseite ${todo[i]}: ${e instanceof Error ? e.message : e}`);
    }
  }
  $ = cheerio.load(html);
  const linked = cards.size;
  // Pfade, die nur im Rohtext stehen (JS-gerenderte Liste).
  const raw = new RegExp(`(?:https?:\\/\\/(?:www\\.)?${host.replace(/\./g, '\\.')})?(\\/[A-Za-z0-9._~%/-]+)`, 'g');
  for (const m of html.replace(/\\\//g, '/').matchAll(raw)) {
    if (!cfg.jobPath.test(m[1])) continue;
    const url = `${base.origin}${m[1].replace(/\/+$/, '')}`;
    if (!cards.has(url)) cards.set(url, { text: '', heading: '', $card: null, $doc: $ });
  }

  // Keine Stellen-Links, aber ein eingebettetes Personio-Board → das nehmen.
  if (!cards.size) {
    const personio = cfg.noPersonioDelegate ? null : html.match(/([a-z0-9-]+)\.jobs\.personio\.(de|com)/i);
    if (personio) {
      console.log(`  ${tag} Keine Stellen-Links, aber Personio-Board "${personio[1]}" eingebettet – nutze dessen Feed.`);
      return scrapePersonio({ company: cfg.company, tenant: personio[1], tld: personio[2] as 'de' | 'com' });
    }
    const samples: string[] = [];
    $('a[href]').each((_, a) => {
      const t = $(a).text().trim().replace(/\s+/g, ' ');
      if (samples.length < 20 && t.length > 8) samples.push(`${t.slice(0, 60)} → ${$(a).attr('href')}`);
    });
    console.log(`  ${tag} 0 Stellen-Links. HTML ${html.length} Bytes, Seitentitel "${$('title').first().text().trim()}", ${$('a[href]').length} Links, iframes: ${$('iframe[src]').map((_, f) => $(f).attr('src')).get().join(' ') || '–'}`);
    console.log(`  ${tag} Links mit Text:\n    ${samples.join('\n    ')}`);
    // Hinweise, woher eine per JavaScript geladene Liste kommt, bzw. ob die Seite "keine Stellen" sagt.
    const hosts = [...new Set([...html.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map(m => m[1].toLowerCase()))].filter(h => !h.endsWith(host));
    const scripts = $('script[src]').map((_, el) => $(el).attr('src')).get();
    $('script, style, noscript').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    console.log(`  ${tag} Fremde Adressen im HTML: ${hosts.slice(0, 15).join(' ') || '–'}`);
    console.log(`  ${tag} Skripte: ${scripts.slice(0, 10).join(' ') || '–'}`);
    console.log(`  ${tag} Seitentext: ${text.slice(0, 400) || '–'}`);
    return [];
  }

  const out: JobInput[] = [];
  const skipped: string[] = [];
  const max = cfg.maxDetailPages ?? 60;
  let n = 0;
  for (const [url, card] of cards) {
    if (++n > max) { skipped.push(`${cards.size - max} weitere Links nicht geprüft`); break; }
    let title = card.heading;
    let location = card.$card ? locationLine(card.$doc, card.$card, false) : null;
    let pageTitle = '';
    try {
      const page = await fetchText(url);
      const $d = cheerio.load(page);
      pageTitle = $d('h1').first().text().replace(/\s+/g, ' ').trim()
        || cleanTitle($d('meta[property="og:title"]').attr('content') ?? $d('title').first().text());
      // Ort von der Stellenseite nur, wenn die Karte keinen hatte (Liste ist maßgeblich).
      if (!location) location = jsonLdLocation(page) ?? locationLine($d, $d('body'), true);
    } catch (e) {
      if (!card.text) { skipped.push(`${url} (Seite: ${e instanceof Error ? e.message : e})`); continue; }
    }
    if (!location && cfg.locationFromUrl) location = cfg.locationFromUrl(url);
    title = (pageTitle || title || decodeURIComponent(url.split('/').pop() ?? '').replace(/[-_]+/g, ' ')).trim();
    if (cfg.skipTitle?.test(title)) { skipped.push(`${title} (keine Stelle)`); continue; }
    // "Zürich or Munich · Full-time" → "Zürich or Munich", "Arbeitsort: München" → "München"
    const loc = (location?.split(/\s*[·•|]\s*/).find(p => isCityText(p))?.trim() ?? location)
      ?.replace(/^(?:arbeitsort|einsatzort|standort|standorte|ort|location|locations?)\s*:\s*/i, '') ?? null;
    if (!isMunichArea(loc)) { skipped.push(`${title} (${loc ?? 'Ort unbekannt'})`); continue; }
    const job: JobInput = { company: cfg.company, title, location: loc!, url, source_portal: cfg.sourcePortal };
    job.hash = hashJob(job);
    out.push(job);
  }

  console.log(`  ${tag} ${cards.size} Stellen-Seite(n) gefunden (${linked} als Link, ${pages.size} Listenseite(n)), ${out.length} in München.${skipped.length ? ` Aussortiert: ${skipped.join('; ')}` : ''}`);
  return out;
}
