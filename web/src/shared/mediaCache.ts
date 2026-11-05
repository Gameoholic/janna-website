/*
 * Smart offline cache for her videos — the page half (the worker half is in
 * public/sw.js, which serves the stored pieces back to the player).
 *
 * Why: she dances to short videos in the ממד, where the concrete walls make
 * the signal come and go. Streaming kept stopping no matter how well the
 * player reconnected. A video that is already on the phone can't stop.
 *
 * The rule, kept deliberately simple:
 *   - Whatever she plays (video or audio from Файлы) is kept on the device:
 *     the part she watches is saved as it streams, and a background filler
 *     fetches the rest while any of the apps is open — starting from where
 *     she is in the video, so the cache stays ahead of the picture.
 *   - Playing it again refreshes it. Not played for `keepDays` → removed.
 *   - Files bigger than `maxFileMB` are never kept (her dance videos are
 *     < 7 minutes, ~40–70 MB; a 2 GB film isn't worth a phone's space).
 *   - Over `maxTotalMB`, or the browser's storage running low, the least
 *     recently played go first. The one playing right now is never removed.
 *
 * She sees none of this — no "downloaded" badges, nothing to manage (P1).
 * The numbers come from the server and are changed only in /dev. What each
 * device holds is reported back so /dev can show it.
 *
 * Cache layout (keep in step with sw.js): one Cache per file named
 * janna-media-<fileId>, holding /__mc/meta (written by the worker),
 * /__mc/played (written here) and /__mc/c/<n> 1 MB pieces.
 */
import { api } from './api';

const MEDIA_PREFIX = 'janna-media-';
const CHUNK = 1048576;
const MB = 1024 * 1024;
const META_KEY = '/__mc/meta';
const PLAYED_KEY = '/__mc/played';
const CHUNK_PATH = '/__mc/c/';
const POLICY_STORAGE_KEY = 'janna-mc-policy';
const TOO_BIG_STORAGE_KEY = 'janna-mc-too-big';

export interface MediaCachePolicy {
  enabled: boolean;
  keepDays: number;
  maxFileMB: number;
  maxTotalMB: number;
}

const DEFAULT_POLICY: MediaCachePolicy = { enabled: true, keepDays: 3, maxFileMB: 300, maxTotalMB: 2000 };

interface Meta {
  size: number;
  type: string;
  etag: string;
}

interface CachedFile {
  id: string;
  name: string;
  meta: Meta | null;
  playedAt: number;
  chunks: Set<number>;
}

let policy: MediaCachePolicy = readStored(POLICY_STORAGE_KEY, DEFAULT_POLICY);
let started = false;
let running = false;
let failures = 0;
let wakeTimer: number | null = null;
let reportTimer: number | null = null;
let lastReportAt = 0;
/** The file on screen right now, and how far into it she is (0..1). */
let current: { id: string; fraction: () => number } | null = null;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private window / storage blocked: fine */ }
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator;
}

