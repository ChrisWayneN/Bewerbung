import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SheetTabs } from './SheetTabs';

export const metadata: Metadata = {
  title: 'Bewerbung – Job Tracker München',
  description: '21 Firmen im Großraum München, 30-km-Radius',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap gap-2 items-center justify-between">
            <Link href="/jobs" className="font-semibold tracking-tight">
              Job Tracker München
            </Link>
            <SheetTabs />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
