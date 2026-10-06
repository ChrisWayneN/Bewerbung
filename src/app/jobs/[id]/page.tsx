import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getJob } from '@/lib/db';

export const dynamic = 'force-dynamic';

function NotExtracted({ note, closed }: { note: string | null; closed: boolean }) {
  return (
    <p className="text-sm text-neutral-500 italic">
      {closed
        ? '— nicht verfügbar, die Stelle ist nicht mehr ausgeschrieben —'
        : `— nicht automatisch extrahiert${note ? ` (${note})` : ''} — bitte Original-Anzeige öffnen.`}
    </p>
  );
}

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(Number(id));
  if (!job) notFound();

  return (
    <article className="space-y-6">
      <div>
        <Link href="/jobs" className="text-sm text-neutral-500 hover:underline">← zurück zur Liste</Link>
      </div>

      {job.is_closed && (
        <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <strong>Nicht mehr ausgeschrieben.</strong>{' '}
          {job.enrich_note
            ? 'Die Stellenseite meldet, dass die Anzeige nicht mehr verfügbar ist.'
            : `Die Stelle stand seit dem ${new Date(job.last_seen).toISOString().slice(0, 10)} nicht mehr in der Stellenliste der Firma.`}
        </div>
      )}

      <header className="space-y-1">
        <div className="text-sm uppercase tracking-wider text-neutral-500">{job.company}</div>
        <h1 className="text-2xl font-semibold">{job.title}</h1>
        <div className="text-sm text-neutral-500 flex gap-3 flex-wrap">
          {job.location && <span>{job.location}</span>}
          {job.source_portal && <span>· {job.source_portal}</span>}
          <span>· importiert {new Date(job.first_seen).toISOString().slice(0, 10)}</span>
          {job.is_new && <span className="text-emerald-600">· neu</span>}
        </div>
        <div className="pt-2">
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-3 py-1.5 text-sm font-medium"
          >
            Original-Anzeige öffnen ↗
          </a>
          <form action={`/api/jobs/${job.id}/hide`} method="post" className="inline-block ml-2">
            <input type="hidden" name="to" value={job.hidden ? '0' : '1'} />
            <button className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm">
              {job.hidden ? 'wieder einblenden' : 'ausblenden'}
            </button>
          </form>
        </div>
      </header>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-neutral-500 mb-2">Aufgaben / Tätigkeiten</h2>
        {job.tasks ? (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-neutral-100 dark:bg-neutral-900 rounded p-4 border border-neutral-200 dark:border-neutral-800">
            {job.tasks}
          </pre>
        ) : (
          <NotExtracted note={job.enrich_note} closed={job.is_closed} />
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-neutral-500 mb-2">Qualifikationen / Profil</h2>
        {job.qualifications ? (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-neutral-100 dark:bg-neutral-900 rounded p-4 border border-neutral-200 dark:border-neutral-800">
            {job.qualifications}
          </pre>
        ) : (
          <NotExtracted note={job.enrich_note} closed={job.is_closed} />
        )}
      </section>

      {job.description_raw && (
        <details className="text-sm" open={!job.tasks && !job.qualifications}>
          <summary className="cursor-pointer text-neutral-500">Roh-Beschreibung anzeigen</summary>
          <div className="mt-2 prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: job.description_raw }} />
        </details>
      )}
    </article>
  );
}
