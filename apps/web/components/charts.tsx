interface LineProps {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
}

function pathFor(points: number[], w: number, h: number, pad = 2): string {
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  return points
    .map((p, i) => {
      const x = pad + i * step;
      const y = pad + (h - pad * 2) * (1 - (p - min) / span);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Tiny dependency-free SVG line chart (sparkline / price chart). */
export function Line({ points, width = 120, height = 36, stroke, fill }: LineProps) {
  if (points.length < 2) return <svg width={width} height={height} />;
  const up = points[points.length - 1]! >= points[0]!;
  const color = stroke ?? (up ? 'var(--up)' : 'var(--down)');
  const d = pathFor(points, width, height);
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && (
        <path
          d={`${d} L${width - 2},${height} L2,${height} Z`}
          fill={color}
          opacity={0.08}
        />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

export function fmtMoney(x: number): string {
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(x: number, signed = true): string {
  const s = (100 * x).toFixed(1);
  return `${signed && x > 0 ? '+' : ''}${s}%`;
}

export function Delta({ value }: { value: number }) {
  const cls = value >= 0 ? 'up' : 'down';
  const arrow = value >= 0 ? '▲' : '▼';
  return (
    <span className={`${cls} num`} style={{ fontSize: 13, fontWeight: 600 }}>
      {arrow} {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}
