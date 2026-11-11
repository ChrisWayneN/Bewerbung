import * as cheerio from 'cheerio';
import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchText } from '../base';

/**
 * zvoove Recruit (früher europersonal) – Karriereseite <kunde>.recruit.zvoove.cloud.
 *
 * Die Seite selbst ist eine Angular-App ("Loading..."), die Stellen kommen aus
 * der öffentlichen REST-API derselben Instanz (/api/public/v1/Stelle/…, ohne
 * Schlüssel). Feldnamen sind nicht offiziell dokumentiert → Antwort generisch
 * auswerten: größte Liste von Objekten mit Titel-Feld; Ort aus allen Feldern
 * namens Ort/Arbeitsort/Einsatzort/Stadt/City/Location/PLZ (auch verschachtelt).
 *
 * Findet keiner der bekannten Endpunkte etwas, werden die API-Pfade aus dem
 * App-Bundle (main-*.js) gelesen, passende ausprobiert und im Debug gezeigt.
 */
export interface ZvooveConfig {
  company: string;
  /** z.B. https://rocket-gmbh.recruit.zvoove.cloud */
  host: string;
  /** ?origin=… an den Stellen-Links (wie auf der Firmenseite). */
  origin?: string;
  skipTitle?: RegExp;
}

type Obj = Record<string, unknown>;

const TITLE_KEY = /^(stellen)?(bezeichnung|titel|title|jobtitle|stellentitel|positionsbezeichnung|stellenbezeichnung|name)$/i;
// z.B. EinsatzortOrt, EinsatzortPlz, Arbeitsort, Ort, City (nicht: Sortierung).
const LOC_KEY = /(?<!s)orte?(name|bezeichnung)?$|^stadt$|city|location|standort|plz$|postleitzahl|^zip/i;
// Reihenfolge = Vorrang (MandantUuid o.ä. darf nicht gewinnen).
const UUID_KEYS = [/^stelleuuid$/i, /^stelle.*uuid$/i, /^(uuid|id|guid)$/i];
const NR_KEY = /^(stellen|stelle)?(id|nummer|nr|number)$/i;
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function titleOf(o: Obj): string | null {
  for (const [k, v] of Object.entries(o)) if (TITLE_KEY.test(k) && typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** Größte Liste von Objekten, deren Einträge überwiegend ein Titel-Feld haben. */
function findJobArray(data: unknown): Obj[] {
  let best: Obj[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (objs.length && objs.filter(o => titleOf(o)).length >= objs.length / 2 && objs.length > best.length) best = objs;
      v.forEach(x => walk(x, depth + 1));
    } else Object.values(v).forEach(x => walk(x, depth + 1));
  };
  walk(data, 0);
  return best;
}

/** Alle Ortsangaben eines Stellen-Objekts (auch aus verschachtelten Arbeitsorten). */
function locationsOf(o: Obj): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string, depth: number, inLoc: boolean) => {
    if (depth > 4 || v == null) return;
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      if (inLoc && s && s.length < 80 && !UUID_RE.test(s) && !/^\d+(\.\d+)?$/.test(s)) out.push(s);
      else if (inLoc && /^\d{5}$/.test(s)) out.push(s);
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => walk(x, key, depth + 1, inLoc)); return; }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) {
      if (/lat|lng|lon|koordinat|id$|uuid/i.test(k)) continue;
      walk(x, k, depth + 1, inLoc || LOC_KEY.test(k) || /adresse|address/i.test(k));
    }
  };
  for (const [k, v] of Object.entries(o)) if (LOC_KEY.test(k) || /adresse|address/i.test(k)) walk(v, k, 0, true);
  return [...new Set(out)];
}

function slug(s: string): string {
  return s.toLowerCase()
    .replace(/\((?:[^)]*\b[mwfd]\b[^)]*)\)/g, ' ')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function firstMatching(o: Obj, keys: RegExp | RegExp[], test: (s: string) => boolean): string | null {
  for (const key of Array.isArray(keys) ? keys : [keys]) for (const [k, v] of Object.entries(o)) {
    if (!key.test(k) || (typeof v !== 'string' && typeof v !== 'number')) continue;
    const s = String(v);
    if (test(s)) return s;
  }
  return null;
}

