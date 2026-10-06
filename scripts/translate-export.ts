#!/usr/bin/env node
/**
 * Schreibt alle englischen Aufgaben/Profile, für die es noch keine deutsche
 * Übersetzung gibt, nach translations/todo.json – zum Übersetzen durch Claude.
 * Ausgeblendete und nicht mehr ausgeschriebene Stellen werden ausgelassen.
 *
 *   npm run translate:export
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listJobs } from '../src/lib/db';
import { isEnglish, loadTranslations, textKey, TRANSLATIONS_DIR } from '../src/lib/translations';

const done = loadTranslations();
const todo = new Map<string, { key: string; abschnitt: string; stelle: string; text: string }>();

for (const job of listJobs()) {
  if (job.is_closed) continue;
  for (const [abschnitt, text] of [['Aufgaben', job.tasks], ['Profil', job.qualifications]] as const) {
    if (!text || !isEnglish(text)) continue;
    const key = textKey(text);
    if (done[key] || todo.has(key)) continue;
    todo.set(key, { key, abschnitt, stelle: `${job.company} – ${job.title}`, text });
  }
}

mkdirSync(TRANSLATIONS_DIR, { recursive: true });
const file = resolve(TRANSLATIONS_DIR, 'todo.json');
const items = [...todo.values()];
writeFileSync(file, JSON.stringify(items, null, 2) + '\n', 'utf8');

if (!items.length) {
  console.log('Nichts zu übersetzen – alle englischen Texte haben schon eine deutsche Fassung.');
} else {
  const chars = items.reduce((s, i) => s + i.text.length, 0);
  console.log(`${items.length} englische Texte (${chars.toLocaleString('de-DE')} Zeichen) nach translations/todo.json geschrieben.`);
  console.log('');
  console.log('Zum Übersetzen an Claude hochladen:');
  console.log('  git add translations/todo.json');
  console.log('  git commit -m "Texte zum Uebersetzen"');
  console.log('  git push origin HEAD:claude/upbeat-wozniak-4x4pxd');
}
