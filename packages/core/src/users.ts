import { randomBytes } from 'node:crypto';
import { db } from '@rook/db';

const HANDLE_RE = /^[a-z0-9_]{2,20}$/;

/**
 * v1 auth is deliberately minimal (§22 "keep it minimal"): handle-based
 * login that creates the account on first use and hands back an opaque
 * session token (httpOnly cookie at the API layer). Magic-link/OAuth slots
 * in behind the same sessions table later.
 */
export async function login(
  handleRaw: string,
  now: Date,
): Promise<{ userId: number; handle: string; token: string }> {
  const handle = handleRaw.toLowerCase().trim();
  if (!HANDLE_RE.test(handle)) {
    throw new Error('handle must be 2–20 chars: a–z, 0–9, _');
  }
  const sql = db();
  const [user] = await sql`
    insert into users (handle) values (${handle})
    on conflict (handle) do update set handle = excluded.handle
    returning id, handle
  `;
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + 90 * 86400e3);
  await sql`insert into sessions (token, user_id, expires_at) values (${token}, ${user!.id}, ${expires})`;
  return { userId: user!.id as number, handle: user!.handle as string, token };
}

export async function userForToken(token: string, now: Date): Promise<{ id: number; handle: string } | null> {
  if (!token) return null;
  const rows = await db()`
    select u.id, u.handle from sessions s join users u on u.id = s.user_id
    where s.token = ${token} and s.expires_at > ${now}
  `;
  return (rows[0] as never) ?? null;
}

export async function follow(followerId: number, followeeHandle: string): Promise<void> {
  const sql = db();
  const [u] = await sql`select id from users where handle = ${followeeHandle}`;
  if (!u) throw new Error('unknown handle');
  await sql`insert into follows (follower_id, followee_id) values (${followerId}, ${u.id})
    on conflict do nothing`;
}

export async function unfollow(followerId: number, followeeHandle: string): Promise<void> {
  const sql = db();
  const [u] = await sql`select id from users where handle = ${followeeHandle}`;
  if (!u) return;
  await sql`delete from follows where follower_id = ${followerId} and followee_id = ${u.id}`;
}

/** Instrumentation (§22): fire-and-forget product events. */
export async function track(
  kind: string,
  userId: number | null,
  props: object = {},
): Promise<void> {
  await db()`insert into events (user_id, kind, props)
    values (${userId}, ${kind}, ${db().json(JSON.parse(JSON.stringify(props)))})`;
}
