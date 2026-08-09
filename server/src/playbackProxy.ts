import path from 'path';
import fs from 'fs';
import { db } from './db';
import { DIRS } from './config';
import { id } from './util';
import { probe, makePlaybackProxy } from './ffmpeg';
import { log } from './log';

/**
 * Browser-safe H.264/AAC copies for video files whose source codec Chrome
 * can't decode (HEVC most commonly, from iPhone-originated .mov files).
 * Keyed by file/session id — data/playback/<key>.mp4 existing on disk IS the
 * cache, so there's no DB column to keep in sync (same idea as thumb files).
 */

export function proxyPathFor(key: string): string {
  return path.join(DIRS.playback, `${key}.mp4`);
}

/** Sync check used by every streaming route — cheap, no ffprobe involved. */
export function resolvePlaybackPath(key: string, sourcePath: string): string {
  const proxy = proxyPathFor(key);
  return fs.existsSync(proxy) ? proxy : sourcePath;
}

const inFlight = new Set<string>();

/** Generates the proxy if needed. Safe to call repeatedly — no-ops once cached. */
export async function ensurePlaybackProxy(key: string, sourcePath: string, hasAudio: boolean): Promise<void> {
  const out = proxyPathFor(key);
  if (fs.existsSync(out)) return;
  if (inFlight.has(key)) return; // another caller is already generating this one
  inFlight.add(key);
  const tmp = path.join(DIRS.tmp, `proxy-${key}-${id()}.mp4`);
  try {
    await makePlaybackProxy(sourcePath, tmp, hasAudio);
    fs.renameSync(tmp, out); // atomic — a killed transcode never leaves a "done"-looking file
  } finally {
    inFlight.delete(key);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}

/** Fire-and-forget — never blocks the caller (upload response, etc). */
export function schedulePlaybackProxy(key: string, sourcePath: string, hasAudio: boolean): void {
  void ensurePlaybackProxy(key, sourcePath, hasAudio).catch((e) => {
    log.warn(`playback proxy failed for ${key}`, e);
  });
}

export function deletePlaybackProxy(key: string): void {
  try {
    const out = proxyPathFor(key);
    if (fs.existsSync(out)) fs.unlinkSync(out);
  } catch (e) {
    log.warn(`playback proxy cleanup failed for ${key}`, e);
  }
}

interface VideoFileRow {
  id: string;
  path: string;
}

/**
 * One-time-per-file catch-up for videos uploaded before this feature (or
 * whose proxy generation never ran) — runs in the background at startup so
 * fixing already-stored files needs no manual step. Sequential on purpose:
 * the Pi shouldn't run multiple ffmpeg transcodes at once.
 */
export async function backfillPlaybackProxies(): Promise<void> {
  const rows = db.prepare("SELECT id, path FROM files WHERE kind = 'video'").all() as VideoFileRow[];
  let checked = 0;
  let generated = 0;
  for (const row of rows) {
    checked++;
    if (fs.existsSync(proxyPathFor(row.id))) continue;
    if (!fs.existsSync(row.path)) continue;
    try {
      const info = await probe(row.path);
      if (!info.hasVideo || info.videoCodec === 'h264') continue;
      await ensurePlaybackProxy(row.id, row.path, info.hasAudio);
      generated++;
      log.info(`playback proxy backfilled for ${row.id} (${info.videoCodec})`);
    } catch (e) {
      log.warn(`playback proxy backfill failed for ${row.id}`, e);
    }
  }
  if (checked > 0) log.info(`playback proxy backfill done: ${generated} generated of ${checked} video files checked`);
}
