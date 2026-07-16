import { db } from '@rook/db';

export type Plan = 'free' | 'pro';

export async function planOf(userId: number): Promise<Plan> {
  const [u] = await db()`select plan from users where id = ${userId}`;
  return (u?.plan as Plan) ?? 'free';
}

/**
 * Upgrade path. Payments are pluggable behind config key 'billing':
 *   { "checkoutUrl": "https://buy.stripe.com/..." }
 * When configured, the UI sends users there and the webhook (or ops CLI)
 * flips the plan; unconfigured (dev/beta), the CLI flips it directly.
 * Deliberately no in-app price: the paywall is depth of sight (§25) and
 * pricing lives with the processor, not in the schema.
 */
export async function checkoutUrl(now: Date): Promise<string | null> {
  const rows = await db()`
    select value from config where key = 'billing' and effective_at <= ${now}
    order by effective_at desc limit 1
  `;
  return ((rows[0]?.value as { checkoutUrl?: string } | undefined)?.checkoutUrl) ?? null;
}

export async function setPlan(handle: string, plan: Plan): Promise<void> {
  const rows = await db()`update users set plan = ${plan} where handle = ${handle} returning id`;
  if (rows.length === 0) throw new Error(`unknown handle: ${handle}`);
}

// Cosmetics (§25): strictly vanity — never position, never currency.
export const FLAIR_FREE = ['♟', '🏁', '🔥', '📈', '🦈', '🎯'];
export const FLAIR_PRO = ['👑', '🐐', '💎', '🚀', '🏆', '⚡'];

export async function setFlair(userId: number, flair: string | null): Promise<void> {
  if (flair !== null) {
    const plan = await planOf(userId);
    const allowed = plan === 'pro' ? [...FLAIR_FREE, ...FLAIR_PRO] : FLAIR_FREE;
    if (!allowed.includes(flair)) throw new Error('that flair is not available on your plan');
  }
  await db()`update users set flair = ${flair} where id = ${userId}`;
}
