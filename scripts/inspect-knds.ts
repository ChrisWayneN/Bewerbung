#!/usr/bin/env node
/**
 * Diagnose für KNDS-Beschreibungen: zeigt für Stellen, deren Titel den Suchtext
 * enthält, ALLE Felder aus der KNDS-API (Texte gekürzt) und was die verlinkte
 * Stellenseite liefert. Damit lässt sich sehen, in welchem Feld der echte Text
 * steht, wenn die Detailansicht nur "Lorem Impsum" zeigt.
 *
 *   npm run inspect-knds -- Leopard
 *   npm run inspect-knds -- Leopard > knds-debug.txt    (in Datei umleiten)
 */
import { fetchKndsItems } from '../src/scrapers/companies';
import { fetchText } from '../src/scrapers/base';

const needle = process.argv.slice(2).join(' ').trim().toLowerCase();
if (!needle) {
  console.error('Bitte einen Teil des Stellentitels angeben, z.B.: npm run inspect-knds -- Leopard');
  process.exit(1);
}

function dump(val: unknown, path: string, depth = 0) {
  if (typeof val === 'string') {
    const v = val.replace(/\s+/g, ' ');
    console.log(`  ${path} (${val.length} Zeichen): ${v.length > 1500 ? v.slice(0, 1500) + ' …' : v}`);
  } else if (Array.isArray(val)) {
    console.log(`  ${path}: Liste mit ${val.length} Einträgen`);
    if (depth < 4) val.slice(0, 15).forEach((el, i) => dump(el, `${path}[${i}]`, depth + 1));
  } else if (val && typeof val === 'object') {
    if (depth < 4) for (const [k, v] of Object.entries(val)) dump(v, path ? `${path}.${k}` : k, depth + 1);
  } else {
    console.log(`  ${path}: ${String(val)}`);
  }
}

(async () => {
  const { items } = await fetchKndsItems();
  const hits = items.filter(it => String(it.title ?? it.jobTitle ?? it.name ?? '').toLowerCase().includes(needle));
  console.log(`▶ KNDS-API: ${items.length} Stellen, ${hits.length} mit "${needle}" im Titel\n`);
  for (const it of hits.slice(0, 3)) {
    console.log(`==== ${String(it.title ?? it.jobTitle ?? it.name)} ====`);
    dump(it, '');
    const link = (it.url ?? it.applyUrl ?? it.detailUrl ?? it.navigateLink ?? it.permalink) as string | undefined;
    if (link) {
      const url = link.startsWith('http') ? link : new URL(link, 'https://jobs.knds.de').toString();
      try {
        const html = await fetchText(url);
        const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        console.log(`\n  Stellenseite ${url}: ${html.length} Bytes HTML, JSON-LD: ${/application\/ld\+json/i.test(html) ? 'ja' : 'nein'}`);
        console.log(`  Seitentext (Auszug): ${text.slice(0, 1500)}`);
      } catch (e) {
        console.log(`\n  Stellenseite ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log('');
  }
})();
