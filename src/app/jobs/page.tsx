import Link from 'next/link';
import { listJobs, listCompanies, getScraperStatuses, getCompanyCounts, type JobSort } from '@/lib/db';
import { COMPANY_CATEGORIES } from '@/lib/categories';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  company?: string;
  neu?: string;
  hidden?: string;
  sort?: string;
}

function parseSort(v: string | undefined): JobSort | undefined {
  return v === 'rating-desc' || v === 'rating-asc' ? v : undefined;
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const jobs = listJobs({
    q: sp.q,
    company: sp.company,
    onlyNew: sp.neu === '1',
    includeHidden: sp.hidden === '1',
    sort: parseSort(sp.sort),
  });
  const companies = listCompanies();
  const counts = getCompanyCounts({ onlyNew: sp.neu === '1', includeHidden: sp.hidden === '1' });
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
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
            <option value="">{`— alle — (${totalCount})`}</option>
            {Object.entries(COMPANY_CATEGORIES).flatMap(([cat, members]) => {
              const catCount = members.reduce((s, c) => s + (counts[c] ?? 0), 0);
              return [
                <option key={'kat:' + cat} value={'kat:' + cat}>{`${cat} (${catCount})`}</option>,
                ...members.map(c => (
                  <option key={c} value={c}>{`   ${c} (${counts[c] ?? 0})`}</option>
                )),
              ];
            })}
            {(() => {
              const categorised = new Set(Object.values(COMPANY_CATEGORIES).flat());
              const others = companies.filter(c => !categorised.has(c));
              if (!others.length) return null;
              return [
                <option key="sonstige-label" disabled>Sonstige</option>,
                ...others.map(c => (
                  <option key={c} value={c}>{`   ${c} (${counts[c] ?? 0})`}</option>
                )),
              ];
            })()}
          </select>
        </div>
        {/* Sortierung wird über die Spaltenkopf-Pfeile bei "Bewertung" gesteuert, nicht hier. */}
        <input type="hidden" name="sort" value={sp.sort ?? ''} />
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
        {(sp.q || sp.company || sp.neu || sp.hidden || sp.sort) && (
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
              <th className="px-3 py-2">
                <span className="inline-flex items-center gap-1">
                  Bewertung
                  <SortArrows sp={sp} />
                </span>
              </th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-neutral-500">
                Keine Stellen. Lauf <code>npm run scrape</code> aus, um die DB zu befüllen.
              </td></tr>
            )}
            {jobs.map(j => {
              const tint =
                j.rating === 'A'  ? 'bg-emerald-50 dark:bg-emerald-900/20' :
                j.rating === 'AB' ? 'bg-yellow-50 dark:bg-yellow-900/20'  :
                j.rating === 'B'  ? 'bg-rose-50 dark:bg-rose-900/20'      : '';
              return (
                <tr key={j.id} className={'border-t border-neutral-200 dark:border-neutral-800 ' + tint + ' ' + (j.hidden ? 'opacity-50' : '')}>
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
                    <RatingButtons id={j.id} rating={j.rating} />
                  </td>
                  <td className="px-3 py-2">
                    <HideButton id={j.id} hidden={!!j.hidden} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortArrows({ sp }: { sp: SearchParams }) {
  // Zwei Pfeile als Links. Aktiver Pfeil ist gefärbt; Klick auf den aktiven
  // Pfeil setzt die Sortierung zurück (Standard = Neueste zuerst).
  const buildHref = (target: 'rating-desc' | 'rating-asc' | undefined) => {
    const p = new URLSearchParams();
    if (sp.q) p.set('q', sp.q);
    if (sp.company) p.set('company', sp.company);
    if (sp.neu) p.set('neu', sp.neu);
    if (sp.hidden) p.set('hidden', sp.hidden);
    if (target) p.set('sort', target);
    const qs = p.toString();
    return qs ? `/jobs?${qs}` : '/jobs';
  };
  const descActive = sp.sort === 'rating-desc';
  const ascActive  = sp.sort === 'rating-asc';
  return (
    <span className="inline-flex flex-col text-[9px] leading-[9px]">
      <Link
        href={buildHref(ascActive ? undefined : 'rating-asc')}
        title={ascActive ? 'Sortierung zurücksetzen' : 'Sortieren B → A/B → A'}
        className={ascActive ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-300 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'}
      >▲</Link>
      <Link
        href={buildHref(descActive ? undefined : 'rating-desc')}
        title={descActive ? 'Sortierung zurücksetzen' : 'Sortieren A → A/B → B'}
        className={descActive ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-300 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'}
      >▼</Link>
    </span>
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

function RatingButtons({ id, rating }: { id: number; rating: string | null }) {
  // Drei Pill-Buttons. Klick setzt das Rating, Klick auf den aktiven löscht es.
  const opts: { value: 'A' | 'AB' | 'B'; label: string; active: string }[] = [
    { value: 'A',  label: 'A',   active: 'bg-emerald-500/40 text-emerald-800 dark:text-emerald-200 font-semibold' },
    { value: 'AB', label: 'A/B', active: 'bg-yellow-500/40 text-yellow-800 dark:text-yellow-200 font-semibold' },
    { value: 'B',  label: 'B',   active: 'bg-rose-500/40 text-rose-800 dark:text-rose-200 font-semibold' },
  ];
  return (
    <div className="flex gap-1">
      {opts.map(o => {
        const isActive = rating === o.value;
        return (
          <form key={o.value} action={`/api/jobs/${id}/rating`} method="post">
            <input type="hidden" name="to" value={isActive ? '' : o.value} />
            <button
              className={'text-[10px] px-1.5 py-0.5 rounded border ' +
                (isActive
                  ? o.active + ' border-transparent'
                  : 'text-neutral-400 border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800')}
              title={isActive ? 'Bewertung zurücksetzen' : `Als ${o.label}-Stelle markieren`}
            >
              {o.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
