import { useEffect, useId, useMemo, useState } from 'react';
import { api } from '../shared/api';

/**
 * System health over time (CPU / temp / mem) — admin-only, so we can tell
 * "is the Pi actually under load" from a glance instead of guessing from fan
 * noise. Three small multiples rather than one shared axis (`master-prompt`
 * house rule: never plot different-unit measures on one y-scale).
 */

interface Sample {
  ts: number;
  cpuPct: number | null;
  tempC: number | null;
  memPct: number | null;
}

const RANGES = [
  { label: '1h', ms: 3600_000 },
  { label: '24h', ms: 24 * 3600_000 },
  { label: '7d', ms: 7 * 24 * 3600_000 },
  { label: '30d', ms: 30 * 24 * 3600_000 },
];

const GOOD = '#0ca30c';
const WARNING = '#e08e00';
const CRITICAL = '#d03b3b';

function statusColor(value: number | null, warn: number, critical: number): string {
  if (value === null) return 'var(--muted)';
  if (value >= critical) return CRITICAL;
  if (value >= warn) return WARNING;
  return GOOD;
}

function fmtTick(ts: number, rangeMs: number): string {
  const d = new Date(ts);
  if (rangeMs <= 24 * 3600_000) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** One small-multiple: sequential-hue area + line, hover crosshair, own y-scale. */
function MetricChart(props: {
  points: { ts: number; value: number | null }[];
  rangeMs: number;
  color: string;
  unit: string;
  yMax?: number; // fixed ceiling (percent metrics); auto-scaled otherwise
  formatValue?: (v: number) => string;
}) {
  const gradientId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 600;
  const height = 130;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 20;

  const valid = props.points.filter((p): p is { ts: number; value: number } => p.value !== null);

  if (valid.length < 2) {
    return (
      <div className="muted small" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Not enough data yet.
      </div>
    );
  }

  const tMin = valid[0].ts;
  const tMax = valid[valid.length - 1].ts;
  const vMax = props.yMax ?? Math.max(...valid.map((p) => p.value)) * 1.15;
  const vMin = 0;

  const x = (ts: number) => padL + ((ts - tMin) / Math.max(1, tMax - tMin)) * (width - padL - padR);
  const y = (v: number) => padT + (1 - (v - vMin) / Math.max(1e-6, vMax - vMin)) * (height - padT - padB);

  const linePath = valid.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(valid[valid.length - 1].ts).toFixed(1)},${height - padB} L${x(valid[0].ts).toFixed(1)},${height - padB} Z`;

  const hovered = hoverIdx !== null ? valid[hoverIdx] : null;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - rect.left) / rect.width) * width;
    const targetTs = tMin + (Math.max(0, Math.min(1, (fx - padL) / (width - padL - padR)))) * (tMax - tMin);
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < valid.length; i++) {
      const d = Math.abs(valid[i].ts - targetTs);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={props.color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={props.color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* recessive baseline */}
      <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="var(--line)" strokeWidth={1} />
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path d={linePath} fill="none" stroke={props.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <text x={padL} y={height - 4} fontSize={10} fill="var(--muted)">
        {fmtTick(tMin, props.rangeMs)}
      </text>
      <text x={width - padR} y={height - 4} fontSize={10} fill="var(--muted)" textAnchor="end">
        {fmtTick(tMax, props.rangeMs)}
      </text>
      {hovered ? (
        <g pointerEvents="none">
          <line x1={x(hovered.ts)} y1={padT} x2={x(hovered.ts)} y2={height - padB} stroke="var(--line)" strokeWidth={1} strokeDasharray="3,3" />
          <circle cx={x(hovered.ts)} cy={y(hovered.value)} r={4} fill={props.color} stroke="var(--card)" strokeWidth={2} />
          <g transform={`translate(${Math.min(width - 90, Math.max(0, x(hovered.ts) - 40))}, ${padT})`}>
            <rect width={80} height={30} rx={6} fill="var(--text)" opacity={0.9} />
            <text x={40} y={12} fontSize={10} fill="#fff" textAnchor="middle">
              {fmtTick(hovered.ts, props.rangeMs)}
            </text>
            <text x={40} y={24} fontSize={12} fontWeight={700} fill="#fff" textAnchor="middle">
              {(props.formatValue ?? ((v: number) => `${v}${props.unit}`))(hovered.value)}
            </text>
          </g>
        </g>
      ) : null}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      />
    </svg>
  );
}

function Tile(props: { label: string; value: number | null; unit: string; color: string; pulse?: boolean }) {
  return (
    <div>
      <div className="muted small">{props.label}</div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          color: props.color,
          animation: props.pulse ? 'pi-health-pulse 1.4s ease-in-out infinite' : undefined,
        }}
      >
        {props.value === null ? '—' : `${props.value}${props.unit}`}
      </div>
    </div>
  );
}

export function PiHealth() {
  const [rangeMs, setRangeMs] = useState(RANGES[1].ms);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<{ samples: Sample[] }>(`/api/admin/metrics?rangeMs=${rangeMs}`);
        if (!cancelled) {
          setSamples(res.samples);
          setLoaded(true);
        }
      } catch {
        // transient — next poll will retry
      }
    };
    void load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [rangeMs]);

  const latest = samples.length > 0 ? samples[samples.length - 1] : null;

  const cpuPoints = useMemo(() => samples.map((s) => ({ ts: s.ts, value: s.cpuPct })), [samples]);
  const tempPoints = useMemo(() => samples.map((s) => ({ ts: s.ts, value: s.tempC })), [samples]);
  const memPoints = useMemo(() => samples.map((s) => ({ ts: s.ts, value: s.memPct })), [samples]);
  const tempAvailable = samples.some((s) => s.tempC !== null);

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <style>{`@keyframes pi-health-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
      <h2>Pi health</h2>
      <p className="muted small">
        CPU load, SoC temperature, and memory, sampled once a minute — so "is it actually busy" is a glance, not a guess.
      </p>
      <div className="row-wrap" style={{ marginBottom: 14, gap: 8 }}>
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={`btn btn-compact ${rangeMs === r.ms ? 'btn-primary' : ''}`}
            onClick={() => setRangeMs(r.ms)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <div className="row-wrap" style={{ gap: 24, marginBottom: 16 }}>
            <Tile
              label="CPU"
              value={latest?.cpuPct ?? null}
              unit="%"
              color={statusColor(latest?.cpuPct ?? null, 85, 97)}
              pulse={(latest?.cpuPct ?? 0) >= 97}
            />
            <Tile
              label="SoC temp"
              value={latest?.tempC ?? null}
              unit="°C"
              color={statusColor(latest?.tempC ?? null, 70, 80)}
              pulse={(latest?.tempC ?? 0) >= 80}
            />
            <Tile
              label="Memory"
              value={latest?.memPct ?? null}
              unit="%"
              color={statusColor(latest?.memPct ?? null, 85, 97)}
              pulse={(latest?.memPct ?? 0) >= 97}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>
              CPU load %
            </div>
            <MetricChart points={cpuPoints} rangeMs={rangeMs} color="var(--accent)" unit="%" yMax={100} />
          </div>

          <div style={{ marginBottom: 18 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>
              SoC temperature °C
            </div>
            {tempAvailable ? (
              <MetricChart points={tempPoints} rangeMs={rangeMs} color="#eb6834" unit="°C" />
            ) : (
              <p className="muted small">Not available on this host (no thermal zone — expected off-Pi).</p>
            )}
          </div>

          <div>
            <div className="muted small" style={{ marginBottom: 4 }}>
              Memory used %
            </div>
            <MetricChart points={memPoints} rangeMs={rangeMs} color="#1baf7a" unit="%" yMax={100} />
          </div>
        </>
      )}
    </div>
  );
}
