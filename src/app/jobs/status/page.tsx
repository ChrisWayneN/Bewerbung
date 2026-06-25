import Link from 'next/link';
import { getScraperStatuses } from '@/lib/db';
import { COMPANIES } from '@/scrapers/companies';

export const dynamic = 'force-dynamic';

export default function StatusPage() {
  const statuses = getScraperStatuses();
  const byCompany = new Map(statuses.map(s => [s.company, s]));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/jobs" className="text-sm text-neutral-500 hover:underline">← zurück</Link>
      </div>
      <h1 className="text-xl font-semibold">Scraper-Status</h1>
      <p className="text-sm text-neutral-500">
        Letzte Ausführung pro Firma. Nutze <code>npm run scrape</code> für einen neuen Import.
      </p>
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-100 dark:bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-2">Firma</th>
              <th className="px-3 py-2">Portal</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Stellen</th>
              <th className="px-3 py-2">Letzter Lauf</th>
              <th className="px-3 py-2">Fehler / Notiz</th>
            </tr>
          </thead>
          <tbody>
            {COMPANIES.map(c => {
              const s = byCompany.get(c.name);
              return (
                <tr key={c.name} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-neutral-500">{c.portal}</td>
                  <td className="px-3 py-2">{c.status} {s?.status && `(${s.status})`}</td>
                  <td className="px-3 py-2 text-right">{s?.jobs_found ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-500">{s?.last_run ? new Date(s.last_run).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="px-3 py-2 text-neutral-500 text-xs">{s?.error ?? c.note ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
