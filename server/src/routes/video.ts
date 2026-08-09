import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../db';
import { DIRS } from '../config';
import { id, now, extOf } from '../util';
import { probe, EditParams, Segment } from '../ffmpeg';
import { startEditJob, getJob, getSession, EditJobRow, EditSessionRow } from '../jobs';
import { registerFile, fileToJson, folderPath, FileRow, kindOf, fixUploadName } from './files';
import { completeUpload } from '../chunkedUpload';
import { ensurePlaybackProxy, resolvePlaybackPath } from '../playbackProxy';
import { log } from '../log';

const ALLOWED_SPEEDS = [0.6, 0.7, 0.8, 0.9, 1];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DIRS.editorSources),
    filename: (_req, _file, cb) => cb(null, `src-${id()}`),
  }),
  limits: { fileSize: 6 * 1024 * 1024 * 1024 },
});

function sessionToJson(session: EditSessionRow) {
  return {
    id: session.id,
    name: session.source_name,
    durationMs: session.duration_ms,
    width: session.width,
    height: session.height,
    hasAudio: session.has_audio === 1,
  };
}

function jobToJson(job: EditJobRow) {
  return {
    id: job.id,
    sessionId: job.session_id,
    state: job.state,
    progress: job.progress,
    outputName: job.output_name,
    durationMs: job.duration_ms,
    error: job.error,
    savedFileId: job.saved_file_id,
  };
}

