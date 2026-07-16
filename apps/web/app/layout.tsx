import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Tabs } from '../components/Tabs';

export const metadata: Metadata = {
  title: 'Rook — Own the season',
  description:
    'The fantasy stock market for Formula 1. Build a portfolio of the teams you believe in — equal stacks, fan-set prices, a reputation worth defending.',
  manifest: '/manifest.json',
  openGraph: {
    title: 'Rook — Own the season',
    description:
      'The fantasy stock market for Formula 1. Equal stacks, fan-set prices, a reputation worth defending. Not a sportsbook.',
    siteName: 'Rook',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Rook — Own the season',
    description: 'The fantasy stock market for Formula 1. Not a sportsbook.',
  },
};

export const viewport: Viewport = {
  themeColor: '#08090b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
        <Tabs />
      </body>
    </html>
  );
}
