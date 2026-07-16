import { classifyHeadline } from './classify.js';
import type { ClassifiedNews, NewsSource } from './news.js';

export const DEFAULT_FEEDS = [
  'https://www.autosport.com/rss/f1/news/',
  'https://www.motorsport.com/rss/f1/news/',
  'https://www.racefans.net/feed/',
  'https://feeds.bbci.co.uk/sport/formula1/rss.xml',
];

interface RssItem {
  title: string;
  link: string;
  pubDate: Date;
  source: string;
}

function textOf(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  return m[1]!
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function parseRss(xml: string, source: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const block = m[1]!;
    const title = textOf(block, 'title');
    const link = textOf(block, 'link') ?? textOf(block, 'guid');
    const pub = textOf(block, 'pubDate') ?? textOf(block, 'dc:date');
    if (!title || !link || !pub) continue;
    const pubDate = new Date(pub);
    if (Number.isNaN(pubDate.getTime())) continue;
    items.push({ title, link, pubDate, source });
  }
  return items;
}

/**
 * Real F1 news via public RSS (§13.3: a news feed for traders to react to,
 * not a pricing feed). Headlines run through the conservative classifier;
 * only single-team, unambiguous items carry a sign for the mover.
 * Feed failures degrade gracefully — the app works without fresh news.
 */
export class RssF1Source implements NewsSource {
  constructor(private feeds: string[] = DEFAULT_FEEDS) {}

  async fetchSince(since: Date, until: Date): Promise<ClassifiedNews[]> {
    const out: ClassifiedNews[] = [];
    const results = await Promise.allSettled(
      this.feeds.map(async (url) => {
        const res = await fetch(url, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; RookBeta/0.1)' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        const host = new URL(url).hostname.replace(/^(www|feeds)\./, '');
        return parseRss(await res.text(), host);
      }),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn(`rss: feed failed: ${r.reason}`);
        continue;
      }
      for (const item of r.value) {
        if (item.pubDate < since || item.pubDate >= until) continue;
        const c = classifyHeadline(item.title);
        if (!c.symbol) continue; // untagged general news: skip in v1
        out.push({
          ts: item.pubDate,
          headline: item.title,
          source: item.source,
          url: item.link,
          symbol: c.symbol,
          sign: c.sign, // null-sign items stay display-only
          magnitude: c.magnitude,
        });
      }
    }
    return out.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }
}
