import { NextRequest, NextResponse } from 'next/server';
import { setStatus, type JobStatus } from '@/lib/db';

const ALLOWED: JobStatus[] = ['gelesen', 'beworben', 'prozess', 'abgelehnt'];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const raw = (form?.get('to') ?? '').toString().trim();
  const status: JobStatus | null = (ALLOWED as string[]).includes(raw) ? (raw as JobStatus) : null;
  setStatus(Number(id), status);
  const referer = req.headers.get('referer') ?? '/jobs';
  return NextResponse.redirect(referer, { status: 303 });
}