async function createSession(sourcePath: string, sourceName: string, sourceFileId: string | null) {
  const info = await probe(sourcePath);
  if (!info.hasVideo || info.durationMs <= 0) {
    return null;
  }
  const sessionId = id();
  // Editor preview streams straight from this file below — for HEVC etc.
  // sources it would otherwise show a frozen first frame while scrubbing
  // (same bug as Файлы playback). Keyed by the Файлы file id when picked
  // from there, so this reuses/feeds the same cache instead of duplicating
  // the transcode.
  if (info.videoCodec !== 'h264') {
    await ensurePlaybackProxy(sourceFileId ?? sessionId, sourcePath, info.hasAudio);
  }
  db.prepare(
    `INSERT INTO edit_sessions (id, source_path, source_name, source_file_id, duration_ms, width, height, has_audio, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    sourcePath,
    sourceName,
    sourceFileId,
    info.durationMs,
    info.width,
    info.height,
    info.hasAudio ? 1 : 0,
    now()
  );
  return getSession(sessionId)!;
}

export const videoRouter = Router();

/** She uploads a video to edit. The upload itself is kept as the untouched source. */
videoRouter.post('/edit/sources', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) {
    res.status(400).json({ message: 'Выберите видео.' });
    return;
  }
  const name = fixUploadName(f.originalname);
  try {
    const session = await createSession(f.path, name, null);
    if (!session) {
      fs.unlinkSync(f.path);
      res.status(400).json({ message: 'Это не видео. Выберите видеофайл.' });
      return;
    }
    res.json({ session: sessionToJson(session) });
  } catch (e) {
    log.error('edit source upload failed', e);
    res.status(500).json({ message: 'Не получилось открыть видео. Попробуйте ещё раз.' });
  }
});

/** Finishes a chunked upload (see routes/uploads.ts) — videos too big for one request. */
videoRouter.post('/edit/sources/chunked', async (req, res) => {
  const uploadId = String(req.body?.uploadId || '');
  let assembled: { path: string; name: string };
  try {
    assembled = completeUpload(uploadId);
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : 'Не получилось открыть видео.' });
    return;
  }
  try {
    const session = await createSession(assembled.path, assembled.name, null);
    if (!session) {
      fs.unlinkSync(assembled.path);
      res.status(400).json({ message: 'Это не видео. Выберите видеофайл.' });
      return;
    }
    res.json({ session: sessionToJson(session) });
  } catch (e) {
    log.error('chunked edit source upload failed', e);
    res.status(500).json({ message: 'Не получилось открыть видео. Попробуйте ещё раз.' });
  }
});

/** …or picks one from Файлы. The stored file is only ever read (P10). */
videoRouter.post('/edit/from-file', async (req, res) => {
  const fileId = String(req.body?.fileId || '');
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileRow | undefined;
  if (!file || !fs.existsSync(file.path)) {
    res.status(404).json({ message: 'Файл не найден.' });
    return;
  }
  if (file.kind !== 'video') {
    res.status(400).json({ message: 'Это не видео. Выберите видеофайл.' });
    return;
  }
  try {
    const session = await createSession(file.path, file.name, file.id);
    if (!session) {
      res.status(400).json({ message: 'Не получилось открыть это видео.' });
      return;
    }
    res.json({ session: sessionToJson(session) });
  } catch (e) {
    log.error('edit from-file failed', e);
    res.status(500).json({ message: 'Не получилось открыть видео. Попробуйте ещё раз.' });
  }
});

videoRouter.get('/edit/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ message: 'Видео не найдено.' });
    return;
  }
  res.json({ session: sessionToJson(session) });
});

videoRouter.get('/edit/sessions/:id/media', (req, res) => {
  const session = getSession(req.params.id);
  if (!session || !fs.existsSync(session.source_path)) {
    res.status(404).json({ message: 'Видео не найдено.' });
    return;
  }
  const servePath = resolvePlaybackPath(session.source_file_id ?? session.id, session.source_path);
  const mime = servePath === session.source_path ? kindOf(session.source_name).mime : 'video/mp4';
  res.sendFile(servePath, {
    headers: { 'Content-Type': mime === 'application/octet-stream' ? 'video/mp4' : mime },
    acceptRanges: true,
  });
});

/** Kick off the FFmpeg job: keep-segments jumpcut + pitch-preserved speed. */
videoRouter.post('/edit/jobs', (req, res) => {
  const session = getSession(String(req.body?.sessionId || ''));
  if (!session) {
    res.status(404).json({ message: 'Видео не найдено.' });
    return;
  }
  const speed = Number(req.body?.speed ?? 1);
  if (!ALLOWED_SPEEDS.includes(speed)) {
    res.status(400).json({ message: 'Такая скорость не поддерживается.' });
    return;
  }
  const rawSegments = Array.isArray(req.body?.segments) ? (req.body.segments as Segment[]) : [];
  const segments: Segment[] = [];
  for (const seg of rawSegments) {
    const startMs = Math.max(0, Math.round(Number(seg.startMs)));
    const endMs = Math.min(session.duration_ms, Math.round(Number(seg.endMs)));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs - startMs >= 200) segments.push({ startMs, endMs });
  }
  segments.sort((a, b) => a.startMs - b.startMs);
  // Overlapping bands are merged rather than rejected — forgiving by design.
  const merged: Segment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, seg.endMs);
    } else {
      merged.push({ ...seg });
    }
  }
  if (merged.length === 0 && speed === 1) {
    res.status(400).json({ message: 'Сначала выберите часть видео или скорость.' });
    return;
  }
  const params: EditParams = { segments: merged, speed };
  const job = startEditJob(session, params);
  res.json({ job: jobToJson(job) });
});

videoRouter.get('/edit/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ message: 'Задание не найдено.' });
    return;
  }
  res.json({ job: jobToJson(job) });
});

videoRouter.get('/edit/jobs/:id/media', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.state !== 'done' || !job.output_path || !fs.existsSync(job.output_path)) {
    res.status(404).json({ message: 'Видео ещё не готово.' });
    return;
  }
  res.sendFile(job.output_path, { headers: { 'Content-Type': 'video/mp4' }, acceptRanges: true });
});

videoRouter.get('/edit/jobs/:id/download', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.state !== 'done' || !job.output_path || !fs.existsSync(job.output_path)) {
    res.status(404).json({ message: 'Видео ещё не готово.' });
    return;
  }
  res.download(job.output_path, job.output_name);
});

/** «Сохранить в Файлы» — the result lands in her storage as a NEW file. */
videoRouter.post('/edit/jobs/:id/save', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.state !== 'done' || !job.output_path || !fs.existsSync(job.output_path)) {
    res.status(404).json({ message: 'Видео ещё не готово.' });
    return;
  }
  const folderId = req.body?.folderId && req.body.folderId !== 'root' ? String(req.body.folderId) : null;
  // Every file lives in a folder — no loose files at the top level.
  if (!folderId) {
    res.status(400).json({ message: 'Сначала выберите папку.' });
    return;
  }
  if (!db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
    res.status(404).json({ message: 'Папка не найдена.' });
    return;
  }
  let name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 200) : job.output_name;
  if (!extOf(name)) name += '.mp4';
  try {
    const row = await registerFile({
      sourcePath: job.output_path,
      name,
      folderId,
      origin: 'edited',
      move: false, // keep the job output so «Скачать» still works afterwards
    });
    db.prepare('UPDATE edit_jobs SET saved_file_id = ? WHERE id = ?').run(row.id, job.id);
    res.json({ file: fileToJson(row), folderPath: folderPath(row.folder_id) });
  } catch (e) {
    log.error('save edited video failed', e);
    res.status(500).json({ message: 'Не получилось сохранить. Попробуйте ещё раз.' });
  }
});

/** Video files listing for the «Выбрать из Файлов» picker. */
videoRouter.get('/edit/pickable', (req, res) => {
  const folderId = req.query.folderId && req.query.folderId !== 'root' ? String(req.query.folderId) : null;
  const rows = db
    .prepare(
      `SELECT * FROM files WHERE kind = 'video' AND folder_id ${folderId ? '= ?' : 'IS NULL'} ORDER BY created_at DESC`
    )
    .all(...(folderId ? [folderId] : [])) as FileRow[];
  res.json({ files: rows.map(fileToJson) });
});
