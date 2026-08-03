import express, { Router } from 'express';
import { CHUNK_SIZE, initUpload, writeChunk, abortUpload } from '../chunkedUpload';

export const uploadsRouter = Router();

/** Step 1: she (well, her browser) declares a large file; gets back chunk boundaries. */
uploadsRouter.post('/uploads/init', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 200);
  const size = Number(req.body?.size);
  if (!name || !Number.isFinite(size) || size <= 0) {
    res.status(400).json({ message: 'Некорректный файл.' });
    return;
  }
  res.json(initUpload(name, size));
});

/** Step 2, repeated per chunk: raw bytes, not multipart — kept far under Cloudflare's cap. */
uploadsRouter.post(
  '/uploads/:id/chunk/:index',
  express.raw({ type: 'application/octet-stream', limit: CHUNK_SIZE + 1024 * 1024 }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ message: 'Пустая часть файла.' });
      return;
    }
    try {
      writeChunk(req.params.id, Number(req.params.index), req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: e instanceof Error ? e.message : 'Не получилось загрузить часть файла.' });
    }
  }
);

/** She cancelled mid-upload — clean up the partial chunks right away. */
uploadsRouter.post('/uploads/:id/abort', (req, res) => {
  abortUpload(req.params.id);
  res.json({ ok: true });
});
