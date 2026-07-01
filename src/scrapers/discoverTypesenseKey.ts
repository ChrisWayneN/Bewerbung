import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchText } from './base';

/**
 * Resolver für die my-job-shop.com Typesense Multi-Search-URL.
 *
 * Reihenfolge:
 *   1. HTML der angegebenen Karriereseite holen, mit Regex nach
 *      "multi_search?x-typesense-api-key=..." suchen
 *   2. Wenn nicht im HTML: alle <script src="...">-Bundles (vor allem Nuxt-Chunks)
 *      laden und dort nach dem Pattern suchen
 *   3. Manueller Override aus src/config/scraper-secrets.json (Key
 *      "neuraTypesenseUrl") wenn der Auto-Discovery scheitert
 *   4. hardcoded Default-URL (kann veraltet sein)
 *
 * Damit ist der Scraper selbstheilend gegen Key-Rotation, solange der Key im
 * HTML oder JS-Bundle auffindbar bleibt.
 */

// Volle URL inklusive Key.
const URL_PATTERN = /https?:\/\/api\.my-job-shop\.com\/[^"'\\<>\s]*multi_search\?x-typesense-api-key=[A-Za-z0-9=%+\-_/]+/;
// Fallback: nur der Key als String-Literal — für den Fall, dass URL und
// Key im Bundle aus mehreren Konstanten zusammengesetzt werden.
const KEY_ONLY_PATTERN = /x-typesense-api-key["'`\s]*[:=]?["'`\s]*([A-Za-z0-9=%+\-_/]{60,})/;
const API_BASE = 'https://api.my-job-shop.com/api/typesense/multi_search';
const SECRETS_PATH = resolve(process.cwd(), 'src', 'config', 'scraper-secrets.json');

let cachedUrl: string | null = null;

export interface DiscoverOptions {
  /** Karriere-/Search-Seite, z. B. 'https://jobs.neura-robotics.com/search'. */
  pageUrl: string;
  /** Welcher Key in scraper-secrets.json den manuellen Override liefert. */
  secretsKey?: string;
  /** Letzter Fallback wenn nichts gefunden wird. */
  hardcodedFallback?: string;
  /** Bei `true` ignoriere den prozess-internen Cache (für Tests). */
  noCache?: boolean;
  /** Logger, default console.log. */
  log?: (msg: string) => void;
}

export async function discoverTypesenseUrl(opts: DiscoverOptions): Promise<string> {
  if (cachedUrl && !opts.noCache) return cachedUrl;
  const log = opts.log ?? console.log;

  // Strategie 1: HTML der Karriereseite holen
  let html = '';
  try {
    html = await fetchText(opts.pageUrl);
  } catch (e) {
    log(`  [discover] HTML-Fetch fehlgeschlagen (${(e as Error).message})`);
  }

  const debug = process.env.SCRAPE_DEBUG === '1';
  const searchText = (text: string, source: string): string | null => {
    const m = text.match(URL_PATTERN);
    if (m) {
      log(`  [discover] Volle Typesense-URL in ${source} gefunden (${m[0].length} chars)`);
      return m[0];
    }
    const km = text.match(KEY_ONLY_PATTERN);
    if (km) {
      const built = `${API_BASE}?x-typesense-api-key=${km[1]}`;
      log(`  [discover] Key-Fragment in ${source} → URL zusammengesetzt (${built.length} chars)`);
      return built;
    }
    return null;
  };

  if (html) {
    const found = searchText(html, 'HTML');
    if (found) return (cachedUrl = found);

    // Strategie 2: JS-Bundles aus dem HTML extrahieren und durchsuchen.
    // Moderne SPAs (Vite/Nuxt/Vue) hängen die meisten Chunks als
    // <link rel="modulepreload"> oder <link rel="preload" as="script"> ein,
    // nicht als <script src>. Beides berücksichtigen.
    const scriptMatches = Array.from(html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g));
    const modulePreload = Array.from(html.matchAll(/<link[^>]*\brel=["'](?:modulepreload|preload)["'][^>]*\bhref=["']([^"']+)["']/g));
    const modulePreloadAlt = Array.from(html.matchAll(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'](?:modulepreload|preload)["']/g));
    const baseOrigin = new URL(opts.pageUrl).origin;
    const allRefs = new Set<string>([
      ...scriptMatches.map(s => s[1]),
      ...modulePreload.map(s => s[1]),
      ...modulePreloadAlt.map(s => s[1]),
    ]);
    const candidates = Array.from(allRefs)
      .filter(src => /\.js(\?|$|#)/i.test(src) || /\.mjs(\?|$|#)/i.test(src))
      .map(src => (src.startsWith('http') ? src : src.startsWith('/') ? baseOrigin + src : `${baseOrigin}/${src}`))
      // Bevorzuge Bundles, die typischerweise API-Konstanten enthalten.
      .sort((a, b) => {
        const score = (u: string) => (/search|api|typesense|offer|career|jobs|_nuxt|chunks?\/app|main|index|entry|vendor|core|app|bundle/.test(u) ? 0 : 1);
        return score(a) - score(b);
      })
      .slice(0, 50);

    if (debug) log(`  [discover] ${candidates.length} JS-Kandidaten (Top 5): ${candidates.slice(0, 5).map(u => u.split('/').pop()).join(', ')}`);

    for (const url of candidates) {
      try {
        const js = await fetchText(url);
        const found = searchText(js, url.split('/').pop() ?? url);
        if (found) return (cachedUrl = found);
      } catch { /* skip */ }
    }
    log(`  [discover] Typesense-URL nicht in HTML/Bundles auffindbar (${candidates.length} JS-Files geprüft).`);
    log(`  [discover] Manueller Override in src/config/scraper-secrets.json setzen — siehe Kommentar oben in discoverTypesenseKey.ts.`);
  }

  // Strategie 3: Manueller Override
  if (opts.secretsKey && existsSync(SECRETS_PATH)) {
    try {
      const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) as Record<string, string>;
      const v = secrets[opts.secretsKey];
      if (v && typeof v === 'string' && URL_PATTERN.test(v)) {
        log(`  [discover] Typesense-URL aus scraper-secrets.json (${opts.secretsKey})`);
        return (cachedUrl = v);
      }
    } catch (e) {
      log(`  [discover] scraper-secrets.json nicht lesbar: ${(e as Error).message}`);
    }
  }

  // Strategie 4: hardcoded Fallback
  if (opts.hardcodedFallback) {
    log(`  [discover] Fallback auf hardcoded URL – Key womöglich abgelaufen!`);
    return (cachedUrl = opts.hardcodedFallback);
  }
  throw new Error('discoverTypesenseUrl: kein Key auffindbar (HTML, Bundles, Secrets, Fallback alle leer)');
}

/** Reset für Tests. */
export function _resetDiscoverCache(): void { cachedUrl = null; }