/** Fließtext der Stelle (Aufgaben/Profil stehen oft als HTML in einzelnen, auch verschachtelten Feldern). */
function descriptionOf(o: unknown, title: string): string | null {
  const parts: string[] = [];
  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 5 || v == null) return;
    if (typeof v === 'string') {
      if (v.length < 80 || TITLE_KEY.test(key) || /^https?:/.test(v)) return;
      const text = (/<[a-z][^>]*>/i.test(v) ? cheerio.load(v.replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, '$&\n')).root().text() : v).trim();
      if (!text || text === title || parts.some(x => x.endsWith(text))) return;
      // Feldname als Überschrift, damit die Aufgaben/Profil-Erkennung greift (Feld "Aufgaben" → "Aufgaben:").
      const label = /aufgab|t(ae|ä)tigkeit|profil|anforder|qualifik|erwart|biete|benefit/i.test(key) && !/aufgab|profil|anforder|qualifik|bieten/i.test(text.slice(0, 40))
        ? `${key.replace(/([a-z])([A-Z])/g, '$1 $2')}:\n` : '';
      parts.push(label + text);
      return;
    }
    if (Array.isArray(v)) v.forEach(x => walk(x, key, depth + 1));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(o, '', 0);
  return parts.length ? parts.join('\n\n') : null;
}

