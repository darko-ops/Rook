'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FollowButton({ handle, isFollowing, self }: { handle: string; isFollowing: boolean; self: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (self) return null;

  const toggle = async () => {
    setBusy(true);
    await fetch(`/api/traders/${handle}/follow`, { method: isFollowing ? 'DELETE' : 'POST' });
    router.refresh();
    setBusy(false);
  };

  return (
    <button className="btn" disabled={busy} onClick={toggle}>
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}
