'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SHEETS = [
  { href: '/jobs',              label: 'Stellen' },
  { href: '/jobs/ausgeblendet', label: 'Ausgeblendet' },
  { href: '/jobs/blacklist',    label: 'Blacklist' },
];

/** Umschalter zwischen den drei Blättern in der Kopfleiste. */
export function SheetTabs() {
  const path = usePathname();
  const active =
    path.startsWith('/jobs/ausgeblendet') ? '/jobs/ausgeblendet' :
    path.startsWith('/jobs/blacklist')    ? '/jobs/blacklist'    :
    path.startsWith('/jobs')              ? '/jobs'              : null;
  return (
    <nav className="flex gap-1 text-sm rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1">
      {SHEETS.map(s => (
        <Link
          key={s.href}
          href={s.href}
          className={'rounded-md px-3 py-1 whitespace-nowrap ' +
            (active === s.href
              ? 'bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-medium shadow-sm'
              : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100')}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
