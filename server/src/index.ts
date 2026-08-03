import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { PORT, WEB_DIST, ensureDirs } from './config';
import { migrate } from './db';
import { ensureAdminSecret, deviceAuth, adminAuth } from './auth';
import { initPush, vapidPublicKey, saveSubscription } from './push';
import { addSseClient } from './sse';
import { startScheduler } from './scheduler';
import { filesRouter } from './routes/files';
import { uploadsRouter } from './routes/uploads';
import { shareApiRouter, sharePublicRouter } from './routes/share';
import { videoRouter } from './routes/video';
import { remindersRouter } from './routes/reminders';
import { setupRouter } from './routes/setup';
import { adminRouter } from './routes/admin';
import { log } from './log';

ensureDirs();
migrate();
initPush();
const adminSecret = ensureAdminSecret();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // behind the Cloudflare Tunnel
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// ---- Public surface: share pages + provisioning + hidden dev entry ----
app.use(sharePublicRouter);
app.use(setupRouter);

// ---- Developer-only API (admin cookie) ----
app.use('/api/admin', adminAuth, adminRouter);

// ---- Her API (device cookie) ----
const api = express.Router();
api.get('/me', (req, res) => {
  res.json({ device: { id: req.device!.id, name: req.device!.name }, serverTime: Date.now() });
});
api.get('/events', (req, res) => addSseClient(req, res));
api.get('/push/key', (_req, res) => res.json({ key: vapidPublicKey() }));
api.post('/push/subscribe', (req, res) => {
  if (!req.body?.subscription) {
    res.status(400).json({ message: 'Нет подписки.' });
    return;
  }
  saveSubscription(req.device!.id, req.body.subscription);
  res.json({ ok: true });
});
api.use(filesRouter);
api.use(uploadsRouter);
api.use(shareApiRouter);
api.use(videoRouter);
api.use(remindersRouter);
app.use('/api', deviceAuth, api);

// ---- Static frontends (the three apps + root chooser + dev panel) ----
app.use(
  express.static(WEB_DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('sw.js') || filePath.endsWith('.html') || filePath.endsWith('.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// ---- Fallbacks: never a raw English error in front of her (P5) ----
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Не найдено.' });
});
app.use((req, res) => {
  const notFound = path.join(WEB_DIST, '404.html');
  if (req.method === 'GET' && fs.existsSync(notFound)) {
    res.status(404).sendFile(notFound);
  } else {
    res.status(404).type('text/plain; charset=utf-8').send('Страница не найдена');
  }
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error(`unhandled error on ${req.method} ${req.path}`, err);
  if (res.headersSent) return;
  if (req.path.startsWith('/api')) {
    res.status(500).json({ message: 'Произошла ошибка. Попробуйте ещё раз.' });
  } else {
    res.status(500).type('text/plain; charset=utf-8').send('Произошла ошибка. Попробуйте ещё раз.');
  }
});

startScheduler();

const server = app.listen(PORT, () => {
  log.info(`server listening on http://localhost:${PORT}`);
  log.info(`developer entry: http://localhost:${PORT}/dev?key=${adminSecret}`);
});
// Node's default requestTimeout (5 min) can abort large video uploads on a
// slow connection well before they finish; give uploads real headroom.
server.requestTimeout = 30 * 60 * 1000;
