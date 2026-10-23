import { JobsSheet, type SearchParams } from './JobsSheet';

export const dynamic = 'force-dynamic';

/** Blatt 1: aktuelle Stellen. */
export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <JobsSheet sp={await searchParams} mode="aktiv" />;
}
