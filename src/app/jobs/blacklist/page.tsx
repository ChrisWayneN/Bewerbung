import Link from 'next/link';
import { listBlacklisted } from '@/lib/db';
import { matchedBlacklistTerm } from '@/lib/blacklist';

export const dynamic = 'force-dynamic';

/** Blatt 3: Stellen, die die Blacklist beim Scrapen aussortiert hat – nur
 *  Titel/Firma/Ort, zur Kontrolle, ob nichts Wichtiges rausfällt. */
export default async function BlacklistPage({ searchParams }: { searchParams: Promise<{ term?: string; company?: string }> }) {
  const sp = await searchParams;
  // Schlagwort mit der AKTUELLEN Blacklist bestimmen – wurde ein Wort inzwischen
  // entfernt, kommt die Stelle beim nächsten Scrapen in die normale Liste.
  const all = listBlacklisted().map(j => ({ ...j, current: matchedBlacklistTerm(j.title) }));
  const NONE = '(nicht mehr auf Blacklist)';
  const termOf = (j: { current: string | null }) => j.current ?? NONE;

  const termCounts = new Map<string, number>();
  for (const j of all) termCounts.set(termOf(j), (termCounts.get(termOf(j)) ?? 0) + 1);
  const terms = [...termCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const companies = [...new Set(all.map(j => j.company))].sort();

  const rows = all.filter(j => (!sp.term || termOf(j) === sp.term) && (!sp.company || j.company === sp.company));
  const href = (p: { term?: string; company?: string }) => {
    const q = new URLSearchParams();
    if (p.term) q.set('term', p.term);
    if (p.company) q.set('company', p.company);
    const s = q.toString();
    return s ? `/jobs/blacklist?${s}` : '/jobs/blacklist';
  };
  const chip = (active: boolean) =>
    'rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap ' +
    (active
      ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100'
      : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800');

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-500">
        Diese Stellen hat die Blacklist (Schlagwörter im Titel, <code>src/config/blacklist.json</code>) beim
        letzten Scrapen aussortiert – sie erscheinen nicht unter „Stellen“. Ist etwas Wichtiges dabei, das
        Schlagwort aus der Blacklist nehmen; beim nächsten Scrapen kommt die Stelle dann in die normale Liste.
      </p>

      {all.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs uppercase tracking-wider text-neutral-500 mr-1">Schlagwort</span>
            <Link href={href({ company: sp.company })} className={chip(!sp.term)}>alle ({all.length})</Link>
            {terms.map(([t, c]) => (
              <Link key={t} href={href({ term: t, company: sp.company })} className={chip(sp.term === t)}>{t} ({c})</Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs uppercase tracking-wider text-neutral-500 mr-1">Firma</span>
            <Link href={href({ term: sp.term })} className={chip(!sp.company)}>alle</Link>
            {companies.map(c => (
              <Link key={c} href={href({ term: sp.term, company: c })} className={chip(sp.company === c)}>{c}</Link>
            ))}
          </div>
        </div>
      )}

      <div className="text-sm text-neutral-500">{rows.length} aussortierte Stellen</div>

      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-2">Firma</th>
              <th className="px-3 py-2">Titel</th>
              <th className="px-3 py-2">Standort</th>
              <th className="px-3 py-2">Schlagwort</th>
              <th className="px-3 py-2">Zuletzt gesehen</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-500">
                {all.length
                  ? 'Keine Treffer für diesen Filter.'
                  : 'Noch nichts erfasst – die Liste füllt sich beim nächsten Scrapen.'}
              </td></tr>
            )}
            {rows.map(j => (
              <tr key={j.url} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="px-3 py-2 font-medium align-top">{j.company}</td>
                <td className="px-3 py-2 align-top">
                  <a href={j.url} target="_blank" rel="noreferrer" className="hover:underline" title="Original-Anzeige öffnen">{j.title}</a>
                </td>
                <td className="px-3 py-2 text-neutral-500 align-top">{j.location ?? '—'}</td>
                <td className="px-3 py-2 align-top">
                  {j.current
                    ? <span className="rounded bg-neutral-200 dark:bg-neutral-700 px-1.5 py-0.5 text-xs">{j.current}</span>
                    : <span className="text-xs text-emerald-600 dark:text-emerald-400">nicht mehr auf Blacklist – kommt beim nächsten Scrapen zurück</span>}
                </td>
                <td className="px-3 py-2 text-neutral-500 whitespace-nowrap align-top">
                  {new Date(j.last_seen).toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
