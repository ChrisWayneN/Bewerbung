import { JobsSheet, type SearchParams } from '../JobsSheet';

export const dynamic = 'force-dynamic';

/** Blatt 2: alle ausgeblendeten Stellen (manuell ausgeblendet + abgelehnt). */
export default async function HiddenJobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <JobsSheet sp={await searchParams} mode="ausgeblendet" />;
}
