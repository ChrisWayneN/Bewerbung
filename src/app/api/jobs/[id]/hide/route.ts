import { NextRequest, NextResponse } from 'next/server';
import { setHidden } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const toRaw = form?.get('to');
  const hidden = toRaw === '1' || toRaw === 'true' || toRaw === null;
  setHidden(Number(id), hidden);
  // Redirect back to the referer so the list/detail view re-renders.
  const referer = req.headers.get('referer') ?? '/jobs';
  return NextResponse.redirect(referer, { status: 303 });
}