async function tryJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const body = await fetchText(url, {
    ...init,
    headers: {
      accept: 'application/json, text/plain, */*',
      'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const t = body.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) throw new Error(`keine JSON-Antwort (${t.slice(0, 60).replace(/\s+/g, ' ')}…)`);
  return JSON.parse(t);
}

/** API-Pfade und Konfig-Dateien aus dem Angular-Bundle der Karriereseite. */
async function apiPathsFromBundle(host: string, tag: string): Promise<string[]> {
  const html = await fetchText(`${host}/`);
  const $ = cheerio.load(html);
  const scripts = $('script[src]').map((_, el) => $(el).attr('src')).get().filter(s => /main|app|chunk/i.test(s));
  const found = new Set<string>();
  const extra = new Set<string>();
  for (const src of scripts.slice(0, 4)) {
    let js = '';
    try { js = await fetchText(new URL(src, `${host}/`).href); } catch (e) { console.log(`  ${tag} Bundle ${src}: ${e instanceof Error ? e.message : e}`); continue; }
    for (const m of js.matchAll(/["'`]((?:https?:\/\/[a-z0-9.-]+)?\/?api\/[A-Za-z0-9/_.\-${}]+)["'`]/g)) found.add(m[1]);
    for (const m of js.matchAll(/["'`]((?:https?:\/\/[a-z0-9.-]+)?[A-Za-z0-9/_.-]*(?:config|environment|settings)[A-Za-z0-9_.-]*\.json)["'`]/gi)) extra.add(m[1]);
    for (const m of js.matchAll(/["'`](https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^"'`\s]{0,60})["'`]/gi)) if (!/w3\.org|angular|github|usercentrics|google/i.test(m[1])) extra.add(m[1]);
  }
  console.log(`  ${tag} API-Pfade im App-Bundle: ${[...found].slice(0, 40).join(' ') || '–'}`);
  console.log(`  ${tag} Weitere Adressen/Konfig im Bundle: ${[...extra].slice(0, 20).join(' ') || '–'}`);
  // Konfig-Dateien nennen oft die eigentliche API-Adresse.
  for (const c of [...extra].filter(x => x.endsWith('.json')).slice(0, 3)) {
    try {
      const body = await fetchText(new URL(c, `${host}/`).href);
      console.log(`  ${tag} ${c}: ${body.replace(/\s+/g, ' ').slice(0, 400)}`);
    } catch (e) { console.log(`  ${tag} ${c}: ${e instanceof Error ? e.message : e}`); }
  }
  return [...found];
}

/** Beschreibung (Aufgaben/Profil) einer Stelle aus GetStelleById – die Stellenseite selbst ist eine JS-App. */
let detailParam: string | null | undefined;
async function detailText(host: string, uuid: string, title: string, tag: string): Promise<string | null> {
  const params = detailParam ? [detailParam] : detailParam === null ? [] : ['stelleUuid', 'uuid', 'id', 'stelleId'];
  for (const p of params) {
    try {
      const data = await tryJson(`${host}/api/public/v1/Stelle/GetStelleById?${p}=${uuid}`);
      const text = descriptionOf(data, title);
      if (text && text.length > 200) {
        if (detailParam === undefined) console.log(`  ${tag} Stellentexte über GetStelleById?${p}=… (${text.length} Zeichen bei der ersten Stelle)`);
        detailParam = p;
        return text;
      }
    } catch { /* nächsten Parameternamen probieren */ }
  }
  if (detailParam === undefined) { console.log(`  ${tag} GetStelleById liefert keinen Stellentext – Aufgaben/Profil fehlen.`); detailParam = null; }
  return null;
}

export async function scrapeZvoove(cfg: ZvooveConfig): Promise<JobInput[]> {
  const tag = `[debug ${cfg.company}]`;
  const host = cfg.host.replace(/\/+$/, '');
  const paging = 'skip=0&take=500&top=500&pageSize=500&page=1';
  const attempts: { label: string; url: string; init?: RequestInit }[] = [
    { label: 'GET GetStellenFiltered', url: `${host}/api/public/v1/Stelle/GetStellenFiltered?${paging}` },
    { label: 'POST GetStellenFiltered', url: `${host}/api/public/v1/Stelle/GetStellenFiltered`,
      init: { method: 'POST', body: JSON.stringify({ skip: 0, take: 500, top: 500, pageSize: 500, page: 1 }) } },
    { label: 'GET GetStellen', url: `${host}/api/public/v1/Stelle/GetStellen?${paging}` },
  ];

  let items: Obj[] = [];
  let sample = '';
  const tried = new Set<string>();
  const run = async (a: { label: string; url: string; init?: RequestInit }) => {
    tried.add(a.url);
    try {
      const data = await tryJson(a.url, a.init);
      const arr = findJobArray(data);
      console.log(`  ${tag} ${a.label}: ${arr.length} Stellen-Objekte`);
      if (!arr.length && !sample) sample = JSON.stringify(data).slice(0, 400);
      if (arr.length > items.length) items = arr;
    } catch (e) {
      console.log(`  ${tag} ${a.label}: ${e instanceof Error ? e.message : e}`);
    }
  };
  for (const a of attempts) { await run(a); if (items.length) break; }

  if (!items.length) {
    // Pfade direkt aus der App holen und die Stellen-Pfade ohne Platzhalter probieren.
    let paths: string[] = [];
    try { paths = await apiPathsFromBundle(host, tag); } catch (e) { console.log(`  ${tag} App-Bundle: ${e instanceof Error ? e.message : e}`); }
    const candidates = paths
      .filter(p => /stell|job|vacanc|posting/i.test(p) && !/[${}]/.test(p) && !/byid|bewerb|apply|upload/i.test(p))
      .map(p => (p.startsWith('http') ? p : `${host}/${p.replace(/^\/+/, '')}`))
      .filter(u => !tried.has(u.split('?')[0]))
      .slice(0, 8);
    for (const u of candidates) {
      await run({ label: `GET ${u.replace(host, '')}`, url: u.includes('?') ? u : `${u}?${paging}` });
      if (items.length) break;
    }
  }

  if (!items.length) {
    if (sample) console.log(`  ${tag} Antwort ohne erkennbare Stellen: ${sample}`);
    return [];
  }

  console.log(`  ${tag} Felder einer Stelle: ${Object.keys(items[0]).join(', ')}`);
  const out: JobInput[] = [];
  const skipped: string[] = [];
  for (const o of items) {
    const title = titleOf(o)!;
    if (!title || cfg.skipTitle?.test(title)) continue;
    const locs = locationsOf(o);
    const location = locs.filter(l => !/^\d{5}$/.test(l)).join(', ') || locs.join(', ') || null;
    if (!location || !isMunichArea(location)) { skipped.push(`${title} (${location ?? 'Ort?'})`); continue; }
    const uuid = firstMatching(o, UUID_KEYS, s => UUID_RE.test(s));
    const nr = firstMatching(o, NR_KEY, s => /^\d{2,}$/.test(s));
    const city = locs.find(l => !/^\d{5}$/.test(l)) ?? '';
    const linkSlug = typeof o.LinkSlug === 'string' ? o.LinkSlug : typeof o.linkSlug === 'string' ? o.linkSlug : '';
    const query = cfg.origin ? `?origin=${encodeURIComponent(cfg.origin)}` : '';
    // Stellen-URL wie auf der Seite: /stelle/<titel>-<nr>-<ort>-<uuid ohne Striche>.
    // Enthält LinkSlug schon die Kennung, direkt nehmen. Ohne UUID → Startseite mit #Anker.
    const url = /[0-9a-f]{32}/i.test(linkSlug)
      ? `${host}/stelle/${linkSlug.replace(/^\/?(stelle\/)?/, '')}${query}`
      : uuid
        ? `${host}/stelle/${[slug(linkSlug || title), nr, slug(city), uuid.replace(/-/g, '').toLowerCase()].filter(Boolean).join('-')}${query}`
        : `${host}/${query}#${nr ?? slug(title)}`;
    if (!out.length) console.log(`  ${tag} Beispiel: LinkSlug="${linkSlug}", Nr=${nr ?? '–'}, StelleUuid=${uuid ?? '–'}, StelleLokalisierungUuid=${String(o.StelleLokalisierungUuid ?? o.stelleLokalisierungUuid ?? '–')} → ${url}`);
    const job: JobInput = {
      company: cfg.company, title, location, url, source_portal: 'zvoove',
      description_raw: (uuid ? await detailText(host, uuid, title, tag) : null) ?? descriptionOf(o, title),
    };
    job.hash = hashJob(job);
    out.push(job);
  }
  console.log(`  ${tag} ${items.length} Stellen in der API, ${out.length} in München.${skipped.length ? ` Aussortiert: ${skipped.slice(0, 12).join('; ')}${skipped.length > 12 ? ` (+${skipped.length - 12})` : ''}` : ''}`);
  return out;
}
