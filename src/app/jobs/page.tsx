import Link from 'next/link';
import { listJobs, listCompanies, getScraperStatuses } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  company?: string;
  neu?: string;
  hidden?: string;
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const jobs = listJobs({
    q: sp.q,
    company: sp.company,
    onlyNew: sp.neu === '1',
    includeHidden: sp.hidden === '1',
  });
  const companies = listCompanies();
  const statuses = getScraperStatuses();

  const newCount = jobs.filter(j => j.is_new).length;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Volltext-Suche</label>
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="z. B. embedded, robotics, C++, München"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Firma</label>
          <select
            name="company"
            defaultValue={sp.company ?? ''}
            className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
          >
            <option value="">— alle —</option>
            {companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" name="neu" value="1" defaultChecked={sp.neu === '1'} />
          Nur Neue
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" name="hidden" value="1" defaultChecked={sp.hidden === '1'} />
          Inkl. Ausgeblendete
        </label>
        <button className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium">
          Anwenden
        </button>
        {(sp.q || sp.company || sp.neu || sp.hidden) && (
          <Link href="/jobs" className="text-sm underline text-neutral-500 pb-2">zurücksetzen</Link>
        )}
      </form>

      <div className="text-sm text-neutral-500 flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span>{jobs.length} Stellen</span>
        {newCount > 0 && <span className="text-emerald-600 dark:text-emerald-400">{newCount} neu seit letztem Import</span>}
        <span>·</span>
        <Link href="/jobs/status" className="underline">Scraper-Status ({statuses.length})</Link>
      </div>

      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-2">Firma</th>
              <th className="px-3 py-2">Titel</th>
              <th className="px-3 py-2">Standort</th>
              <th className="px-3 py-2">Quelle</th>
              <th className="px-3 py-2">Import</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-neutral-500">
                Keine Stellen. Lauf <code>npm run scrape</code> aus, um die DB zu befüllen.
              </td></tr>
            )}
            {jobs.map(j => (
              <tr key={j.id} className={'border-t border-neutral-200 dark:border-neutral-800 ' + (j.hidden ? 'opacity-50' : '')}>
                <td className="px-3 py-2 font-medium">{j.company}</td>
                <td className="px-3 py-2">
                  <Link href={`/jobs/${j.id}`} className="hover:underline">
                    {j.title}
                  </Link>
                  {j.is_new && (
                    <span className="ml-2 inline-block text-[10px] uppercase tracking-wider bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                      neu
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-neutral-500">{j.location ?? '—'}</td>
                <td className="px-3 py-2">
                  <a href={j.url} target="_blank" rel="noreferrer" className="underline text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
                    {j.source_portal ?? 'Link'} ↗
                  </a>
                </td>
                <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">
                  {new Date(j.first_seen).toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2">
                  <HideButton id={j.id} hidden={!!j.hidden} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HideButton({ id, hidden }: { id: number; hidden: boolean }) {
  // Server-rendered link to a tiny route that toggles hidden state, then 303s back.
  return (
    <form action={`/api/jobs/${id}/hide`} method="post">
      <input type="hidden" name="to" value={hidden ? '0' : '1'} />
      <button className="text-xs text-neutral-500 hover:text-red-600">
        {hidden ? 'einblenden' : 'ausblenden'}
      </button>
    </form>
  );
}
