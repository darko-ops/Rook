import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Tabs } from '../components/Tabs';

export const metadata: Metadata = {
  title: 'Rook — Own the season',
  description: 'Build a portfolio of the teams you believe in.',
  manifest: '/manifest.json',
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
