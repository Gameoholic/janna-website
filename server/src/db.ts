import Database from 'better-sqlite3';
import path from 'path';
import { DIRS, ensureDirs } from './config';

ensureDirs();

export const db = new Database(path.join(DIRS.db, 'janna.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER,
    push_json TEXT
  );
  CREATE TABLE setup_codes (
    code TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,             -- video | image | audio | other
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,             -- absolute path of the binary on disk
    thumb_path TEXT,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    origin TEXT NOT NULL DEFAULT 'upload',  -- upload | edited | created
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_files_folder ON files(folder_id);
  CREATE TABLE shares (
    token TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_shares_file ON shares(file_id);
  CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | ringing | snoozed | done
    snooze_until INTEGER,
    snooze_used INTEGER NOT NULL DEFAULT 0,
    dismissed_at INTEGER
  );
  CREATE INDEX idx_reminders_due ON reminders(status, due_at);
  CREATE TABLE lead_sent (
    reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    lead_ms INTEGER NOT NULL,
    PRIMARY KEY (reminder_id, lead_ms)
  );
  CREATE TABLE edit_sessions (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_file_id TEXT,            -- set when picked from Файлы
    duration_ms INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    has_audio INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE edit_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES edit_sessions(id) ON DELETE CASCADE,
    params_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'running', -- running | done | error
    progress REAL NOT NULL DEFAULT 0,
    output_path TEXT,
    output_name TEXT NOT NULL,
    duration_ms INTEGER,
    error TEXT,
    saved_file_id TEXT,
    created_at INTEGER NOT NULL
  );
  `,
  // Folders are flat now (no nesting, see master-prompt 8B changelog) — drop
  // the now-unused parent_id column.
  `
  ALTER TABLE folders DROP COLUMN parent_id;
  `,
  // A dismissed reminder is deleted, not kept around marked "done" — drop the
  // now-unused column.
  `
  ALTER TABLE reminders DROP COLUMN dismissed_at;
  `,
  // Simple documents/notes (kind = 'document') get a cached plain-text
  // preview for the file grid — see routes/documents.ts.
  `
  ALTER TABLE files ADD COLUMN snippet TEXT;
  `,
  // Голос (voice-to-text, master-prompt 8D). No session table — unlike video
  // edits there's no multi-step wizard state, a job starts as soon as she
  // stops recording. Audio itself is never kept; only the resulting text.
  `
  CREATE TABLE transcription_jobs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'running', -- running | done | error
    progress REAL NOT NULL DEFAULT 0,
    text TEXT,
    error TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  );
  `,
];

export function migrate(): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
