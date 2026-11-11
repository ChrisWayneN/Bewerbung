'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Status {
  running: boolean;
  startedAt: string | null;
  external: boolean;
  lines: string[];
  summary: string | null;
  finishedAt: string | null;
  error?: string;
}

/** Button "Jetzt scrapen" in der Kopfleiste: startet den Lauf auf dem Server,
 *  zeigt die letzte Zeile der Ausgabe und lädt die Liste neu, wenn er fertig ist. */
export function ScrapeButton() {
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [showLog, setShowLog] = useState(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const s = (await (await fetch('/api/scrape', { cache: 'no-store' })).json()) as Status;
      setSt(s);
      if (wasRunning.current && !s.running) router.refresh();
      wasRunning.current = s.running;
    } catch { /* Server kurz weg – nächster Versuch */ }
  }, [router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!st?.running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [st?.running, load]);

  async function start() {
    const r = await fetch('/api/scrape', { method: 'POST' });
    const s = (await r.json()) as Status;
    setSt(s);
    wasRunning.current = s.running;
  }

  const running = !!st?.running;
  const last = st?.lines.at(-1);
  const info = running
    ? (st!.external ? 'läuft (über Starter/täglichen Lauf gestartet)' : last ?? 'startet…')
    : st?.error ?? (st?.summary && st.finishedAt
        ? `${st.summary.replace(/^▶\s*/, '')} – ${new Date(st.finishedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
        : null);

  return (
    <div className="relative flex items-center gap-2 min-w-0">
      {info && (
        <button
          type="button"
          onClick={() => setShowLog(v => !v)}
          className="text-xs text-neutral-500 truncate max-w-[260px] hover:underline"
          title="Ausgabe anzeigen"
        >
          {info}
        </button>
      )}
      <button
        type="button"
        onClick={start}
        disabled={running}
        className={'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ' +
          (running
            ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500 cursor-wait'
            : 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:opacity-90')}
        title="Neue Stellen von allen Firmen holen (dauert ein paar Minuten)"
      >
        {running ? 'Scrapen läuft…' : 'Jetzt scrapen'}
      </button>
      {showLog && st && st.lines.length > 0 && (
        <pre className="absolute right-0 top-full mt-2 z-30 w-[min(560px,90vw)] max-h-64 overflow-auto rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 text-[11px] leading-4 shadow-lg whitespace-pre-wrap">
          {st.lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
