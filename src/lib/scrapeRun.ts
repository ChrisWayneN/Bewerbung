import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Gemeinsamer Zustand eines Scrape-Laufs – egal ob gestartet über den Button
 * auf der Seite, den Starter, "Jobs scrapen" oder den täglichen Lauf.
 *   debug/scrape.lock     – {pid, startedAt}, solange ein Lauf aktiv ist
 *   debug/scrape-web.log  – Ausgabe des letzten über die Seite gestarteten Laufs
 */
export const DEBUG_DIR = resolve(process.cwd(), 'debug');
export const LOCK_PATH = resolve(DEBUG_DIR, 'scrape.lock');
export const WEB_LOG_PATH = resolve(DEBUG_DIR, 'scrape-web.log');
/** Ältere Sperren gelten als hängengeblieben (Rechner abgestürzt o.ä.). */
const STALE_MS = 2 * 60 * 60 * 1000;

export interface ScrapeLock { pid: number; startedAt: string }

export function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Aktive Sperre oder null (abgelaufene/verwaiste Sperren zählen nicht). */
export function readActiveLock(): ScrapeLock | null {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as ScrapeLock;
    if (Date.now() - Date.parse(lock.startedAt) > STALE_MS || !isPidAlive(lock.pid)) return null;
    return lock;
  } catch {
    return null;
  }
}

/** Sperre für diesen Prozess setzen; false, wenn schon ein anderer Lauf aktiv ist. */
export function acquireLock(): boolean {
  if (readActiveLock()) return false;
  mkdirSync(DEBUG_DIR, { recursive: true });
  writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  process.on('exit', releaseLock);
  return true;
}

export function releaseLock(): void {
  try {
    const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as ScrapeLock;
    if (lock.pid === process.pid) unlinkSync(LOCK_PATH);
  } catch { /* schon weg */ }
}
