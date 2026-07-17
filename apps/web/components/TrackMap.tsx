/**
 * Stylized circuit map — a deterministic generative loop seeded by round
 * number. Deliberately abstract (consistent dark-minimal brand, no
 * licensing fragility, nothing pretending to be the real layout); the real
 * circuit facts live in the text beside it.
 */

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function TrackMap({ round, size = 120 }: { round: number; size?: number }) {
  const rnd = mulberry(round * 2654435761 + 7);
  const n = 9 + Math.floor(rnd() * 4); // 9–12 corners
  const cx = 60;
  const cy = 60;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + (rnd() - 0.5) * 0.35;
    const rx = 30 + rnd() * 22;
    const ry = 26 + rnd() * 20;
    pts.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  // Catmull-Rom → cubic bezier closed loop
  let d = `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  // start/finish tick perpendicular-ish at the first point
  const sf = pts[0]!;
  const nb = pts[1]!;
  const dx = nb[0] - sf[0];
  const dy = nb[1] - sf[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * 5;
  const py = (dx / len) * 5;

  return (
    <svg viewBox="0 0 120 120" width={size} height={size} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke="var(--panel-2)" strokeWidth={9} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--border)" strokeWidth={6.5} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.1} strokeDasharray="3 5" opacity={0.7} />
      <line
        x1={sf[0] - px} y1={sf[1] - py} x2={sf[0] + px} y2={sf[1] + py}
        stroke="var(--text)" strokeWidth={2.4}
      />
    </svg>
  );
}
