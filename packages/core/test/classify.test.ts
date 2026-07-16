import { describe, expect, it } from 'vitest';
import { classifyHeadline } from '@rook/core';

describe('headline classifier (conservative by design)', () => {
  it('tags single-team positive news with sign and magnitude', () => {
    const c = classifyHeadline('Norris wins Belgian GP from pole');
    expect(c.symbol).toBe('MCL');
    expect(c.sign).toBe(1);
    expect(c.magnitude).toBe('large');
  });

  it('tags single-team negative news', () => {
    const c = classifyHeadline('Ferrari hit with grid penalty after technical infringement');
    expect(c.symbol).toBe('FER');
    expect(c.sign).toBe(-1);
    expect(c.magnitude).toBe('medium');
  });

  it('maps drivers to their teams', () => {
    expect(classifyHeadline('Verstappen fastest in Friday practice').symbol).toBe('RBR');
    expect(classifyHeadline('Hulkenberg secures shock podium').symbol).toBe('AUD');
  });

  it('refuses a sign on multi-team headlines (display-only)', () => {
    const c = classifyHeadline('Norris beats Verstappen to win in Austin');
    expect(c.symbol).not.toBeNull();
    expect(c.sign).toBeNull();
  });

  it('refuses a sign when keywords conflict', () => {
    const c = classifyHeadline('Mercedes win overshadowed by post-race penalty investigation');
    expect(c.symbol).toBe('MER');
    expect(c.sign).toBeNull();
  });

  it('does not read "upgrade disappointment" as positive (live-feed regression)', () => {
    const c = classifyHeadline('James Vowles admits Williams F1 British GP upgrade disappointment');
    expect(c.symbol).toBe('WIL');
    expect(c.sign).toBeNull(); // conflicting keywords → display-only
  });

  it('returns nothing for untagged general news', () => {
    const c = classifyHeadline('FIA announces 2027 engine regulations timeline');
    expect(c.symbol).toBeNull();
    expect(c.sign).toBeNull();
  });
});
