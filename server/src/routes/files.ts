import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Fuse from 'fuse.js';
import { db } from '../db';
import { DIRS } from '../config';
import { id, now, extOf } from '../util';
import { probe, makeVideoThumb, makeImageThumb } from '../ffmpeg';
import { completeUpload } from '../chunkedUpload';
import { log } from '../log';

export interface FolderRow {
  id: string;
  name: string;
  created_at: number;
}

export interface FileRow {
  id: string;
  folder_id: string | null;
  name: string;
  kind: 'video' | 'image' | 'audio' | 'document' | 'other';
  mime: string;
  size: number;
  path: string;
  thumb_path: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  origin: string;
  created_at: number;
  snippet: string | null;
}

const EXT_KINDS: Record<string, { kind: FileRow['kind']; mime: string }> = {
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mkv': { kind: 'video', mime: 'video/x-matroska' },
  '.avi': { kind: 'video', mime: 'video/x-msvideo' },
  '.3gp': { kind: 'video', mime: 'video/3gpp' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
  '.heic': { kind: 'image', mime: 'image/heic' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.aac': { kind: 'audio', mime: 'audio/aac' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.opus': { kind: 'audio', mime: 'audio/ogg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.amr': { kind: 'audio', mime: 'audio/amr' },
};

export function kindOf(name: string): { kind: FileRow['kind']; mime: string } {
  return EXT_KINDS[extOf(name)] || { kind: 'other', mime: 'application/octet-stream' };
}

/** Browsers submit multipart filenames that busboy decodes as latin1 — undo that. */
export function fixUploadName(raw: string): string {
  try {
    return Buffer.from(raw, 'latin1').toString('utf8');
  } catch {
    return raw;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DIRS.tmp),
    filename: (_req, _file, cb) => cb(null, `up-${id()}`),
  }),
  limits: { fileSize: 6 * 1024 * 1024 * 1024 },
});

/** Probes AV files and builds a thumbnail; failures never block the upload. */
export async function enrichStoredFile(fileId: string): Promise<void> {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileRow | undefined;
  if (!row) return;
  let durationMs: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let thumbPath: string | null = null;
  try {
    if (row.kind === 'video' || row.kind === 'audio') {
      const info = await probe(row.path);
      durationMs = info.durationMs || null;
      width = info.width;
      height = info.height;
    }
    if (row.kind === 'video') {
      const out = path.join(DIRS.thumbs, `${row.id}.jpg`);
      await makeVideoThumb(row.path, out, Math.min(2000, (durationMs || 4000) / 2));
      thumbPath = out;
    } else if (row.kind === 'image') {
      const out = path.join(DIRS.thumbs, `${row.id}.jpg`);
      await makeImageThumb(row.path, out);
      thumbPath = out;
    }
  } catch (e) {
    log.warn(`enrich failed for ${row.id} (${row.name})`, e);
  }
  db.prepare('UPDATE files SET duration_ms = ?, width = ?, height = ?, thumb_path = ? WHERE id = ?').run(
    durationMs,
    width,
    height,
    thumbPath,
    fileId
  );
}

