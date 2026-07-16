import { NextRequest, NextResponse } from 'next/server';
import { track } from '@rook/core';
import { sessionUser } from '../../../lib/session';

/** Client-side instrumentation sink (§22): screen opens, leaderboard views… */
export async function POST(req: NextRequest) {
  const user = await sessionUser();
  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind ?? '');
  if (!kind) return NextResponse.json({ error: 'kind required' }, { status: 400 });
  await track(kind, user?.id ?? null, body.props ?? {});
  return NextResponse.json({ ok: true });
}
