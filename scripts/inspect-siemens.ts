#!/usr/bin/env node
/**
 * Diagnose-Script für den Siemens-Scraper. Siemens ist von Phenom People auf
 * Avature migriert (URLs unter /en_US/externaljobs/...). Fetcht die
 * Such-Seite + eine Job-Detail-Seite, druckt Struktur-Hinweise: JobDetail-
 * Links, Formulare/Pagination-Parameter, eingebettete JSON-Configs und
 * JS-Bundles (mit Suche nach API-Mustern darin).
 *
 *   npm run inspect-siemens
 *   npm run inspect-siemens > siemens-debug.txt    (in Datei umleiten)
 */
import { fetchText } from '../src/scrapers/base';

const CANDIDATE_PAGES = [
  'https://jobs.siemens.com/en_US/externaljobs/SearchJobs',
  'https://jobs.siemens.com/careers?hl=de',
];

const NEEDLES = [
  'JobDetail', 'startRow', 'jobRecordsPerPage', 'sortBy', 'sortRequisitionsBy',
  'requisition', 'graphql', 'api/', 'application/json', 'window.__',
  '__INITIAL_STATE__', 'München', 'Munich', 'location',
];

function findMatches(text: string, needle: string, ctx = 120, max = 5): Array<{ pos: number; snippet: string }> {
  const out: { pos: number; snippet: string }[] = [];
  let i = 0;
  while (i < text.length && out.length < max) {
    const found = text.indexOf(needle, i);
    if (found < 0) break;
    const start = Math.max(0, found - ctx);
    const end = Math.min(text.length, found + needle.length + ctx);
    out.push({ pos: found, snippet: text.slice(start, end) });
    i = found + needle.length;
  }
  return out;
}

async function inspectPage(url: string) {
  console.log(`\n\n########## Seite: ${url} ##########`);
  let html: string;
  try {
    html = await fetchText(url);
  } catch (e) {
    console.log(`[fail] ${(e as Error).message}`);
    return;
  }
  console.log(`▶ HTML: ${html.length} bytes`);

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  console.log(`▶ <title>: ${titleMatch?.[1]?.trim() ?? '(keiner)'}`);

  // JobDetail-Links extrahieren
  const jobLinks = Array.from(new Set(Array.from(html.matchAll(/href=["']([^"']*JobDetail[^"']*)["']/gi)).map(m => m[1])));
  console.log(`\n== JobDetail-Links: ${jobLinks.length} ==`);
  jobLinks.slice(0, 10).forEach(l => console.log(`  ${l}`));

  // Formulare (Suchformular / Pagination-Parameter)
  const forms = Array.from(html.matchAll(/<form[^>]*>/gi)).map(m => m[0]);
  console.log(`\n== <form>-Tags: ${forms.length} ==`);
  forms.slice(0, 5).forEach(f => console.log(`  ${f.slice(0, 200)}`));
  const inputs = Array.from(html.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*(?:value=["']([^"']*)["'])?/gi));
  console.log(`\n== <input name=...>: ${inputs.length} (erste 20) ==`);
  inputs.slice(0, 20).forEach(m => console.log(`  ${m[1]} = ${m[2] ?? ''}`));

  // Needle-Scan im HTML
  console.log(`\n== HTML-Needle-Scan ==`);
  for (const needle of NEEDLES) {
    const matches = findMatches(html, needle);
    if (matches.length) {
      console.log(`\n"${needle}" — ${matches.length} Treffer:`);
      matches.forEach(m => console.log(`  @${m.pos}: ${m.snippet.replace(/\s+/g, ' ').slice(0, 320)}`));
    }
  }

  // JS-Bundles sammeln
  const scriptRefs = Array.from(html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)).map(m => m[1]);
  const baseOrigin = new URL(url).origin;
  const bundles = Array.from(new Set(scriptRefs))
    .filter(src => /\.js(\?|$|#)/i.test(src))
    .map(src => (src.startsWith('http') ? src : src.startsWith('/') ? baseOrigin + src : `${baseOrigin}/${src}`));
  console.log(`\n== JS-Bundles: ${bundles.length} ==`);
  bundles.forEach(u => console.log(`  ${u}`));

  for (const bundleUrl of bundles.slice(0, 15)) {
    const name = bundleUrl.split('/').pop() ?? bundleUrl;
    let js: string;
    try {
      js = await fetchText(bundleUrl);
    } catch (e) {
      console.log(`\n[fail] Bundle ${name}: ${(e as Error).message}`);
      continue;
    }
    const hits: Array<{ needle: string; matches: ReturnType<typeof findMatches> }> = [];
    for (const needle of ['/api/', 'graphql', 'searchJobs', 'jobRecordsPerPage', 'requisition']) {
      const matches = findMatches(js, needle);
      if (matches.length) hits.push({ needle, matches });
    }
    if (hits.length) {
      console.log(`\n== Bundle ${name} (${js.length} bytes) ==`);
      for (const h of hits) {
        console.log(`\n"${h.needle}" — ${h.matches.length} Treffer:`);
        h.matches.slice(0, 3).forEach(m => console.log(`  @${m.pos}: ${m.snippet.replace(/\s+/g, ' ').slice(0, 320)}`));
      }
    }
  }
}

async function main() {
  console.log(`▶ Siemens-Diagnose (Avature-Verdacht: /en_US/externaljobs/...)`);
  for (const url of CANDIDATE_PAGES) {
    await inspectPage(url);
  }
  console.log(`\n▶ Fertig.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
