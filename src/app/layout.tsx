import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Bewerbung – Job Tracker München',
  description: '21 Firmen im Großraum München, 30-km-Radius',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/jobs" className="font-semibold tracking-tight">
              Job Tracker München
            </Link>
            <nav className="text-sm text-neutral-500 flex gap-4">
              <Link href="/jobs" className="hover:text-neutral-900 dark:hover:text-neutral-100">Stellen</Link>
              <Link href="/jobs?neu=1" className="hover:text-neutral-900 dark:hover:text-neutral-100">Nur Neue</Link>
              <Link href="/jobs?hidden=1" className="hover:text-neutral-900 dark:hover:text-neutral-100">Inkl. Ausgeblendete</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
