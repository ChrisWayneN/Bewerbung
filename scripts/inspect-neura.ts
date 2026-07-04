#!/usr/bin/env node
/**
 * Diagnose-Script für den Neura-Scraper. Fetcht die Karriere-Seite,
 * listet alle JS-Bundles und sucht in HTML+Bundles nach den relevanten
 * Zeichenketten. Print gibt genug Kontext, um zu sehen ob/wie die
 * Typesense-URL noch im Frontend steht.
 *
 *   npm run inspect-neura
 *   npm run inspect-neura > neura-debug.txt    (in Datei umleiten)
 */
import { fetchText } from '../src/scrapers/base';

const PAGE = 'https://jobs.neura-robotics.com/search';
const NEEDLES = ['my-job-shop', 'typesense', 'multi_search', 'x-typesense', 'api-key', 'apiKey'];

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

async function main() {
  console.log(`▶ Neura-Diagnose`);
  console.log(`▶ Fetch: ${PAGE}`);
  const html = await fetchText(PAGE);
  console.log(`▶ HTML: ${html.length} bytes`);

  // Schritt 1: HTML selbst nach Needles durchsuchen
  console.log(`\n== HTML-Scan ==`);
  let htmlHits = 0;
  for (const needle of NEEDLES) {
    const matches = findMatches(html, needle);
    if (matches.length) {
      htmlHits++;
      console.log(`\n"${needle}" — ${matches.length} Treffer:`);
      matches.forEach(m => console.log(`  @${m.pos}: ${m.snippet.replace(/\s+/g, ' ').slice(0, 320)}`));
    }
  }
  if (!htmlHits) console.log(`  (keiner der Needles im HTML)`);

  // Schritt 2: Bundle-URLs extrahieren
  const scriptRefs = Array.from(html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)).map(m => m[1]);
  const preloadRefs = Array.from(html.matchAll(/<link[^>]*\brel=["'](?:modulepreload|preload)["'][^>]*\bhref=["']([^"']+)["']/g)).map(m => m[1]);
  const preloadRefs2 = Array.from(html.matchAll(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'](?:modulepreload|preload)["']/g)).map(m => m[1]);
  const all = new Set([...scriptRefs, ...preloadRefs, ...preloadRefs2]);
  const baseOrigin = new URL(PAGE).origin;
  const bundles = Array.from(all)
    .filter(src => /\.js(\?|$|#)/i.test(src) || /\.mjs(\?|$|#)/i.test(src))
    .map(src => (src.startsWith('http') ? src : src.startsWith('/') ? baseOrigin + src : `${baseOrigin}/${src}`));

  console.log(`\n== JS-Bundles: ${bundles.length} ==`);
  bundles.forEach(u => console.log(`  ${u}`));

  // Schritt 3: Jedes Bundle laden, in jeder nach Needles suchen
  for (const url of bundles) {
    const name = url.split('/').pop() ?? url;
    let js: string;
    try {
      js = await fetchText(url);
    } catch (e) {
      console.log(`\n[fail] ${name}: ${(e as Error).message}`);
      continue;
    }
    const hits: Array<{ needle: string; matches: ReturnType<typeof findMatches> }> = [];
    for (const needle of NEEDLES) {
      const matches = findMatches(js, needle);
      if (matches.length) hits.push({ needle, matches });
    }
    if (hits.length) {
      console.log(`\n== Bundle ${name} (${js.length} bytes) ==`);
      for (const h of hits) {
        console.log(`\n"${h.needle}" — ${h.matches.length} Treffer:`);
        h.matches.forEach(m => console.log(`  @${m.pos}: ${m.snippet.replace(/\s+/g, ' ').slice(0, 320)}`));
      }
    }
  }
  console.log(`\n▶ Fertig.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
