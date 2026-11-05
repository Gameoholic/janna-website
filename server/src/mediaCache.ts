import { Router } from 'express';
import { db, getSetting, setSetting } from './db';
import { now } from './util';
import { log } from './log';

/**
 * Smart offline cache for her videos — the server's small part. The caching
 * itself happens on her device (web/src/shared/mediaCache.ts + sw.js); the
 * server only hands out the rules and remembers what each device last said
 * it holds, so /dev can show it. Nothing here is ever shown to her.
 */

export interface MediaCachePolicy {
  enabled: boolean;
  /** Removed from the device when not played for this many days. */
  keepDays: number;
  /** Files bigger than this are never kept. */
  maxFileMB: number;
  /** Total budget per device; least recently played go first beyond it. */
  maxTotalMB: number;
}

export const DEFAULT_MEDIA_CACHE_POLICY: MediaCachePolicy = {
  enabled: true,
  keepDays: 3,
  maxFileMB: 300,
  maxTotalMB: 2000,
};

const POLICY_KEY = 'media_cache_policy';
const REPORT_PREFIX = 'media_cache_report:';

export function mediaCachePolicy(): MediaCachePolicy {
  const raw = getSetting(POLICY_KEY);
  if (!raw) return DEFAULT_MEDIA_CACHE_POLICY;
  try {
    return { ...DEFAULT_MEDIA_CACHE_POLICY, ...(JSON.parse(raw) as Partial<MediaCachePolicy>) };
  } catch {
    return DEFAULT_MEDIA_CACHE_POLICY;
  }
}

/** Validates and saves; returns an English error for /dev, or the saved policy. */
export function setMediaCachePolicy(input: unknown): MediaCachePolicy | string {
  if (!input || typeof input !== 'object') return 'mediaCache must be an object';
  const next = { ...mediaCachePolicy() };
  const body = input as Record<string, unknown>;
  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  const num = (key: 'keepDays' | 'maxFileMB' | 'maxTotalMB', min: number, max: number): string | null => {
    if (body[key] === undefined) return null;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < min || n > max) return `${key} must be between ${min} and ${max}`;
    next[key] = Math.floor(n);
    return null;
  };
  const error = num('keepDays', 1, 365) || num('maxFileMB', 1, 10000) || num('maxTotalMB', 50, 100000);
  if (error) return error;
  setSetting(POLICY_KEY, JSON.stringify(next));
  log.info(`media cache policy: ${JSON.stringify(next)}`);
  return next;
}

interface ReportFile {
  id: string;
  size: number | null;
  storedBytes: number;
  complete: boolean;
  playedAt: number;
}

interface StoredReport {
  reportedAt: number;
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  files: ReportFile[];
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Everything each device last reported, with file names joined in for /dev. */
export function mediaCacheReports(): {
  deviceId: string;
  deviceName: string;
  reportedAt: number;
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  files: (ReportFile & { name: string | null; deleted: boolean })[];
}[] {
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'media_cache_report:%'")
    .all() as { key: string; value: string }[];
  const deviceName = db.prepare('SELECT name FROM devices WHERE id = ?');
  const fileRow = db.prepare('SELECT name, deleted_at FROM files WHERE id = ?');
  const out = [];
  for (const row of rows) {
    const deviceId = row.key.slice(REPORT_PREFIX.length);
    const device = deviceName.get(deviceId) as { name: string } | undefined;
    if (!device) continue; // revoked device
    let report: StoredReport;
    try {
      report = JSON.parse(row.value) as StoredReport;
    } catch {
      continue;
    }
    out.push({
      deviceId,
      deviceName: device.name,
      ...report,
      files: report.files.map((f) => {
        const file = fileRow.get(f.id) as { name: string; deleted_at: number | null } | undefined;
        return { ...f, name: file?.name ?? null, deleted: !file || file.deleted_at !== null };
      }),
    });
  }
  return out;
}

export const mediaCacheRouter = Router();

mediaCacheRouter.get('/media-cache/policy', (_req, res) => {
  res.json({ policy: mediaCachePolicy() });
});

mediaCacheRouter.post('/media-cache/report', (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const files = Array.isArray(body?.files) ? (body!.files as unknown[]).slice(0, 500) : [];
  const report: StoredReport = {
    reportedAt: now(),
    usage: numOrNull(body?.usage),
    quota: numOrNull(body?.quota),
    persisted: typeof body?.persisted === 'boolean' ? body.persisted : null,
    files: files
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { id?: unknown }).id === 'string')
      .map((f) => ({
        id: String(f.id).slice(0, 64),
        size: numOrNull(f.size),
        storedBytes: numOrNull(f.storedBytes) ?? 0,
        complete: f.complete === true,
        playedAt: numOrNull(f.playedAt) ?? 0,
      })),
  };
  setSetting(REPORT_PREFIX + req.device!.id, JSON.stringify(report));
  res.json({ ok: true });
});
