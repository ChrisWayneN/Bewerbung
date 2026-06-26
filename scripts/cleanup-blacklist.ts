#!/usr/bin/env node
/**
 * Wendet die aktuelle Blacklist (src/config/blacklist.json) auf die bestehende DB an,
 * ohne neu zu scrapen. Praktisch nach Liste-Erweiterung.
 *
 *   npm run cleanup
 */
import { getBlacklistKeywords } from '../src/lib/blacklist';
import { deleteJobsByTitleKeywords } from '../src/lib/db';

const keywords = getBlacklistKeywords();
if (!keywords.length) {
  console.log('⚠️  Blacklist leer (src/config/blacklist.json). Nichts zu tun.');
  process.exit(0);
}

console.log(`Blacklist: ${keywords.join(', ')}`);
const r = deleteJobsByTitleKeywords(keywords);
console.log(`✅ ${r.deleted} Stellen gelöscht.`);
if (r.samples.length) {
  console.log('  Beispiele:');
  r.samples.forEach(t => console.log(`    · ${t}`));
}
