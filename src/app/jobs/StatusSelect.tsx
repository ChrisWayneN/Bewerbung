'use client';

interface Props {
  id: number;
  status: string | null;
}

const OPTIONS: { value: string; label: string; className: string }[] = [
  { value: '',         label: '1: Neu',      className: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-500/50' },
  { value: 'gelesen',  label: '2: Gelesen',  className: 'bg-neutral-400/25 text-neutral-800 dark:text-neutral-100 border-neutral-400/60' },
  { value: 'beworben', label: '3: Beworben', className: 'bg-sky-500/20 text-sky-800 dark:text-sky-200 border-sky-500/50' },
  { value: 'prozess',  label: '4: Prozess',  className: 'bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border-indigo-500/50' },
];

/** Status-Auswahl als einzelnes Dropdown (statt 4 Buttons). Zeigt aktuellen
 *  Status farbig; onChange submittet die Form → /api/jobs/[id]/status. */
export function StatusSelect({ id, status }: Props) {
  const current = status ?? '';
  const activeOpt = OPTIONS.find(o => o.value === current) ?? OPTIONS[0];
  return (
    <form action={`/api/jobs/${id}/status`} method="post">
      <select
        name="to"
        defaultValue={current}
        onChange={e => e.currentTarget.form?.requestSubmit()}
        className={'text-[11px] px-2 py-1 rounded border font-semibold cursor-pointer ' + activeOpt.className}
        title="Bewerbungs-Status ändern"
      >
        {OPTIONS.map(o => (
          <option key={o.value || '_new'} value={o.value}>{o.label}</option>
        ))}
      </select>
    </form>
  );
}
