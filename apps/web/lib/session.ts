import { cookies } from 'next/headers';
import { currentSeason, userForToken } from '@rook/core';

export const SESSION_COOKIE = 'rook_session';

export async function sessionUser(): Promise<{ id: number; handle: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? '';
  if (!token) return null;
  return userForToken(token, new Date());
}

export async function activeSeason() {
  return currentSeason(new Date());
}