/** Registers a binary already sitting on disk as one of her files. */
export async function registerFile(opts: {
  sourcePath: string;
  name: string;
  folderId: string | null;
  origin: 'upload' | 'edited';
  move: boolean;
}): Promise<FileRow> {
  const fileId = id();
  const ext = extOf(opts.name) || '';
  const finalPath = path.join(DIRS.media, `${fileId}${ext}`);
  if (opts.move) {
    fs.renameSync(opts.sourcePath, finalPath);
  } else {
    fs.copyFileSync(opts.sourcePath, finalPath);
  }
  const { kind, mime } = kindOf(opts.name);
  const size = fs.statSync(finalPath).size;
  const name = uniqueNameInFolder(opts.name, opts.folderId);
  db.prepare(
    `INSERT INTO files (id, folder_id, name, kind, mime, size, path, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(fileId, opts.folderId, name, kind, mime, size, finalPath, opts.origin, now());
  await enrichStoredFile(fileId);
  return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileRow;
}

export function uniqueNameInFolder(name: string, folderId: string | null): string {
  const exists = (n: string) =>
    !!db
      .prepare(`SELECT 1 FROM files WHERE name = ? AND folder_id ${folderId ? '= ?' : 'IS NULL'}`)
      .get(...(folderId ? [n, folderId] : [n]));
  if (!exists(name)) return name;
  const ext = extOf(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

// Folders are a single flat level now — a file's path is at most one folder.
export function folderPath(folderId: string | null): { id: string; name: string }[] {
  if (!folderId) return [];
  const row = db.prepare('SELECT id, name FROM folders WHERE id = ?').get(folderId) as
    | { id: string; name: string }
    | undefined;
  return row ? [{ id: row.id, name: row.name }] : [];
}

export function moveBinaryToTrash(row: Pick<FileRow, 'id' | 'path' | 'thumb_path' | 'name'>): void {
  try {
    if (fs.existsSync(row.path)) {
      fs.renameSync(row.path, path.join(DIRS.trash, `${row.id}-${path.basename(row.path)}`));
    }
    if (row.thumb_path && fs.existsSync(row.thumb_path)) {
      fs.unlinkSync(row.thumb_path);
    }
  } catch (e) {
    log.warn(`trash move failed for ${row.id}`, e);
  }
}

export function fileToJson(row: FileRow) {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    hasThumb: !!row.thumb_path,
    origin: row.origin,
    createdAt: row.created_at,
    snippet: row.snippet,
  };
}

export const filesRouter = Router();

/** Everything the sidebar needs: all folders + file counts. */
filesRouter.get('/state', (_req, res) => {
  const folders = db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all() as FolderRow[];
  const counts = db
    .prepare('SELECT folder_id, COUNT(*) AS n FROM files GROUP BY folder_id')
    .all() as { folder_id: string | null; n: number }[];
  const countMap: Record<string, number> = {};
  let rootCount = 0;
  for (const c of counts) {
    if (c.folder_id === null) rootCount = c.n;
    else countMap[c.folder_id] = c.n;
  }
  res.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      fileCount: countMap[f.id] || 0,
    })),
    rootFileCount: rootCount,
  });
});

filesRouter.get('/folders/:id/files', (req, res) => {
  const folderId = req.params.id === 'root' ? null : req.params.id;
  if (folderId && !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
    res.status(404).json({ message: 'Папка не найдена.' });
    return;
  }
  const rows = db
    .prepare(`SELECT * FROM files WHERE folder_id ${folderId ? '= ?' : 'IS NULL'} ORDER BY created_at DESC`)
    .all(...(folderId ? [folderId] : [])) as FileRow[];
  res.json({ files: rows.map(fileToJson) });
});

filesRouter.post('/folders', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (!name) {
    res.status(400).json({ message: 'Введите название папки.' });
    return;
  }
  const folderId = id();
  db.prepare('INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?)').run(folderId, name, now());
  res.json({ id: folderId, name, fileCount: 0 });
});

filesRouter.patch('/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id) as FolderRow | undefined;
  if (!folder) {
    res.status(404).json({ message: 'Папка не найдена.' });
    return;
  }
  if (typeof req.body?.name === 'string') {
    const name = req.body.name.trim().slice(0, 100);
    if (!name) {
      res.status(400).json({ message: 'Введите название папки.' });
      return;
    }
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folder.id);
  }
  res.json({ ok: true });
});

/** Deliberate delete: binaries land in trash, never vanish silently. */
filesRouter.delete('/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id) as FolderRow | undefined;
  if (!folder) {
    res.status(404).json({ message: 'Папка не найдена.' });
    return;
  }
  const files = db.prepare('SELECT * FROM files WHERE folder_id = ?').all(folder.id) as FileRow[];
  for (const f of files) moveBinaryToTrash(f);
  db.prepare('DELETE FROM files WHERE folder_id = ?').run(folder.id);
  db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
  log.info(`folder deleted: ${folder.name} (${files.length} files to trash)`);
  res.json({ ok: true });
});

filesRouter.post('/upload', upload.array('files', 50), async (req, res) => {
  const folderId = req.query.folderId && req.query.folderId !== 'root' ? String(req.query.folderId) : null;
  // Every file lives in a folder — no loose files at the top level.
  if (!folderId || !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
    for (const f of (req.files as Express.Multer.File[]) || []) {
      try { fs.unlinkSync(f.path); } catch { /* best effort */ }
    }
    res.status(folderId ? 404 : 400).json({ message: folderId ? 'Папка не найдена.' : 'Сначала выберите папку.' });
    return;
  }
  const uploaded = (req.files as Express.Multer.File[]) || [];
  const results = [];
  for (const f of uploaded) {
    const name = fixUploadName(f.originalname);
    try {
      const row = await registerFile({
        sourcePath: f.path,
        name,
        folderId,
        origin: 'upload',
        move: true,
      });
      results.push(fileToJson(row));
    } catch (e) {
      log.error(`upload failed for ${name}`, e);
    }
  }
  if (uploaded.length > 0 && results.length === 0) {
    res.status(500).json({ message: 'Не получилось загрузить файлы. Попробуйте ещё раз.' });
    return;
  }
  res.json({ files: results });
});

/** Finishes a chunked upload (see routes/uploads.ts) — files too big for one request. */
filesRouter.post('/upload/chunked', async (req, res) => {
  const folderId = req.query.folderId && req.query.folderId !== 'root' ? String(req.query.folderId) : null;
  if (!folderId || !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
    res.status(folderId ? 404 : 400).json({ message: folderId ? 'Папка не найдена.' : 'Сначала выберите папку.' });
    return;
  }
  const uploadId = String(req.body?.uploadId || '');
  let assembled: { path: string; name: string };
  try {
    assembled = completeUpload(uploadId);
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : 'Не получилось загрузить файл.' });
    return;
  }
  try {
    // The name arrived as plain JSON (not multipart), so it's already
    // correct UTF-8 — fixUploadName is only for busboy's latin1 mangling.
    const row = await registerFile({ sourcePath: assembled.path, name: assembled.name, folderId, origin: 'upload', move: true });
    res.json({ files: [fileToJson(row)] });
  } catch (e) {
    log.error(`chunked upload failed for ${assembled.name}`, e);
    res.status(500).json({ message: 'Не получилось загрузить файл. Попробуйте ещё раз.' });
  }
});

filesRouter.get('/files/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as FileRow | undefined;
  if (!row) {
    res.status(404).json({ message: 'Файл не найден.' });
    return;
  }
  const share = db.prepare('SELECT token FROM shares WHERE file_id = ?').get(row.id) as
    | { token: string }
    | undefined;
  res.json({ file: fileToJson(row), folderPath: folderPath(row.folder_id), shareToken: share?.token || null });
});

filesRouter.patch('/files/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as FileRow | undefined;
  if (!row) {
    res.status(404).json({ message: 'Файл не найден.' });
    return;
  }
  if (typeof req.body?.name === 'string') {
    let name = req.body.name.trim().slice(0, 200);
    if (!name) {
      res.status(400).json({ message: 'Введите название файла.' });
      return;
    }
    const oldExt = extOf(row.name);
    if (oldExt && extOf(name) !== oldExt) name += oldExt; // keep the extension for her
    db.prepare('UPDATE files SET name = ? WHERE id = ?').run(uniqueNameInFolder(name, row.folder_id), row.id);
  }
  if ('folderId' in (req.body || {})) {
    const folderId = req.body.folderId && req.body.folderId !== 'root' ? String(req.body.folderId) : null;
    // Every file lives in a folder — moving one "out" of all folders isn't allowed.
    if (!folderId) {
      res.status(400).json({ message: 'Файл должен быть в какой-нибудь папке.' });
      return;
    }
    if (!db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
      res.status(404).json({ message: 'Папка не найдена.' });
      return;
    }
    db.prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(folderId, row.id);
  }
  const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(row.id) as FileRow;
  res.json({ file: fileToJson(updated), folderPath: folderPath(updated.folder_id) });
});

filesRouter.delete('/files/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as FileRow | undefined;
  if (!row) {
    res.status(404).json({ message: 'Файл не найден.' });
    return;
  }
  moveBinaryToTrash(row);
  db.prepare('DELETE FROM files WHERE id = ?').run(row.id); // shares cascade → link dies with the file
  log.info(`file deleted: ${row.name}`);
  res.json({ ok: true });
});

/** Forgiving, typo-tolerant search by filename (8B). */
filesRouter.get('/search', (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    res.json({ results: [] });
    return;
  }
  const rows = db.prepare('SELECT * FROM files').all() as FileRow[];
  const fuse = new Fuse(rows, {
    keys: ['name'],
    threshold: 0.45,
    ignoreLocation: true,
    includeScore: true,
  });
  const results = fuse
    .search(query)
    .slice(0, 30)
    .map((r) => ({
      file: fileToJson(r.item),
      folderPath: folderPath(r.item.folder_id),
    }));
  res.json({ results });
});

function streamStoredFile(req: Request, res: Response, download: boolean): void {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id) as FileRow | undefined;
  if (!row || !fs.existsSync(row.path)) {
    res.status(404).json({ message: 'Файл не найден.' });
    return;
  }
  if (download) {
    // Her display name for a document has no extension (it's a note title,
    // not a filename) — but a downloaded file needs one to open correctly.
    const downloadName = row.kind === 'document' && extOf(row.name) !== '.html' ? `${row.name}.html` : row.name;
    res.download(row.path, downloadName);
  } else {
    res.sendFile(row.path, {
      headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600' },
      acceptRanges: true,
    });
  }
}

filesRouter.get('/media/:id', (req, res) => streamStoredFile(req, res, false));
filesRouter.get('/download/:id', (req, res) => streamStoredFile(req, res, true));

filesRouter.get('/thumb/:id', (req, res) => {
  const row = db.prepare('SELECT thumb_path FROM files WHERE id = ?').get(req.params.id) as
    | { thumb_path: string | null }
    | undefined;
  if (!row || !row.thumb_path || !fs.existsSync(row.thumb_path)) {
    res.status(404).end();
    return;
  }
  res.sendFile(row.thumb_path, { headers: { 'Cache-Control': 'private, max-age=86400' } });
});
