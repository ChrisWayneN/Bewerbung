import { NextRequest, NextResponse } from 'next/server';
import { listJobs } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const jobs = listJobs({
    q: sp.get('q') ?? undefined,
    company: sp.get('company') ?? undefined,
    onlyNew: sp.get('neu') === '1',
    includeHidden: sp.get('hidden') === '1',
  });
  return NextResponse.json({ count: jobs.length, jobs });
}
