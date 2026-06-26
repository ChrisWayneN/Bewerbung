import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface BlacklistFile {
  titleKeywords?: string[];
}

const CONFIG_PATH = resolve(process.cwd(), 'src', 'config', 'blacklist.json');

let _cached: { keywords: string[]; needles: string[] } | null = null;

/** Schwelle: Begriffe mit ≤ N Zeichen brauchen Wortgrenzen, sonst Substring. */
const SHORT_KEYWORD_THRESHOLD = 3;

/**
 * Normalisierung vor dem Match: lowercase, gängige Wort-Trenner (Bindestrich,
 * Unterstrich, Slash, Backslash) zu Leerzeichen, mehrfache Whitespace zu einem.
 * Damit matcht „Software Engineer" auch „Software-Engineer", „Software_Engineer",
 * „Software/Engineer", „Software  Engineer".
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getBlacklistKeywords(): string[] {
  if (_cached) return _cached.keywords;
  if (!existsSync(CONFIG_PATH)) return [];
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw) as BlacklistFile;
  const keywords = (parsed.titleKeywords ?? []).map(s => s.trim()).filter(Boolean);
  _cached = { keywords, needles: keywords.map(normalizeForMatch) };
  return _cached.keywords;
}

/**
 * Einzel-Match mit Schwellen-Logik:
 *  - Begriffe mit ≤ 3 Zeichen werden als ganzes Wort gematcht (Wortgrenzen)
 *    → „IT" matcht „IT-Architekt", aber NICHT „Karriereseite"/„Audit"
 *  - Begriffe ab 4 Zeichen werden als Substring gematcht (wie bisher)
 *    → „Marketing" matcht auch „Marketingstrategie"
 */
export function matchNeedle(normalizedHay: string, normalizedNeedle: string): boolean {
  if (!normalizedNeedle) return false;
  if (normalizedNeedle.length <= SHORT_KEYWORD_THRESHOLD) {
    return ` ${normalizedHay} `.includes(` ${normalizedNeedle} `);
  }
  return normalizedHay.includes(normalizedNeedle);
}

/** Case-insensitive Phrasen-Match (Trenner-tolerant, mit Wortgrenzen für kurze Begriffe). */
export function isBlacklisted(title: string): boolean {
  if (!title) return false;
  if (!_cached) getBlacklistKeywords();
  const hay = normalizeForMatch(title);
  return _cached!.needles.some(n => matchNeedle(hay, n));
}

/** Liefert das gematchte Keyword zurück (für Debug-Logs). */
export function matchedBlacklistTerm(title: string): string | null {
  if (!title) return null;
  if (!_cached) getBlacklistKeywords();
  const hay = normalizeForMatch(title);
  const idx = _cached!.needles.findIndex(n => matchNeedle(hay, n));
  return idx >= 0 ? _cached!.keywords[idx] : null;
}
