import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { db } from '../db';
import { DATA_DIR, DIRS, UPDATER_TOKEN, UPDATER_URL } from '../config';
import { COOKIE_DEVICE, cookieOptions, createSetupCode, provisionDevice } from '../auth';
import { id, now } from '../util';
import { tailLog, log } from '../log';
import { getLeadTimes, setLeadTimes } from '../scheduler';
import { sseClientCount, broadcast } from '../sse';
import { originOf } from './share';
import { createDocument, saveDocumentContent } from './documents';
import { fileToJson } from './files';
import { importDocumentFile } from '../documentImport';

/** Filesystem-wide space on the volume backing DATA_DIR (the Pi's SD card/disk), not just her files. */
function diskUsage(dir: string): { total: number; free: number; used: number } {
  try {
    const st = fs.statfsSync(dir);
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    return { total, free, used: total - free };
  } catch {
    return { total: 0, free: 0, used: 0 };
  }
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return total;
}

export const adminRouter = Router();

adminRouter.get('/overview', (_req, res) => {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  res.json({
    devices: db.prepare('SELECT id, name, created_at, last_seen, push_json IS NOT NULL AS has_push FROM devices').all(),
    counts: {
      files: count('SELECT COUNT(*) n FROM files'),
      folders: count('SELECT COUNT(*) n FROM folders'),
      shares: count('SELECT COUNT(*) n FROM shares'),
      remindersScheduled: count("SELECT COUNT(*) n FROM reminders WHERE status IN ('scheduled','snoozed')"),
      remindersRinging: count("SELECT COUNT(*) n FROM reminders WHERE status = 'ringing'"),
      editJobs: count('SELECT COUNT(*) n FROM edit_jobs'),
    },
    storage: {
      media: dirSize(DIRS.media),
      thumbs: dirSize(DIRS.thumbs),
      editor: dirSize(path.join(DIRS.editorSources, '..')),
      trash: dirSize(DIRS.trash),
    },
    disk: diskUsage(DATA_DIR),
    sseClients: sseClientCount(),
    leadTimesMs: getLeadTimes(),
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
  });
});

adminRouter.post('/setup-codes', (req, res) => {
  const note = String(req.body?.note || '').trim().slice(0, 100);
  const code = createSetupCode(note);
  res.json({ code, url: `${originOf(req)}/setup/${code}` });
});

adminRouter.get('/setup-codes', (req, res) => {
  const rows = db.prepare('SELECT * FROM setup_codes ORDER BY created_at DESC LIMIT 50').all() as {
    code: string;
    note: string;
    created_at: number;
    used_at: number | null;
  }[];
  res.json({
    codes: rows.map((r) => ({
      code: r.code,
      note: r.note,
      createdAt: r.created_at,
      usedAt: r.used_at,
      url: `${originOf(req)}/setup/${r.code}`,
    })),
  });
});

adminRouter.delete('/setup-codes/:code', (req, res) => {
  db.prepare('DELETE FROM setup_codes WHERE code = ?').run(req.params.code);
  res.json({ ok: true });
});

/** Provision the developer's current browser as one of "her" devices (P11). */
adminRouter.post('/provision-self', (req, res) => {
  const name = String(req.body?.name || 'Developer').trim().slice(0, 100) || 'Developer';
  const { rawToken } = provisionDevice(name);
  res.cookie(COOKIE_DEVICE, rawToken, cookieOptions(req));
  res.json({ ok: true });
});

adminRouter.patch('/devices/:id', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  if (name) db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true });
});

