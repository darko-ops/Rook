import { NextRequest, NextResponse } from 'next/server';
import { getVapid, removeSubscription, saveSubscription, track } from '@rook/core';
import { sessionUser } from '../../../lib/session';

export async function GET() {
  const { publicKey } = await getVapid(new Date());
  return NextResponse.json({ publicKey });
}

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const sub = await req.json().catch(() => null);
  if (!sub?.endpoint || !sub?.keys?.p256dh) {
    return NextResponse.json({ error: 'bad subscription' }, { status: 400 });
  }
  await saveSubscription(user.id, sub);
  await track('push:subscribe', user.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sub = await req.json().catch(() => null);
  if (sub?.endpoint) await removeSubscription(String(sub.endpoint));
  return NextResponse.json({ ok: true });
}
