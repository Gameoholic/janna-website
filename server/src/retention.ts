import { db, getSetting, setSetting } from './db';
import { now } from './util';
import { log } from './log';
import { FileRow, moveBinaryToTrash } from './routes/files';

/**
 * How long a deleted file stays recoverable before an admin purge may take
 * it. «Удалить» in Файлы only hides a file (P10); nothing on her side ever
 * destroys anything, and this window is never shown to her.
 *
 * 0 means keep hidden files forever — the honest default-safe option, and
 * what to set if the disk is roomy.
 */
export const DEFAULT_RETENTION_DAYS = 7;

export function retentionDays(): number {
  const raw = getSetting('trash_retention_days');
  if (raw === null) return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

export function setRetentionDays(days: number): number {
  const n = Math.max(0, Math.min(3650, Math.floor(days)));
  setSetting('trash_retention_days', String(n));
  log.info(`trash retention set to ${n} day(s)`);
  return n;
}

/** Timestamp before which a hidden file counts as expired; null = never. */
export function purgeCutoff(): number | null {
  const days = retentionDays();
  return days === 0 ? null : now() - days * 24 * 3600 * 1000;
}

export function expiredFileCount(): number {
  const cutoff = purgeCutoff();
  if (cutoff === null) return 0;
  const row = db
    .prepare('SELECT COUNT(*) n FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .get(cutoff) as { n: number };
  return row.n;
}

/**
 * Destroy hidden files whose window has run out. Binaries are moved to
 * trash/ rather than unlinked, so even this last step leaves a copy on disk
 * for as long as trash/ isn't emptied (P10 — nothing shreds silently).
 *
 * This is the one automatic deletion in the system. It only ever touches
 * files she explicitly deleted herself, and only after the configured
 * window; set the retention to 0 to switch it off entirely.
 */
export function purgeExpired(): { purged: number; foldersRemoved: number } {
  const cutoff = purgeCutoff();
  if (cutoff === null) return { purged: 0, foldersRemoved: 0 };
  const rows = db
    .prepare('SELECT * FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .all(cutoff) as FileRow[];
  for (const row of rows) moveBinaryToTrash(row);
  if (rows.length) {
    const del = db.prepare('DELETE FROM files WHERE id = ?');
    db.transaction(() => { for (const r of rows) del.run(r.id); })();
  }
  const foldersRemoved = db
    .prepare(
      `DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?
       AND NOT EXISTS (SELECT 1 FROM files WHERE files.folder_id = folders.id)`
    )
    .run(cutoff).changes;
  if (rows.length || foldersRemoved) {
    log.info(`retention purge: ${rows.length} file(s), ${foldersRemoved} folder(s)`);
  }
  return { purged: rows.length, foldersRemoved };
}
