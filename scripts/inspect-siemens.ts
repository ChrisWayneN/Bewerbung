#!/usr/bin/env node
/**
 * Diagnose-Script für den Siemens-Scraper. Siemens ist von Phenom People auf
 * Avature migriert (URLs unter /en_US/externaljobs/...). Fetcht die
 * Such-Seite, druckt Struktur-Hinweise: JobDetail-Links mit Kontext (für
 * Cheerio-Selektoren), volles Suchformular, JS-Bundles (API-Muster) und
 * probiert einen POST mit Suchbegriff "München"/"Munich" um zu sehen ob/wie
 * serverseitig gefiltert werden kann.
 *
 *   npm run inspect-siemens
 *   npm run inspect-siemens > siemens-debug.txt    (in Datei umleiten)
 */
import { fetchText } from '../src/scrapers/base';

const SEARCH_URL = 'https://jobs.siemens.com/en_US/externaljobs/SearchJobs';

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

async function fetchPost(url: string, body: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      referer: url,
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for POST ${url}`);
  return await res.text();
}

/** Zieht für jeden JobDetail-Link (echte Job-Links, keine Share-Icons) einen
 *  größeren HTML-Kontext, damit man den umschließenden Container/Klassen sieht. */
function dumpJobItemContext(html: string, max = 3) {
  const re = /<a class="link" href="([^"]*JobDetail[^"]*)"[^>]*>/g;
  let m: RegExpExecArray | null;
  let count = 0;
  console.log(`\n== Job-Item-Kontext (echte Job-Links, class="link") ==`);
  while ((m = re.exec(html)) && count < max) {
    const start = Math.max(0, m.index - 600);
    const end = Math.min(html.length, m.index + 1200);
    console.log(`\n--- Item ${count + 1}: ${m[1]} ---`);
    console.log(html.slice(start, end).replace(/>\s+</g, '><'));
    count++;
  }
  if (count === 0) console.log('  (keine Treffer für class="link" href=JobDetail)');
}

function dumpFullForm(html: string) {
  const start = html.indexOf('<form');
  if (start < 0) { console.log('\n== Kein <form> gefunden =='); return; }
  const end = html.indexOf('</form>', start);
  const form = end > 0 ? html.slice(start, end + 7) : html.slice(start, start + 4000);
  console.log(`\n== Volles Suchformular (${form.length} bytes) ==`);
  console.log(form);
}

async function main() {
  console.log(`▶ Siemens-Diagnose (Avature, SSR unter /en_US/externaljobs/...)`);
  console.log(`▶ Fetch: ${SEARCH_URL}`);
  const html = await fetchText(SEARCH_URL);
  console.log(`▶ HTML: ${html.length} bytes`);

  dumpFullForm(html);
  dumpJobItemContext(html);

  console.log(`\n== HTML-Needle-Scan ==`);
  for (const needle of NEEDLES) {
    const matches = findMatches(html, needle);
    if (matches.length) {
      console.log(`\n"${needle}" — ${matches.length} Treffer:`);
      matches.forEach(m => console.log(`  @${m.pos}: ${m.snippet.replace(/\s+/g, ' ').slice(0, 320)}`));
    }
  }

  // JS-Bundles sammeln + auf AJAX/Facet/Such-Muster durchsuchen
  const scriptRefs = Array.from(html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)).map(m => m[1]);
  const baseOrigin = new URL(SEARCH_URL).origin;
  const bundles = Array.from(new Set(scriptRefs))
    .filter(src => /\.js(\?|$|#)/i.test(src))
    .map(src => (src.startsWith('http') ? src : src.startsWith('/') ? baseOrigin + src : `${baseOrigin}/${src}`));
  console.log(`\n== JS-Bundles: ${bundles.length} ==`);
  bundles.forEach(u => console.log(`  ${u}`));

  const bundleNeedles = ['/api/', 'graphql', 'searchJobs', 'jobRecordsPerPage', 'requisition', 'ajax(', 'XMLHttpRequest', 'FormData', 'facet', 'schemaField', 'startRow', 'country'];
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
    for (const needle of bundleNeedles) {
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

  // POST-Test: Suchbegriff "München" bzw. "Munich" ins Suchfeld
  for (const term of ['München', 'Munich']) {
    console.log(`\n\n########## POST-Test: search="${term}" ##########`);
    try {
      const resultHtml = await fetchPost(SEARCH_URL, {
        search: term,
        folderSort: '',
        folderSortDirection: '',
        listFilterMode: '',
      });
      console.log(`▶ Antwort: ${resultHtml.length} bytes`);
      const jobLinks = Array.from(new Set(Array.from(resultHtml.matchAll(/<a class="link" href="([^"]*JobDetail[^"]*)"/g)).map(m => m[1])));
      console.log(`▶ Echte Job-Links (class="link"): ${jobLinks.length}`);
      jobLinks.slice(0, 10).forEach(l => console.log(`  ${l}`));
      const locs = Array.from(new Set(Array.from(resultHtml.matchAll(/<span class="list-item-jobCity">([^<]*)<\/span>/g)).map(m => m[1])));
      console.log(`▶ Städte in Ergebnis: ${locs.slice(0, 15).join(', ')}`);
    } catch (e) {
      console.log(`[fail] ${(e as Error).message}`);
    }
  }

  console.log(`\n▶ Fertig.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
