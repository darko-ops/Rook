import { randomBytes } from 'node:crypto';
import { db } from '@rook/db';
import { sendEmail } from './email.js';
import { login, validateHandle } from './users.js';

const TOKEN_TTL_MS = 30 * 60e3;

/** Config key 'auth': { "magicLink": true }. Default off (beta handle mode). */
export async function magicLinkEnabled(now: Date): Promise<boolean> {
  const rows = await db()`
    select value from config where key = 'auth' and effective_at <= ${now}
    order by effective_at desc limit 1
  `;
  return Boolean((rows[0]?.value as { magicLink?: boolean } | undefined)?.magicLink);
}

/**
 * Start a magic-link login: store a short-lived token and email the link.
 * The invite gate is enforced at verification (so a stale link can't skip a
 * gate that turned on in between).
 */
export async function requestMagicLink(
  handleRaw: string,
  emailRaw: string,
  baseUrl: string,
  now: Date,
  inviteCode?: string,
): Promise<void> {
  const handle = handleRaw.toLowerCase().trim();
  const email = emailRaw.toLowerCase().trim();
  const sql = db();
  const [existing] = await sql`select id, email from users where handle = ${handle}`;
  if (!existing) {
    const problem = validateHandle(handle);
    if (problem) throw new Error(problem);
  } else if (existing.email && existing.email !== email) {
    // handles are identity: only the address on file may log into one
    throw new Error('that handle is registered to a different email');
  }
  const token = randomBytes(32).toString('base64url');
  await sql`
    insert into auth_tokens (token, email, handle, invite_code, expires_at)
    values (${token}, ${email}, ${handle}, ${inviteCode ?? null},
            ${new Date(now.getTime() + TOKEN_TTL_MS)})
  `;
  const link = `${baseUrl}/api/auth/verify?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Your Rook sign-in link',
    text: `Sign in as @${handle}:\n\n${link}\n\nThis link expires in 30 minutes. If you didn't request it, ignore this email.`,
  });
}

/**
 * Consume a magic link: validates the token, runs the normal login path
 * (invite gate included), attaches the email to the user, returns a session.
 */
export async function verifyMagicLink(
  token: string,
  now: Date,
): Promise<{ userId: number; handle: string; token: string }> {
  const sql = db();
  const [t] = await sql`
    select * from auth_tokens
    where token = ${token} and used_at is null and expires_at > ${now}
  `;
  if (!t) throw new Error('link is invalid or expired — request a new one');
  await sql`update auth_tokens set used_at = ${now} where token = ${token}`;
  const session = await login(t.handle, now, t.invite_code ?? undefined);
  await sql`update users set email = coalesce(email, ${t.email}) where id = ${session.userId}`;
  return session;
}
