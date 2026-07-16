import { NextRequest, NextResponse } from 'next/server';
import { joinWaitlist, track } from '@rook/core';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const pos = await joinWaitlist(String(body.email ?? ''), body.ref ? String(body.ref) : undefined);
    await track('waitlist:join', null, { ref: body.ref ?? null });
    return NextResponse.json({ position: pos });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 400 });
  }
}
