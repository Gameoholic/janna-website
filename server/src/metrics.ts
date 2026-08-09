import os from 'os';
import fs from 'fs';
import { db } from './db';
import { log } from './log';

/** Pi health monitoring (dev panel, admin-only) — see master-prompt P11. */

export interface MetricSample {
  ts: number;
  cpuPct: number | null;
  tempC: number | null;
  memPct: number | null;
}

const THERMAL_ZONE = '/sys/class/thermal/thermal_zone0/temp';

function readCpuPct(): number | null {
  const cpus = os.cpus().length;
  if (!cpus) return null;
  // 1-minute load average is good enough for a dashboard — Node has no
  // built-in instantaneous CPU% without a manual /proc/stat delta sample.
  return Math.round((os.loadavg()[0] / cpus) * 1000) / 10;
}

function readTempC(): number | null {
  try {
    const raw = fs.readFileSync(THERMAL_ZONE, 'utf8').trim();
    const milli = Number(raw);
    return Number.isFinite(milli) ? Math.round(milli / 100) / 10 : null;
  } catch {
    return null; // not on Linux / no thermal zone (e.g. local dev on Windows) — expected, not an error
  }
}

function readMemPct(): number | null {
  const total = os.totalmem();
  if (!total) return null;
  return Math.round((1 - os.freemem() / total) * 1000) / 10;
}

function sample(): void {
  const row: MetricSample = { ts: Date.now(), cpuPct: readCpuPct(), tempC: readTempC(), memPct: readMemPct() };
  try {
    db.prepare('INSERT INTO system_metrics (ts, cpu_pct, temp_c, mem_pct) VALUES (?, ?, ?, ?)').run(
      row.ts,
      row.cpuPct,
      row.tempC,
      row.memPct
    );
  } catch (e) {
    log.warn('metrics sample failed to write', e);
  }
}

export function startMetrics(): void {
  setInterval(sample, 60_000).unref();
  sample();
}

export function getMetrics(sinceTs: number): MetricSample[] {
  const rows = db
    .prepare('SELECT ts, cpu_pct, temp_c, mem_pct FROM system_metrics WHERE ts >= ? ORDER BY ts ASC')
    .all(sinceTs) as { ts: number; cpu_pct: number | null; temp_c: number | null; mem_pct: number | null }[];
  return rows.map((r) => ({ ts: r.ts, cpuPct: r.cpu_pct, tempC: r.temp_c, memPct: r.mem_pct }));
}
