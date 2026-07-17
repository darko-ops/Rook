'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Portfolio' },
  { href: '/market', label: 'Market' },
  { href: '/races', label: 'Races' },
  { href: '/board', label: 'Board' },
  { href: '/book', label: 'Book' },
];

export function Tabs() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((t) => {
        const active = t.href === '/' ? path === '/' : path.startsWith(t.href) || (t.href === '/market' && path.startsWith('/m/'));
        return (
          <Link key={t.href} href={t.href} className={active ? 'active' : ''}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
