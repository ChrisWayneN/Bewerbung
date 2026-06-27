import { NextRequest, NextResponse } from 'next/server';
import { setRating, type JobRating } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const raw = (form?.get('to') ?? '').toString().trim();
  const rating: JobRating | null = raw === 'A' || raw === 'AB' || raw === 'B' ? raw : null;
  setRating(Number(id), rating);
  const referer = req.headers.get('referer') ?? '/jobs';
  return NextResponse.redirect(referer, { status: 303 });
}