export function mediaIdFromSrc(src: string): string | null {
  const m = /^\/api\/media\/([^/?#]+)$/.exec(src);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ------------------------------ reading state ----------------------------- */

async function readJson<T>(cache: Cache, key: string): Promise<T | null> {
  try {
    const r = await cache.match(key);
    return r ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function readFile(name: string): Promise<CachedFile> {
  const cache = await caches.open(name);
  const [meta, played, keys] = await Promise.all([
    readJson<Meta>(cache, META_KEY),
    readJson<{ at: number }>(cache, PLAYED_KEY),
    cache.keys(),
  ]);
  const chunks = new Set<number>();
  for (const req of keys) {
    const path = new URL(req.url).pathname;
    if (path.indexOf(CHUNK_PATH) === 0) chunks.add(Number(path.slice(CHUNK_PATH.length)));
  }
  return { id: name.slice(MEDIA_PREFIX.length), name, meta, playedAt: played?.at ?? 0, chunks };
}

async function listFiles(): Promise<CachedFile[]> {
  const names = (await caches.keys()).filter((n) => n.indexOf(MEDIA_PREFIX) === 0);
  return Promise.all(names.map(readFile));
}

const totalChunks = (meta: Meta) => Math.ceil(meta.size / CHUNK);
const isComplete = (f: CachedFile) => !!f.meta && f.chunks.size >= totalChunks(f.meta);
const storedBytes = (f: CachedFile) =>
  f.meta ? Math.min(f.meta.size, f.chunks.size * CHUNK) : f.chunks.size * CHUNK;

/* ------------------------------ policy ----------------------------------- */

async function refreshPolicy(): Promise<void> {
  try {
    const res = await api.get<{ policy: MediaCachePolicy }>('/api/media-cache/policy');
    policy = { ...DEFAULT_POLICY, ...res.policy };
    writeStored(POLICY_STORAGE_KEY, policy);
  } catch {
    /* offline: keep the last policy we were told */
  }
}

function tooBigIds(): Record<string, number> {
  return readStored<Record<string, number>>(TOO_BIG_STORAGE_KEY, {});
}

function isTooBig(size: number): boolean {
  return size > policy.maxFileMB * MB;
}

/* ------------------------------ cleanup ---------------------------------- */

async function dropAll(): Promise<void> {
  const names = (await caches.keys()).filter((n) => n.indexOf(MEDIA_PREFIX) === 0);
  await Promise.all(names.map((n) => caches.delete(n)));
}

/** Not played for keepDays → gone; then oldest-played first until within budget. */
async function evict(): Promise<void> {
  const files = await listFiles();
  const cutoff = Date.now() - policy.keepDays * 24 * 3600 * 1000;
  const keep: CachedFile[] = [];
  for (const f of files) {
    if (f.id === current?.id) {
      keep.push(f);
      continue;
    }
    if (f.playedAt < cutoff || (f.meta && isTooBig(f.meta.size))) await caches.delete(f.name);
    else keep.push(f);
  }
  keep.sort((a, b) => a.playedAt - b.playedAt); // least recently played first
  let total = keep.reduce((sum, f) => sum + storedBytes(f), 0);
  let lowOnSpace = false;
  try {
    const est = await navigator.storage?.estimate?.();
    // Leave the phone breathing room: never fill more than 80% of what the
    // browser is allowed.
    if (est?.quota && est.usage !== undefined) lowOnSpace = est.usage > est.quota * 0.8;
  } catch { /* no estimate on this browser */ }
  for (const f of keep) {
    if (total <= policy.maxTotalMB * MB && !lowOnSpace) break;
    if (f.id === current?.id) continue;
    await caches.delete(f.name);
    total -= storedBytes(f);
    lowOnSpace = false; // re-estimating per delete is overkill; one step per run
  }
}

/* ------------------------------ background filler ------------------------ */

function chunkOrder(total: number, startAt: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < total; i++) order.push((startAt + i) % total);
  return order;
}

/** The next missing piece: the file on screen first, then most recently played. */
async function nextJob(): Promise<{ id: string; piece: number } | null> {
  const files = await listFiles();
  files.sort((a, b) => {
    if (a.id === current?.id) return -1;
    if (b.id === current?.id) return 1;
    return b.playedAt - a.playedAt;
  });
  for (const f of files) {
    if (!f.meta) return { id: f.id, piece: 0 }; // first piece tells the worker the size
    if (isTooBig(f.meta.size)) {
      // Too big to keep: forget it, and remember not to start on it again.
      const big = tooBigIds();
      big[f.id] = f.meta.size;
      writeStored(TOO_BIG_STORAGE_KEY, big);
      await caches.delete(f.name);
      continue;
    }
    if (isComplete(f)) continue;
    const total = totalChunks(f.meta);
    let startAt = 0;
    if (f.id === current?.id) {
      const fraction = current.fraction();
      if (Number.isFinite(fraction)) startAt = Math.max(0, Math.min(total - 1, Math.floor(fraction * total)));
    }
    for (const piece of chunkOrder(total, startAt)) {
      if (!f.chunks.has(piece)) return { id: f.id, piece };
    }
  }
  return null;
}

/**
 * Asks for one piece through the worker, which saves it.
 * 'ok' = it's on the phone now; 'retry' = no signal, try later;
 * 'stop' = no worker is saving pieces on this page, don't spend her data.
 */
async function fetchPiece(id: string, piece: number): Promise<'ok' | 'retry' | 'stop'> {
  const start = piece * CHUNK;
  try {
    const res = await fetch(`/api/media/${encodeURIComponent(id)}`, {
      headers: { Range: `bytes=${start}-${start + CHUNK - 1}` },
      credentials: 'same-origin',
    });
    if (res.status === 404) {
      await caches.delete(MEDIA_PREFIX + id); // deleted on the server
      return 'ok';
    }
    // Answered by the network directly, not by our worker (an older worker
    // still in charge until the page reloads): the bytes would be thrown away.
    if (res.headers.get('X-Media-Cache') !== '1') {
      void res.body?.cancel().catch(() => undefined);
      return 'stop';
    }
    if (res.status !== 206) {
      void res.body?.cancel().catch(() => undefined);
      return 'retry';
    }
    await res.arrayBuffer();
    const cache = await caches.open(MEDIA_PREFIX + id);
    return (await cache.match(CHUNK_PATH + piece)) ? 'ok' : 'retry';
  } catch {
    return 'retry';
  }
}

function kick(): void {
  if (!started || running) return;
  if (wakeTimer !== null) window.clearTimeout(wakeTimer);
  wakeTimer = null;
  running = true;
  void fill().finally(() => {
    running = false;
  });
}

async function fill(): Promise<void> {
  for (;;) {
    // No worker in charge (very first visit, or a private window): nothing
    // would save the pieces, so don't spend her data.
    if (!policy.enabled || !navigator.serviceWorker.controller) return;
    const job = await nextJob();
    if (!job) {
      scheduleReport();
      return;
    }
    const result = await fetchPiece(job.id, job.piece);
    if (result === 'stop') return;
    if (result === 'ok') {
      failures = 0;
      const f = await readFile(MEDIA_PREFIX + job.id).catch(() => null);
      if (f && isComplete(f)) {
        await evict();
        scheduleReport();
      }
      continue;
    }
    // No signal right now: back off (2s, 4s … 30s) and try again, or sooner
    // when the phone says it's back online.
    failures += 1;
    const delay = Math.min(30000, 2000 * 2 ** (failures - 1));
    wakeTimer = window.setTimeout(() => kick(), delay);
    return;
  }
}

/* ------------------------------ reporting to /dev ------------------------ */

function scheduleReport(): void {
  if (reportTimer !== null) return;
  const wait = Math.max(0, 60000 - (Date.now() - lastReportAt));
  reportTimer = window.setTimeout(() => {
    reportTimer = null;
    void sendReport();
  }, wait);
}

async function sendReport(): Promise<void> {
  try {
    const files = await listFiles();
    let usage: number | null = null;
    let quota: number | null = null;
    let persisted: boolean | null = null;
    try {
      const est = await navigator.storage?.estimate?.();
      usage = est?.usage ?? null;
      quota = est?.quota ?? null;
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch { /* not available */ }
    lastReportAt = Date.now();
    await api.post('/api/media-cache/report', {
      usage,
      quota,
      persisted,
      files: files.map((f) => ({
        id: f.id,
        size: f.meta?.size ?? null,
        storedBytes: storedBytes(f),
        complete: isComplete(f),
        playedAt: f.playedAt,
      })),
    });
  } catch {
    /* offline — the next report will carry it */
  }
}

/* ------------------------------ public API ------------------------------- */

/** Called once per page by AppShell, after the device check passes. */
export function startMediaCache(): void {
  if (started || !supported()) return;
  started = true;
  window.addEventListener('online', () => {
    failures = 0;
    kick();
  });
  void (async () => {
    try {
      // Asks the browser not to clear these under storage pressure. Chrome
      // decides silently (installed apps usually get it); nothing to show her.
      await navigator.storage?.persist?.();
    } catch { /* ignore */ }
    await refreshPolicy();
    if (!policy.enabled) {
      await dropAll().catch(() => undefined);
      scheduleReport();
      return;
    }
    await evict().catch(() => undefined);
    scheduleReport();
    kick();
  })();
}

/**
 * She pressed play on `src`. Marks it as one to keep (or refreshes it) and
 * puts it first in line for the filler. `fraction` tells the filler how far
 * into the file she is, so it fetches ahead of the picture.
 */
export function notePlayed(src: string, fraction: () => number): void {
  const id = mediaIdFromSrc(src);
  if (!id || !supported() || !policy.enabled) return;
  const knownSize = tooBigIds()[id];
  if (knownSize !== undefined && isTooBig(knownSize)) return;
  current = { id, fraction };
  void (async () => {
    try {
      const cache = await caches.open(MEDIA_PREFIX + id);
      await cache.put(PLAYED_KEY, new Response(JSON.stringify({ at: Date.now() })));
    } catch {
      return;
    }
    failures = 0;
    kick();
  })();
}

/** The player for `src` went away; the filler keeps finishing it regardless. */
export function noteClosed(src: string): void {
  const id = mediaIdFromSrc(src);
  if (id && current?.id === id) current = null;
}
