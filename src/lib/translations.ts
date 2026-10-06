import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Deutsche Übersetzungen englischer Aufgaben/Profile.
 *
 * Die Übersetzungen liegen in translations/de.json als { <Schlüssel>: <deutscher Text> }.
 * Der Schlüssel ist ein Hash des englischen Originaltexts – eine Übersetzung gilt
 * also, solange sich der Text nicht ändert, und gleiche Texte mehrerer Stellen
 * werden nur einmal übersetzt. Die Datenbank bleibt unverändert.
 *
 * Ablauf: npm run translate:export → translations/todo.json → übersetzen →
 * Einträge in translations/de.json → Detailseite zeigt den deutschen Text.
 */

export const TRANSLATIONS_DIR = resolve(process.cwd(), 'translations');
const DE_FILE = resolve(TRANSLATIONS_DIR, 'de.json');

/** Schlüssel eines Texts (unabhängig von Zeilenende-Stil und Rand-Leerzeichen). */
export function textKey(text: string): string {
  const norm = text.replace(/\r\n/g, '\n').trim();
  return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

const EN_WORDS = new Set([
  'the', 'and', 'to', 'of', 'with', 'you', 'your', 'for', 'our', 'we', 'will', 'a', 'an',
  'are', 'is', 'on', 'as', 'be', 'or', 'have', 'experience', 'team', 'work', 'this', 'that',
  'from', 'at', 'strong', 'knowledge', 'skills', 'ability', 'working', 'develop', 'design',
  'related', 'degree', 'field', 'using', 'such', 'years', 'least', 'plus', 'similar', 'equivalent',
]);
const DE_WORDS = new Set([
  'und', 'der', 'die', 'das', 'mit', 'für', 'von', 'zu', 'im', 'den', 'dem', 'des', 'ein', 'eine',
  'einer', 'sie', 'ihre', 'ihr', 'wir', 'unser', 'unsere', 'bei', 'auf', 'ist', 'sind', 'oder',
  'du', 'dein', 'deine', 'dich', 'kenntnisse', 'erfahrung', 'sowie', 'als', 'idealerweise',
]);

/** Grobe Spracherkennung über häufige Wörter – reicht, um englische Abschnitte
 *  von deutschen zu unterscheiden. Fachbegriffe ("Embedded", "C++") stören nicht. */
export function isEnglish(text: string): boolean {
  let en = 0, de = 0;
  for (const w of text.toLowerCase().match(/[a-zäöüß]+/g) ?? []) {
    if (EN_WORDS.has(w)) en++;
    else if (DE_WORDS.has(w)) de++;
  }
  // Schon 2 Treffer reichen – kurze Profilzeilen wie "MSc in Robotics or a related
  // field" haben kaum Füllwörter. Deutsche Texte mit einzelnen englischen
  // Fachbegriffen kippen nicht, weil deutsche Füllwörter dagegen zählen.
  return en >= 2 && en > de * 1.5;
}

let cache: { mtimeMs: number; data: Record<string, string> } | null = null;

/** Liest translations/de.json (neu, sobald sich die Datei ändert – z.B. nach git pull). */
export function loadTranslations(): Record<string, string> {
  if (!existsSync(DE_FILE)) return {};
  const mtimeMs = statSync(DE_FILE).mtimeMs;
  if (!cache || cache.mtimeMs !== mtimeMs) {
    try {
      cache = { mtimeMs, data: JSON.parse(readFileSync(DE_FILE, 'utf8')) as Record<string, string> };
    } catch {
      cache = { mtimeMs, data: {} }; // kaputte Datei → einfach ohne Übersetzungen anzeigen
    }
  }
  return cache.data;
}

/** Deutsche Fassung eines englischen Texts, falls vorhanden. */
export function translationFor(text: string | null): string | null {
  if (!text || !isEnglish(text)) return null;
  return loadTranslations()[textKey(text)] ?? null;
}
