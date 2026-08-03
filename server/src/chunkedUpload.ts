import fs from 'fs';
import path from 'path';
import { DIRS } from './config';
import { id } from './util';

/**
 * Cloudflare Tunnel enforces a hard ~100MB cap per HTTP request, enforced at
 * its edge before a request ever reaches this server — no origin-side config
 * can raise it. Files above this get split into chunks on the client and
 * reassembled here, each chunk comfortably under that cap.
 */
export const CHUNK_SIZE = 40 * 1024 * 1024;

interface UploadSession {
  name: string;
  totalChunks: number;
  received: Set<number>;
  dir: string;
  createdAt: number;
}

const sessions = new Map<string, UploadSession>();

// Abandoned uploads (she navigated away, closed the tab, lost connection)
// are swept on the next init rather than left in DIRS.tmp forever.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function sweepStale(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [uploadId, s] of sessions) {
    if (s.createdAt < cutoff) {
      fs.rmSync(s.dir, { recursive: true, force: true });
      sessions.delete(uploadId);
    }
  }
}

export function initUpload(name: string, size: number): { uploadId: string; chunkSize: number; totalChunks: number } {
  sweepStale();
  const totalChunks = Math.max(1, Math.ceil(size / CHUNK_SIZE));
  const uploadId = id();
  const dir = path.join(DIRS.tmp, `chunked-${uploadId}`);
  fs.mkdirSync(dir, { recursive: true });
  sessions.set(uploadId, { name, totalChunks, received: new Set(), dir, createdAt: Date.now() });
  return { uploadId, chunkSize: CHUNK_SIZE, totalChunks };
}

function chunkPath(dir: string, index: number): string {
  return path.join(dir, String(index).padStart(6, '0'));
}

export function writeChunk(uploadId: string, index: number, data: Buffer): void {
  const s = sessions.get(uploadId);
  if (!s) throw new Error('Загрузка не найдена или истекла. Попробуйте ещё раз.');
  if (!Number.isInteger(index) || index < 0 || index >= s.totalChunks) throw new Error('Некорректная часть файла.');
  fs.writeFileSync(chunkPath(s.dir, index), data);
  s.received.add(index);
}

/** Concatenates every chunk into one file in DIRS.tmp and cleans up the parts. */
export function completeUpload(uploadId: string): { path: string; name: string } {
  const s = sessions.get(uploadId);
  if (!s) throw new Error('Загрузка не найдена или истекла. Попробуйте ещё раз.');
  if (s.received.size !== s.totalChunks) throw new Error('Загружены не все части файла. Попробуйте ещё раз.');
  const assembledPath = path.join(DIRS.tmp, `up-${id()}`);
  const fd = fs.openSync(assembledPath, 'w');
  try {
    for (let i = 0; i < s.totalChunks; i++) {
      fs.writeSync(fd, fs.readFileSync(chunkPath(s.dir, i)));
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.rmSync(s.dir, { recursive: true, force: true });
  sessions.delete(uploadId);
  return { path: assembledPath, name: s.name };
}

export function abortUpload(uploadId: string): void {
  const s = sessions.get(uploadId);
  if (!s) return;
  fs.rmSync(s.dir, { recursive: true, force: true });
  sessions.delete(uploadId);
}
