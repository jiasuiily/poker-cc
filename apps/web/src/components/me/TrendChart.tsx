import type { TrendDay } from '../../net/api';

const W = 320;
const H = 150;
const L = 30;
const R = 10;
const T = 10;
const B = 24;

const LINES = [
  { key: 'good', label: '好', color: '#34d399' },
  { key: 'ok', label: '尚可', color: '#fbbf24' },
  { key: 'mistake', label: '失误', color: '#f87171' },
] as const;

/** Share of good / ok / mistake decisions per day (days without decisions are left out). Pure SVG. */
export function TrendChart({ days }: { days: TrendDay[] }) {
  const data = days.filter((d) => d.good + d.ok + d.mistake > 0);
  if (data.length === 0) return <p className="text-sm text-white/50">还没有可画趋势的分析数据。</p>;

  const x = (i: number) => (data.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (data.length - 1));
  const y = (p: number) => T + (1 - p) * (H - T - B);
  const share = (d: TrendDay, k: (typeof LINES)[number]['key']) => d[k] / (d.good + d.ok + d.mistake);
  const short = (s: string) => s.slice(5).replace('-', '/');

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="每日好 / 尚可 / 失误决策占比趋势">
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke="white" strokeOpacity={0.15} strokeDasharray={p === 0.5 ? '3 3' : undefined} />
            <text x={L - 4} y={y(p) + 3} textAnchor="end" fontSize={9} fill="white" fillOpacity={0.5}>
              {p * 100}%
            </text>
          </g>
        ))}
        {LINES.map((l) => (
          <g key={l.key}>
            {data.length > 1 && (
              <polyline
                fill="none"
                stroke={l.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                points={data.map((d, i) => `${x(i).toFixed(1)},${y(share(d, l.key)).toFixed(1)}`).join(' ')}
              />
            )}
            {data.map((d, i) => (
              <circle key={d.day} cx={x(i)} cy={y(share(d, l.key))} r={2.5} fill={l.color}>
                <title>{`${d.day} ${l.label} ${(share(d, l.key) * 100).toFixed(0)}%`}</title>
              </circle>
            ))}
          </g>
        ))}
        <text x={L} y={H - 8} fontSize={9} fill="white" fillOpacity={0.6} textAnchor="start">
          {short(data[0]!.day)}
        </text>
        {data.length > 1 && (
          <text x={W - R} y={H - 8} fontSize={9} fill="white" fillOpacity={0.6} textAnchor="end">
            {short(data[data.length - 1]!.day)}
          </text>
        )}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-white/70">
        {LINES.map((l) => (
          <span key={l.key} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
