import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '..', '..');

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

export const WEB_DIST = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : path.join(ROOT, 'web', 'dist');

export const PORT = Number(process.env.PORT || 8077);

// Public origin used when composing absolute URLs (share links, setup links).
// Behind the Cloudflare Tunnel this should be e.g. https://example.com
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';

export const DIRS = {
  db: path.join(DATA_DIR, 'db'),
  media: path.join(DATA_DIR, 'media'),
  thumbs: path.join(DATA_DIR, 'thumbs'),
  editorSources: path.join(DATA_DIR, 'editor', 'sources'),
  editorOutputs: path.join(DATA_DIR, 'editor', 'outputs'),
  trash: path.join(DATA_DIR, 'trash'),
  logs: path.join(DATA_DIR, 'logs'),
  tmp: path.join(DATA_DIR, 'tmp'),
};

export function ensureDirs(): void {
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
}

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

// Timezone used for Russian-language date strings composed on the server
// (push notification bodies). Defaults to the server's local timezone.
export const TIMEZONE = process.env.TZ_NAME || Intl.DateTimeFormat().resolvedOptions().timeZone;
