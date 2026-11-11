import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEBUG_DIR, WEB_LOG_PATH, isPidAlive, readActiveLock } from '@/lib/scrapeRun';

export const dynamic = 'force-dynamic';

/** Über die Seite gestarteter Lauf – bis das Skript seine Sperre geschrieben hat. */
let webRun: { pid: number; startedAt: string } | null = null;

function status() {
  const lock = readActiveLock();
  const webAlive = webRun && isPidAlive(webRun.pid) ? webRun : null;
  const running = !!(lock || webAlive);
  const fromWeb = !!webAlive || (!!lock && lock.pid === webRun?.pid);
  let lines: string[] = [];
  let summary: string | null = null;
  let finishedAt: string | null = null;
  if (existsSync(WEB_LOG_PATH)) {
    const log = readFileSync(WEB_LOG_PATH, 'utf8').split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
    lines = log.slice(-8);
    summary = [...log].reverse().find(l => l.startsWith('▶ Fertig')) ?? null;
    if (!running) finishedAt = statSync(WEB_LOG_PATH).mtime.toISOString();
  }
  return {
    running,
    startedAt: lock?.startedAt ?? webAlive?.startedAt ?? null,
    // Lauf über Starter/täglichen Lauf: dessen Ausgabe steht nicht im Web-Log.
    external: running && !fromWeb,
    lines: running && !fromWeb ? [] : lines,
    summary: running ? null : summary,
    finishedAt,
  };
}

export async function GET() {
  return NextResponse.json(status());
}

export async function POST() {
  if (status().running) return NextResponse.json({ ...status(), error: 'Es läuft bereits ein Scrape-Lauf.' }, { status: 409 });
  mkdirSync(DEBUG_DIR, { recursive: true });
  const out = openSync(WEB_LOG_PATH, 'w');
  // Gleiches Skript wie "npm run scrape", als eigener Prozess (blockiert den Server nicht).
  const child = spawn(process.execPath, [resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/scrape.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  closeSync(out);
  if (!child.pid) return NextResponse.json({ ...status(), error: 'Scrape-Lauf konnte nicht gestartet werden.' }, { status: 500 });
  webRun = { pid: child.pid, startedAt: new Date().toISOString() };
  child.on('exit', () => { /* Status ergibt sich aus Sperre/Log */ });
  return NextResponse.json(status());
}
