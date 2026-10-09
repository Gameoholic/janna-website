import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import sanitizeHtml from 'sanitize-html';
import { db } from '../db';
import { DIRS } from '../config';
import { id, now } from '../util';
import { log } from '../log';
import { FileRow, fileToJson, uniqueNameInFolder } from './files';

/**
 * Documents (kind = 'document'): a Google-Docs lookalike — her old habit —
 * with only the basic toolbar (paragraph style, font size, bold / italic /
 * underline, text + highlight color, alignment, lists, pasted images). The
 * "binary on disk" for a document is one sanitized HTML file; pasted images
 * are embedded inline as base64 data URIs, so the file stays fully
 * self-contained (no separate asset table, nothing to garbage collect when
 * the document is deleted).
 *
 * The allowlist below must only ever admit what that toolbar itself
 * produces, never arbitrary pasted-in markup. That's what keeps this safe to
 * also re-render on the public share page (see routes/share.ts).
 */

const ALLOWED_IMAGE_SRC = /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;
const COLOR = [
  /^#(?:[0-9a-f]{3}){1,2}$/i,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)$/i,
  /^transparent$/i,
];
const BLOCK_ATTRS = ['style', { name: 'align', multiple: false, values: ['left', 'center', 'right', 'justify'] }];

export function sanitizeDocumentHtml(raw: string): string {
  return sanitizeHtml(raw || '', {
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 'span', 'div', 'p', 'br', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3'],
    allowedAttributes: {
      span: ['style'],
      div: BLOCK_ATTRS,
      p: BLOCK_ATTRS,
      h1: BLOCK_ATTRS,
      h2: BLOCK_ATTRS,
      h3: BLOCK_ATTRS,
      li: BLOCK_ATTRS,
      img: ['src', 'style'],
    },
    allowedStyles: {
      '*': {
        color: COLOR,
        'background-color': COLOR,
        'font-size': [/^\d{1,3}(?:\.\d+)?(?:pt|px)$/],
        'text-align': [/^(?:left|center|right|justify|start|end)$/],
      },
      img: { width: [/^\d{1,4}(?:\.\d+)?px$/] },
    },
    allowedSchemesByTag: { img: ['data'] },
    transformTags: {
      strong: 'b',
      em: 'i',
      // execCommand('foreColor') produces <font color="…">, and the editor's
      // font-size tool leaves <font style="font-size:…"> — fold both into a
      // <span style="…"> so one allowlist covers them.
      font: (_tag, attribs) => ({
        tagName: 'span',
        attribs: { style: [attribs.color ? `color:${attribs.color}` : '', attribs.style || ''].filter(Boolean).join(';') },
      }),
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !ALLOWED_IMAGE_SRC.test(frame.attribs.src || ''),
  });
}

/** Plain-text preview for the file grid — strip everything, collapse whitespace. */
export function snippetOf(html: string): string {
  const text = sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} });
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function createDocument(folderId: string, name: string): FileRow {
  const fileId = id();
  const filePath = path.join(DIRS.media, `${fileId}.html`);
  fs.writeFileSync(filePath, '', 'utf8');
  const finalName = uniqueNameInFolder(name, folderId);
  db.prepare(
    `INSERT INTO files (id, folder_id, name, kind, mime, size, path, origin, created_at, snippet)
     VALUES (?, ?, ?, 'document', 'text/html', 0, ?, 'created', ?, '')`
  ).run(fileId, folderId, finalName, filePath, now());
  return db.prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL').get(fileId) as FileRow;
}

/** Sanitizes, writes to disk, and refreshes the cached size + snippet. */
export function saveDocumentContent(row: FileRow, rawHtml: string): FileRow {
  const html = sanitizeDocumentHtml(rawHtml);
  fs.writeFileSync(row.path, html, 'utf8');
  const size = fs.statSync(row.path).size;
  const snippet = snippetOf(html);
  db.prepare('UPDATE files SET size = ?, snippet = ? WHERE id = ?').run(size, snippet, row.id);
  return db.prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL').get(row.id) as FileRow;
}

export const documentsRouter = Router();

documentsRouter.post('/folders/:folderId/documents', (req, res) => {
  const folderId = req.params.folderId;
  if (!db.prepare('SELECT 1 FROM folders WHERE id = ? AND deleted_at IS NULL').get(folderId)) {
    res.status(404).json({ message: 'Папка не найдена.' });
    return;
  }
  const row = createDocument(folderId, 'Новый документ');
  log.info(`document created: ${row.name}`);
  res.json(fileToJson(row));
});

function findDocument(fileId: string): FileRow | undefined {
  return db.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL AND kind = 'document'").get(fileId) as FileRow | undefined;
}

documentsRouter.get('/documents/:id', (req, res) => {
  const row = findDocument(req.params.id);
  if (!row) {
    res.status(404).json({ message: 'Документ не найден.' });
    return;
  }
  let html = '';
  try {
    html = fs.readFileSync(row.path, 'utf8');
  } catch { /* missing on disk — treat as empty rather than failing her open */ }
  res.json({ html });
});

documentsRouter.put('/documents/:id', (req, res) => {
  const row = findDocument(req.params.id);
  if (!row) {
    res.status(404).json({ message: 'Документ не найден.' });
    return;
  }
  const updated = saveDocumentContent(row, String(req.body?.html ?? ''));
  res.json({ file: fileToJson(updated) });
});
