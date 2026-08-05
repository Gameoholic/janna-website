import { Router, Request, Response } from 'express';
import fs from 'fs';
import { db } from '../db';
import { PUBLIC_ORIGIN } from '../config';
import { token, now } from '../util';
import { FileRow } from './files';
import { sanitizeDocumentHtml } from './documents';

/** First embedded base64 image in a document's HTML, if any — used as the og:image preview. */
const EMBEDDED_IMAGE = /<img[^>]+src="data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)"/;

function documentEmbeddedImage(html: string): { mime: string; buffer: Buffer } | null {
  const m = EMBEDDED_IMAGE.exec(html);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

function readDocumentHtml(file: FileRow): string {
  try {
    return sanitizeDocumentHtml(fs.readFileSync(file.path, 'utf8'));
  } catch {
    return '';
  }
}

/**
 * Permanent, isolated, per-file links (Section 7). A token maps to exactly
 * one file; the public page exposes nothing else — no folders, no app, no
 * traversal. Deleting the file cascades the token away, killing the link.
 */

export function originOf(req: Request): string {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  return `${proto}://${req.headers.host}`;
}

export function shareUrlFor(req: Request, shareToken: string): string {
  return `${originOf(req)}/s/${shareToken}`;
}

/** Authenticated side: create / reveal / revoke the file's permanent link. */
export const shareApiRouter = Router();

shareApiRouter.post('/files/:id/share', (req, res) => {
  const file = db.prepare('SELECT id FROM files WHERE id = ?').get(req.params.id) as { id: string } | undefined;
  if (!file) {
    res.status(404).json({ message: 'Файл не найден.' });
    return;
  }
  let row = db.prepare('SELECT token FROM shares WHERE file_id = ?').get(file.id) as
    | { token: string }
    | undefined;
  if (!row) {
    row = { token: token() };
    db.prepare('INSERT INTO shares (token, file_id, created_at) VALUES (?, ?, ?)').run(row.token, file.id, now());
  }
  res.json({ token: row.token, url: shareUrlFor(req, row.token) });
});

shareApiRouter.delete('/files/:id/share', (req, res) => {
  db.prepare('DELETE FROM shares WHERE file_id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** Public side. */
export const sharePublicRouter = Router();

function fileForToken(shareToken: string): FileRow | undefined {
  return db
    .prepare('SELECT f.* FROM shares s JOIN files f ON f.id = s.file_id WHERE s.token = ?')
    .get(shareToken) as FileRow | undefined;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Ссылка не работает</title>
<style>html{-webkit-text-size-adjust:100%;-moz-text-size-adjust:100%;text-size-adjust:100%}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#faf7f2;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-size:26px}</style>
</head><body><div><h1>Эта ссылка больше не работает</h1><p style="font-size:19px">Файл был удалён, или ссылка устарела.</p></div></body></html>`;

sharePublicRouter.get('/s/:token', (req, res) => {
  const file = fileForToken(req.params.token);
  if (!file) {
    res.status(404).type('html').send(NOT_FOUND_PAGE);
    return;
  }
  const base = `${originOf(req)}/s/${esc(req.params.token)}`;
  const name = esc(file.name);
  const isDoc = file.kind === 'document';
  const docHtml = isDoc ? readDocumentHtml(file) : '';
  const hasThumb = !!file.thumb_path && fs.existsSync(file.thumb_path);
  const hasDocImage = isDoc && !!documentEmbeddedImage(docHtml);
  const ogImage = hasThumb || hasDocImage ? `${base}/thumb` : '';

  let media = '';
  if (file.kind === 'video') {
    media = `<video controls playsinline preload="metadata" ${hasThumb ? `poster="${base}/thumb"` : ''} src="${base}/media"></video>`;
  } else if (file.kind === 'image') {
    media = `<img src="${base}/media" alt="${name}">`;
  } else if (file.kind === 'audio') {
    media = `<div class="audio-wrap"><div class="audio-icon">♫</div><audio controls preload="metadata" src="${base}/media"></audio></div>`;
  } else if (isDoc) {
    // Already sanitized on save (and again here, defensively, since this is
    // a public page) — a narrow bold/color/image allowlist, never arbitrary
    // markup (see routes/documents.ts).
    media = `<div class="doc-content">${docHtml || '<span style="color:#9ca3af">(пусто)</span>'}</div>`;
  } else {
    media = `<div class="audio-wrap"><div class="audio-icon">📄</div></div>`;
  }

  const ogType = file.kind === 'video' ? 'video.other' : file.kind === 'audio' ? 'music.song' : isDoc ? 'article' : 'website';
  // WhatsApp shows thumbnail + title from these tags; tapping opens this
  // clean player. True in-bubble playback is not possible for a custom
  // domain — an honest platform limit (Section 7).
  const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${name}</title>
<meta property="og:title" content="${name}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${base}">
${ogImage ? `<meta property="og:image" content="${ogImage}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${ogImage}">` : ''}
${file.kind === 'video' ? `<meta property="og:video" content="${base}/media">\n<meta property="og:video:type" content="${esc(file.mime)}">` : ''}
<meta name="twitter:title" content="${name}">
<style>
  html{-webkit-text-size-adjust:100%;-moz-text-size-adjust:100%;text-size-adjust:100%}
  html,body{margin:0;min-height:100%}
  body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:${isDoc ? '#efe9da' : '#111827'};color:${isDoc ? '#1f2937' : '#f9fafb'};display:flex;flex-direction:column;align-items:center;justify-content:${isDoc ? 'flex-start' : 'center'};padding:16px;box-sizing:border-box;min-height:100vh}
  .card{width:100%;max-width:900px;text-align:center}
  video,img{max-width:100%;max-height:78vh;border-radius:12px;background:#000;display:block;margin:0 auto}
  audio{width:100%;max-width:480px;margin-top:16px}
  h1{font-size:20px;font-weight:600;margin:16px 8px;word-break:break-word}
  .audio-wrap{padding:32px 16px}
  .audio-icon{font-size:72px;line-height:1}
  .doc-content{background:#fff;color:#1f2937;text-align:left;padding:20px;border-radius:12px;line-height:1.5;font-size:17px;word-break:break-word;box-shadow:0 3px 14px rgba(29,36,48,0.18)}
  .doc-content img{max-width:100%;border-radius:8px;display:block;margin:8px 0}
  a.dl{display:inline-block;margin-top:12px;padding:14px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:12px;font-size:18px}
</style>
</head><body>
<div class="card">
  ${media}
  <h1>${name}</h1>
  <a class="dl" href="${base}/download">Скачать</a>
</div>
</body></html>`;
  res.type('html').send(html);
});

function streamShared(req: Request, res: Response, download: boolean): void {
  const file = fileForToken(req.params.token);
  if (!file || !fs.existsSync(file.path)) {
    res.status(404).type('html').send(NOT_FOUND_PAGE);
    return;
  }
  if (download) {
    const downloadName = file.kind === 'document' && !file.name.toLowerCase().endsWith('.html') ? `${file.name}.html` : file.name;
    res.download(file.path, downloadName);
  } else {
    res.sendFile(file.path, {
      headers: { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=3600' },
      acceptRanges: true,
    });
  }
}

sharePublicRouter.get('/s/:token/media', (req, res) => streamShared(req, res, false));
sharePublicRouter.get('/s/:token/download', (req, res) => streamShared(req, res, true));

sharePublicRouter.get('/s/:token/thumb', (req, res) => {
  const file = fileForToken(req.params.token);
  if (!file) {
    res.status(404).end();
    return;
  }
  if (file.thumb_path && fs.existsSync(file.thumb_path)) {
    res.sendFile(file.thumb_path, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    return;
  }
  if (file.kind === 'document') {
    const embedded = documentEmbeddedImage(readDocumentHtml(file));
    if (embedded) {
      res.type(embedded.mime).set('Cache-Control', 'public, max-age=86400').send(embedded.buffer);
      return;
    }
  }
  res.status(404).end();
});
