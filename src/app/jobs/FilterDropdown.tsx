'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  activeCount: number;
  children: ReactNode;
}

/** Aufklappbares Filter-Menü neben dem Firmen-Dropdown. Die Checkboxen
 *  drin sind weiterhin Auto-Submit; damit das Menü nach jedem Klick nicht
 *  zugeht, wird der Open-State in localStorage persistiert. */
export function FilterDropdown({ label, activeCount, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (localStorage.getItem('jobsFilterOpen') === '1') setOpen(true);
  }, []);
  useEffect(() => {
    localStorage.setItem('jobsFilterOpen', open ? '1' : '0');
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm inline-flex items-center gap-1"
      >
        <span>{label}</span>
        {activeCount > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">({activeCount})</span>
        )}
        <span className="text-neutral-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 min-w-[240px] rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 shadow-lg flex flex-col gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
