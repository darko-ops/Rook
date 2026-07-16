import { randomBytes } from 'node:crypto';
import { db } from '@rook/db';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Join the waitlist; idempotent per email. Returns queue position. */
export async function joinWaitlist(emailRaw: string, referredBy?: string): Promise<number> {
  const email = emailRaw.toLowerCase().trim();
  if (!EMAIL_RE.test(email)) throw new Error('enter a valid email');
  const sql = db();
  await sql`
    insert into waitlist (email, referred_by) values (${email}, ${referredBy ?? null})
    on conflict (email) do nothing
  `;
  const [{ pos }] = (await sql`
    select count(*)::int as pos from waitlist
    where invited_at is null and created_at <= (select created_at from waitlist where email = ${email})
  `) as unknown as [{ pos: number }];
  return pos;
}

/**
 * Admit the next N waitlisted signups: mint a single-use invite for each and
 * mark them invited. Returns (email, code) pairs — the launch runbook sends
 * these via the email sender or manually. Wave-based admission preserves
 * friend-graph density (§19): referred signups are admitted first.
 */
export async function admitWave(n: number): Promise<Array<{ email: string; code: string }>> {
  const sql = db();
  const rows = await sql`
    select id, email from waitlist where invited_at is null
    order by (referred_by is not null) desc, created_at
    limit ${n}
  `;
  const out: Array<{ email: string; code: string }> = [];
  for (const r of rows) {
    const code = randomBytes(4).toString('hex');
    await sql.begin(async (tx) => {
      await tx`insert into invites (code, created_by) values (${code}, null)`;
      await tx`update waitlist set invited_at = now(), invite_code = ${code} where id = ${r.id}`;
    });
    out.push({ email: r.email, code });
  }
  return out;
}

export interface MyInvites {
  quota: number;
  remaining: number;
  codes: Array<{ code: string; used: boolean }>;
}

/** A user's shareable invite codes (§19: growth through the friend graph). */
export async function myInvites(userId: number): Promise<MyInvites> {
  const sql = db();
  const [u] = await sql`select invite_quota from users where id = ${userId}`;
  const codes = await sql`
    select code, used_by is not null as used from invites
    where created_by = ${userId} order by created_at
  `;
  return {
    quota: u?.invite_quota ?? 0,
    remaining: Math.max(0, (u?.invite_quota ?? 0) - codes.length),
    codes: codes.map((c) => ({ code: c.code as string, used: Boolean(c.used) })),
  };
}

/** Mint one of the user's granted invites. */
export async function mintMyInvite(userId: number): Promise<string> {
  const sql = db();
  const mine = await myInvites(userId);
  if (mine.remaining <= 0) throw new Error('no invites remaining');
  const code = randomBytes(4).toString('hex');
  await sql`insert into invites (code, created_by) values (${code}, ${userId})`;
  return code;
}

/** Grant every current user an invite quota (run at launch). */
export async function grantInvites(quota: number): Promise<number> {
  const rows = await db()`update users set invite_quota = greatest(invite_quota, ${quota}) returning id`;
  return rows.length;
}

export async function waitlistStats(): Promise<{ waiting: number; invited: number; joined: number }> {
  const sql = db();
  const [row] = (await sql`
    select
      count(*) filter (where invited_at is null)::int as waiting,
      count(*) filter (where invited_at is not null)::int as invited,
      count(*) filter (where invite_code in (select code from invites where used_by is not null))::int as joined
    from waitlist
  `) as unknown as [{ waiting: number; invited: number; joined: number }];
  return row;
}
