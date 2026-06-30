import Link from 'next/link';
import { listJobs, listCompanies, getScraperStatuses, getCompanyCounts, type JobSort } from '@/lib/db';
import { COMPANY_CATEGORIES } from '@/lib/categories';
import { AutoSubmitCheckbox } from './AutoSubmitCheckbox';
import { FilterDropdown } from './FilterDropdown';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  company?: string;
  neu?: string;
  hidden?: string;
  abg?: string;
  a?: string;
  beworben?: string;
  prozess?: string;
  sort?: string;
}

const ALL_SORTS: JobSort[] = ['rating-desc', 'rating-asc', 'status-asc', 'status-desc'];
function parseSort(v: string | undefined): JobSort | undefined {
  return (ALL_SORTS as string[]).includes(v ?? '') ? (v as JobSort) : undefined;
}

const CAT_STYLE = { fontWeight: 700, textDecoration: 'underline' } as const;

function activeFilterCount(sp: SearchParams): number {
  return [sp.neu, sp.hidden, sp.abg, sp.a, sp.beworben, sp.prozess].filter(v => v === '1').length;
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filterFlags = {
    onlyNew: sp.neu === '1',
    includeHidden: sp.hidden === '1',
    includeRejected: sp.abg === '1',
    onlyA: sp.a === '1',
    onlyApplied: sp.beworben === '1',
    onlyInProcess: sp.prozess === '1',
  };
  const jobs = listJobs({
    q: sp.q,
    company: sp.company,
    ...filterFlags,
    sort: parseSort(sp.sort),
  });
  const companies = listCompanies();
  const counts = getCompanyCounts(filterFlags);
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
                <option key={'kat:' + cat} value={'kat:' + cat} style={CAT_STYLE}>{`${cat} (${catCount})`}</option>,
                ...members.map(c => (
                  <option key={c} value={c}>{`    ${c} (${counts[c] ?? 0})`}</option>
                )),
              ];
            })}
            {(() => {
              const categorised = new Set(Object.values(COMPANY_CATEGORIES).flat());
              const others = companies.filter(c => !categorised.has(c));
              if (!others.length) return null;
              return [
                <option key="sonstige-label" disabled style={CAT_STYLE}>Sonstige</option>,
                ...others.map(c => (
                  <option key={c} value={c}>{`    ${c} (${counts[c] ?? 0})`}</option>
                )),
              ];
            })()}
          </select>
        </div>
        {/* Sortierung wird über die Spaltenkopf-Pfeile bei Status & Bewertung gesteuert, nicht hier. */}
        <input type="hidden" name="sort" value={sp.sort ?? ''} />
        <div>
          <label className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Filter</label>
          <FilterDropdown label="Filter" activeCount={activeFilterCount(sp)}>
            <AutoSubmitCheckbox name="neu" value="1" defaultChecked={sp.neu === '1'}>Nur Neue</AutoSubmitCheckbox>
            <AutoSubmitCheckbox name="hidden" value="1" defaultChecked={sp.hidden === '1'}>Inkl. Ausgeblendete</AutoSubmitCheckbox>
            <AutoSubmitCheckbox name="abg" value="1" defaultChecked={sp.abg === '1'}>Inkl. Abgelehnt</AutoSubmitCheckbox>
            <AutoSubmitCheckbox name="a" value="1" defaultChecked={sp.a === '1'}>Nur A-Bewertung</AutoSubmitCheckbox>
            <AutoSubmitCheckbox name="beworben" value="1" defaultChecked={sp.beworben === '1'}>Beworben</AutoSubmitCheckbox>
            <AutoSubmitCheckbox name="prozess" value="1" defaultChecked={sp.prozess === '1'}>Im Bewerbungsprozess</AutoSubmitCheckbox>
          </FilterDropdown>
        </div>
        <button className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium">
          Anwenden
        </button>
        {(sp.q || sp.company || sp.neu || sp.hidden || sp.abg || sp.a || sp.beworben || sp.prozess || sp.sort) && (
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
              <th className="px-3 py-2 whitespace-nowrap" style={{ minWidth: '210px' }}>
                <span className="inline-flex items-center gap-1">
                  Status
                  <SortArrows sp={sp} ascValue="status-asc" descValue="status-desc"
                    ascTitle="Sortieren Neu → Abgelehnt" descTitle="Sortieren Abgelehnt → Neu" />
                </span>
              </th>
              <th className="px-3 py-2">Titel</th>
              <th className="px-3 py-2">Standort</th>
              <th className="px-3 py-2">Import</th>
              <th className="px-3 py-2">
                <span className="inline-flex items-center gap-1">
                  Bewertung
                  <SortArrows sp={sp} ascValue="rating-asc" descValue="rating-desc"
                    ascTitle="Sortieren B → A/B → A" descTitle="Sortieren A → A/B → B" />
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
                  <td className="px-3 py-2 font-medium align-top">{j.company}</td>
                  <td className="px-3 py-2 align-top" style={{ minWidth: '210px' }}>
                    <StatusButtons id={j.id} status={j.status} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Link href={`/jobs/${j.id}`} className="hover:underline">
                      {j.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-neutral-500 align-top">{j.location ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-500 whitespace-nowrap align-top">
                    {new Date(j.first_seen).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <RatingButtons id={j.id} rating={j.rating} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col gap-1">
                      <HideButton id={j.id} hidden={!!j.hidden} />
                      <RejectButton id={j.id} status={j.status} />
                    </div>
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

interface SortArrowsProps {
  sp: SearchParams;
  ascValue: JobSort;
  descValue: JobSort;
  ascTitle: string;
  descTitle: string;
}
function SortArrows({ sp, ascValue, descValue, ascTitle, descTitle }: SortArrowsProps) {
  // Zwei Pfeile als Links. Aktiver Pfeil ist gefärbt; Klick auf den aktiven
  // Pfeil setzt die Sortierung zurück (Standard = Neueste zuerst).
  const buildHref = (target: JobSort | undefined) => {
    const p = new URLSearchParams();
    if (sp.q) p.set('q', sp.q);
    if (sp.company) p.set('company', sp.company);
    if (sp.neu) p.set('neu', sp.neu);
    if (sp.hidden) p.set('hidden', sp.hidden);
    if (sp.abg) p.set('abg', sp.abg);
    if (sp.a) p.set('a', sp.a);
    if (sp.beworben) p.set('beworben', sp.beworben);
    if (sp.prozess) p.set('prozess', sp.prozess);
    if (target) p.set('sort', target);
    const qs = p.toString();
    return qs ? `/jobs?${qs}` : '/jobs';
  };
  const descActive = sp.sort === descValue;
  const ascActive  = sp.sort === ascValue;
  return (
    <span className="inline-flex flex-col text-[9px] leading-[9px]">
      <Link
        href={buildHref(ascActive ? undefined : ascValue)}
        title={ascActive ? 'Sortierung zurücksetzen' : ascTitle}
        className={ascActive ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-300 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'}
      >▲</Link>
      <Link
        href={buildHref(descActive ? undefined : descValue)}
        title={descActive ? 'Sortierung zurücksetzen' : descTitle}
        className={descActive ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-300 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'}
      >▼</Link>
    </span>
  );
}

function HideButton({ id, hidden }: { id: number; hidden: boolean }) {
  // Orthogonal zum Status: blendet nur aus, ohne den Status zu setzen.
  // Eine 'abgelehnt'-Stelle ist immer hidden=1; wird sie hier "eingeblendet",
  // bleibt status='abgelehnt' erhalten (= sichtbar markiert als abgelehnt).
  return (
    <form action={`/api/jobs/${id}/hide`} method="post">
      <input type="hidden" name="to" value={hidden ? '0' : '1'} />
      <button
        className={STATUS_BTN_BASE + ' ' +
          (hidden
            ? 'bg-amber-500/30 text-amber-800 dark:text-amber-200 font-semibold border-transparent'
            : STATUS_BTN_INACTIVE)}
        title={hidden ? 'Stelle wieder einblenden' : 'Stelle nur ausblenden (Status bleibt)'}
      >
        {hidden ? 'einblenden' : 'ausblenden'}
      </button>
    </form>
  );
}

function RejectButton({ id, status }: { id: number; status: string | null }) {
  // "5: Abgelehnt" sitzt jetzt anstelle des alten ausblenden-Buttons.
  // Klick: status='abgelehnt' + hidden=1 (synchron, in setStatus). Toggle off →
  // status=null + hidden=0 → Stelle wieder sichtbar.
  const isActive = status === 'abgelehnt';
  return (
    <form action={`/api/jobs/${id}/status`} method="post">
      <input type="hidden" name="to" value={isActive ? '' : 'abgelehnt'} />
      <button
        className={STATUS_BTN_BASE + ' ' +
          (isActive
            ? 'bg-rose-500/40 text-rose-800 dark:text-rose-200 font-semibold border-transparent'
            : STATUS_BTN_INACTIVE)}
        title={isActive ? 'Ablehnung zurücknehmen (wieder einblenden)' : 'Als "5: Abgelehnt" markieren (ausblenden)'}
      >
        5: Abgelehnt
      </button>
    </form>
  );
}

function RatingButtons({ id, rating }: { id: number; rating: string | null }) {
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

// Gemeinsame Button-Stile für alle 5 Status-Buttons: feste Breite, damit
// die 4 im 2×2-Grid und der 5. (Abgelehnt) in der Nachbarspalte identisch
// aussehen.
const STATUS_BTN_BASE = 'w-24 text-[10px] px-1.5 py-0.5 rounded border text-center';
const STATUS_BTN_INACTIVE = 'text-neutral-400 border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800';

function StatusButtons({ id, status }: { id: number; status: string | null; isNew?: boolean }) {
  // 4 Buttons im 2×2-Grid: 1:Neu, 2:Gelesen, 3:Beworben, 4:Prozess.
  // "1: Neu" entspricht status=null — der Klick darauf setzt zurück.
  // Der 5. Status (Abgelehnt) sitzt in der letzten Tabellenspalte (RejectButton).
  const opts: { value: 'gelesen' | 'beworben' | 'prozess' | null; num: '1' | '2' | '3' | '4'; label: string; activeClass: string }[] = [
    { value: null,       num: '1', label: 'Neu',      activeClass: 'bg-emerald-500/30 text-emerald-800 dark:text-emerald-200 font-semibold' },
    { value: 'gelesen',  num: '2', label: 'Gelesen',  activeClass: 'bg-neutral-400/40 text-neutral-800 dark:text-neutral-100 font-semibold' },
    { value: 'beworben', num: '3', label: 'Beworben', activeClass: 'bg-sky-500/40 text-sky-800 dark:text-sky-200 font-semibold' },
    { value: 'prozess',  num: '4', label: 'Prozess',  activeClass: 'bg-indigo-500/40 text-indigo-800 dark:text-indigo-200 font-semibold' },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 w-fit">
      {opts.map(o => {
        const isActive = status === o.value;
        // "Reset"-Klick auf aktiven Button. "1: Neu" sendet immer leer (status=null).
        const toValue = isActive ? '' : (o.value ?? '');
        return (
          <form key={o.num} action={`/api/jobs/${id}/status`} method="post">
            <input type="hidden" name="to" value={toValue} />
            <button
              className={STATUS_BTN_BASE + ' ' +
                (isActive
                  ? o.activeClass + ' border-transparent'
                  : STATUS_BTN_INACTIVE)}
              title={`Als "${o.num}: ${o.label}" markieren`}
            >
              {o.num}: {o.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