adminRouter.delete('/devices/:id', (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

adminRouter.get('/shares', (req, res) => {
  const rows = db
    .prepare(
      'SELECT s.token, s.created_at, f.name, f.id AS file_id FROM shares s JOIN files f ON f.id = s.file_id ORDER BY s.created_at DESC'
    )
    .all() as { token: string; created_at: number; name: string; file_id: string }[];
  res.json({
    shares: rows.map((r) => ({
      token: r.token,
      fileId: r.file_id,
      fileName: r.name,
      createdAt: r.created_at,
      url: `${originOf(req)}/s/${r.token}`,
    })),
  });
});

adminRouter.delete('/shares/:token', (req, res) => {
  db.prepare('DELETE FROM shares WHERE token = ?').run(req.params.token);
  res.json({ ok: true });
});

adminRouter.get('/settings', (_req, res) => {
  res.json({ leadTimesMs: getLeadTimes() });
});

adminRouter.put('/settings', (req, res) => {
  const leads = Array.isArray(req.body?.leadTimesMs)
    ? (req.body.leadTimesMs as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : null;
  if (!leads) {
    res.status(400).json({ error: 'leadTimesMs must be an array of positive ms values' });
    return;
  }
  setLeadTimes(leads);
  res.json({ leadTimesMs: getLeadTimes() });
});

adminRouter.get('/logs', (req, res) => {
  const lines = Math.min(5000, Math.max(10, Number(req.query.lines || 500)));
  res.type('text/plain').send(tailLog(lines));
});

/** Fire a real alarm in N seconds to test the whole chain end to end. */
adminRouter.post('/test-alarm', (req, res) => {
  const text = String(req.body?.text || 'Проверка будильника').trim().slice(0, 200);
  const delaySec = Math.min(3600, Math.max(1, Number(req.body?.delaySec || 5)));
  const remId = id();
  db.prepare('INSERT INTO reminders (id, text, due_at, created_at) VALUES (?, ?, ?, ?)').run(
    remId,
    text,
    now() + delaySec * 1000,
    now()
  );
  broadcast('reminders-changed', { id: remId });
  res.json({ ok: true, id: remId, firesInSec: delaySec });
});

adminRouter.get('/edits', (_req, res) => {
  const sessions = db
    .prepare('SELECT id, source_name, source_file_id, duration_ms, created_at FROM edit_sessions ORDER BY created_at DESC LIMIT 100')
    .all();
  const jobs = db
    .prepare('SELECT id, session_id, state, output_name, duration_ms, saved_file_id, created_at FROM edit_jobs ORDER BY created_at DESC LIMIT 100')
    .all();
  res.json({ sessions, jobs });
});

/**
 * Editor housekeeping is manual and admin-only — nothing in her flows
 * auto-deletes (P10). Moves old editor binaries to trash.
 */
adminRouter.post('/edits/cleanup', (req, res) => {
  const olderThanDays = Math.max(0, Number(req.body?.olderThanDays ?? 7));
  const cutoff = now() - olderThanDays * 24 * 3600 * 1000;
  const oldSessions = db.prepare('SELECT * FROM edit_sessions WHERE created_at < ?').all(cutoff) as {
    id: string;
    source_path: string;
    source_file_id: string | null;
  }[];
  let moved = 0;
  for (const s of oldSessions) {
    const jobs = db.prepare('SELECT * FROM edit_jobs WHERE session_id = ?').all(s.id) as {
      output_path: string | null;
    }[];
    for (const j of jobs) {
      if (j.output_path && fs.existsSync(j.output_path)) {
        try {
          fs.renameSync(j.output_path, path.join(DIRS.trash, `edit-${path.basename(j.output_path)}`));
          moved++;
        } catch (e) { log.warn('cleanup move failed', e); }
      }
    }
    // Uploaded sources belong to the editor; files picked from Файлы are HER
    // originals and are never touched.
    if (!s.source_file_id && fs.existsSync(s.source_path)) {
      try {
        fs.renameSync(s.source_path, path.join(DIRS.trash, `src-${path.basename(s.source_path)}`));
        moved++;
      } catch (e) { log.warn('cleanup move failed', e); }
    }
    db.prepare('DELETE FROM edit_sessions WHERE id = ?').run(s.id); // jobs cascade
  }
  res.json({ ok: true, sessionsRemoved: oldSessions.length, binariesToTrash: moved });
});

adminRouter.post('/trash/empty', (_req, res) => {
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(DIRS.trash)) {
      fs.rmSync(path.join(DIRS.trash, entry), { recursive: true, force: true });
      removed++;
    }
  } catch (e) {
    log.warn('trash empty failed', e);
  }
  log.info(`trash emptied (${removed} entries)`);
  res.json({ ok: true, removed });
});

/**
 * One-time migration of her old Google Docs (P11 — dev-only, English is
 * fine). Export from Google Docs as File → Download → "Web page (.html,
 * zipped)" to keep bold/colored text and images; plain .html/.txt/.md also
 * work with reduced fidelity. Only bold, one text color, and images survive —
 * everything else (headings, lists, tables, links) is flattened to plain
 * paragraphs, by design (see documentImport.ts).
 */
adminRouter.get('/folders', (_req, res) => {
  const rows = db.prepare('SELECT id, name FROM folders ORDER BY name COLLATE NOCASE').all() as { id: string; name: string }[];
  res.json({ folders: rows });
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

adminRouter.post('/documents/import', importUpload.single('file'), async (req, res) => {
  const folderId = String(req.body?.folderId || '');
  if (!folderId || !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(folderId)) {
    res.status(400).json({ message: 'Choose a valid folder.' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ message: 'No file uploaded.' });
    return;
  }
  try {
    const result = await importDocumentFile({ buffer: req.file.buffer, originalName: req.file.originalname });
    const requestedName = String(req.body?.name || '').trim();
    const fallbackName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const row = createDocument(folderId, requestedName || fallbackName || 'Imported document');
    const updated = saveDocumentContent(row, result.html);
    log.info(`document imported: ${updated.name} (${result.warnings.length} warning(s))`);
    res.json({ file: fileToJson(updated), warnings: result.warnings });
  } catch (e) {
    log.error('document import failed', e);
    res.status(500).json({ message: e instanceof Error ? e.message : 'Import failed.' });
  }
});

/**
 * "Deploy from GitHub" — proxies to the updater sidecar (deploy/updater/),
 * which is the only thing with Docker-socket + repo access. UPDATER_URL is
 * blank whenever that sidecar isn't set up, in which case the panel just
 * hides the feature.
 */
function updaterFetch(urlPath: string, init?: RequestInit): Promise<Response> {
  return fetch(`${UPDATER_URL}${urlPath}`, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), 'X-Updater-Token': UPDATER_TOKEN },
  });
}

adminRouter.get('/deploy/status', async (_req, res) => {
  if (!UPDATER_URL) {
    res.json({ available: false });
    return;
  }
  try {
    const r = await updaterFetch('/status');
    const data = (await r.json()) as Record<string, unknown>;
    res.status(r.status).json({ available: true, ...data });
  } catch (e) {
    res.status(502).json({ available: true, error: 'unreachable', message: e instanceof Error ? e.message : String(e) });
  }
});

adminRouter.post('/deploy/update', async (_req, res) => {
  if (!UPDATER_URL) {
    res.status(400).json({ error: 'not-configured', message: 'Updater sidecar is not configured.' });
    return;
  }
  try {
    const r = await updaterFetch('/update', { method: 'POST' });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'unreachable', message: e instanceof Error ? e.message : String(e) });
  }
});

adminRouter.get('/deploy/update/current', async (_req, res) => {
  if (!UPDATER_URL) {
    res.json({ status: 'idle', log: '', startedAt: null, finishedAt: null });
    return;
  }
  try {
    const r = await updaterFetch('/update/current');
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ status: 'error', log: e instanceof Error ? e.message : String(e), startedAt: null, finishedAt: null });
  }
});
