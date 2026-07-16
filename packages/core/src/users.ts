import { randomBytes } from 'node:crypto';
import { db } from '@rook/db';

const HANDLE_RE = /^[a-z0-9_]{2,20}$/;

// §21: profanity/impersonation checks on handles. Conservative and dumb on
// purpose — a blocked legitimate handle costs an apology; a granted
// "official_f1" costs trust.
const RESERVED = new Set([
  'rook', 'rookhq', 'admin', 'administrator', 'official', 'system', 'house',
  'support', 'help', 'mod', 'moderator', 'staff', 'team', 'api', 'root',
  'f1', 'formula1', 'fia', 'grandmaster',
]);
const IMPERSONATION = [
  'redbull', 'ferrari', 'mercedes', 'mclaren', 'astonmartin', 'alpine',
  'williams', 'racingbulls', 'audi', 'sauber', 'haas',
  'verstappen', 'leclerc', 'hamilton', 'russell', 'antonelli', 'norris',
  'piastri', 'alonso', 'gasly', 'albon', 'sainz', 'hulkenberg', 'ocon',
];
const PROFANITY = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'rape', 'nazi'];

export function validateHandle(handle: string): string | null {
  if (!HANDLE_RE.test(handle)) return 'handle must be 2–20 chars: a–z, 0–9, _';
  const bare = handle.replace(/_/g, '');
  if (RESERVED.has(handle) || RESERVED.has(bare)) return 'that handle is reserved';
  if (IMPERSONATION.some((n) => bare === n || bare === `${n}official` || bare === `official${n}`)) {
    return 'that handle is reserved for the team/driver it names';
  }
  if (PROFANITY.some((p) => bare.includes(p))) return 'pick a different handle';
  return null;
}

export class InviteRequired extends Error {
  readonly code = 'invite-required';
}

/** Beta gate (config key 'beta': { "inviteRequired": true }). Default open. */
export async function betaGateEnabled(now: Date): Promise<boolean> {
  return inviteRequired(now);
}

async function inviteRequired(now: Date): Promise<boolean> {
  const rows = await db()`
    select value from config where key = 'beta' and effective_at <= ${now}
    order by effective_at desc limit 1
  `;
  return Boolean((rows[0]?.value as { inviteRequired?: boolean } | undefined)?.inviteRequired);
}

export async function mintInvites(n: number, createdBy: number | null): Promise<string[]> {
  const sql = db();
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const code = randomBytes(4).toString('hex');
    await sql`insert into invites (code, created_by) values (${code}, ${createdBy})`;
    codes.push(code);
  }
  return codes;
}

/**
 * v1 auth is deliberately minimal (§22 "keep it minimal"): handle-based
 * login that creates the account on first use and hands back an opaque
 * session token (httpOnly cookie at the API layer). Magic-link/OAuth slots
 * in behind the same sessions table later. New signups pass the invite
 * gate when the beta config requires it (§18: seeded friend group).
 */
export async function login(
  handleRaw: string,
  now: Date,
  inviteCode?: string,
): Promise<{ userId: number; handle: string; token: string }> {
  const handle = handleRaw.toLowerCase().trim();
  const sql = db();
  const [existing] = await sql`select id from users where handle = ${handle}`;
  if (!existing) {
    const problem = validateHandle(handle);
    if (problem) throw new Error(problem);
  } else if (!HANDLE_RE.test(handle)) {
    throw new Error('handle must be 2–20 chars: a–z, 0–9, _');
  }
  if (!existing && (await inviteRequired(now))) {
    const [invite] = inviteCode
      ? await sql`select code from invites where code = ${inviteCode} and used_by is null`
      : [undefined];
    if (!invite) throw new InviteRequired('an invite code is required to join the beta');
  }
  const [user] = await sql`
    insert into users (handle) values (${handle})
    on conflict (handle) do update set handle = excluded.handle
    returning id, handle
  `;
  if (!existing && inviteCode) {
    await sql`update invites set used_by = ${user!.id}, used_at = ${now}
      where code = ${inviteCode} and used_by is null`;
  }
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + 90 * 86400e3);
  await sql`insert into sessions (token, user_id, expires_at) values (${token}, ${user!.id}, ${expires})`;
  return { userId: user!.id as number, handle: user!.handle as string, token };
}

export async function userForToken(
  token: string,
  now: Date,
): Promise<{ id: number; handle: string; plan: 'free' | 'pro'; flair: string | null } | null> {
  if (!token) return null;
  const rows = await db()`
    select u.id, u.handle, u.plan, u.flair from sessions s join users u on u.id = s.user_id
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
