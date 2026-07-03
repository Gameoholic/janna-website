import path from 'path';
import fs from 'fs';
import { db } from './db';
import { DIRS } from './config';
import { id, now } from './util';
import { EditParams, expectedOutputMs, probe, runEdit } from './ffmpeg';
import { log } from './log';

export interface EditSessionRow {
  id: string;
  source_path: string;
  source_name: string;
  source_file_id: string | null;
  duration_ms: number;
  width: number | null;
  height: number | null;
  has_audio: number;
  created_at: number;
}

export interface EditJobRow {
  id: string;
  session_id: string;
  params_json: string;
  state: 'running' | 'done' | 'error';
  progress: number;
  output_path: string | null;
  output_name: string;
  duration_ms: number | null;
  error: string | null;
  saved_file_id: string | null;
  created_at: number;
}

const liveProgress = new Map<string, number>();

function outputNameFor(sourceName: string): string {
  const base = sourceName.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  return `${base} (новое).mp4`;
}

export function startEditJob(session: EditSessionRow, params: EditParams): EditJobRow {
  const jobId = id();
  const outputName = outputNameFor(session.source_name);
  const outputPath = path.join(DIRS.editorOutputs, `${jobId}.mp4`);
  db.prepare(
    `INSERT INTO edit_jobs (id, session_id, params_json, state, progress, output_path, output_name, created_at)
     VALUES (?, ?, ?, 'running', 0, ?, ?, ?)`
  ).run(jobId, session.id, JSON.stringify(params), outputPath, outputName, now());
  liveProgress.set(jobId, 0);

  void (async () => {
    try {
      if (!fs.existsSync(session.source_path)) {
        throw new Error('source file is gone');
      }
      await runEdit(
        session.source_path,
        outputPath,
        session.has_audio === 1,
        session.duration_ms,
        params,
        (fraction) => liveProgress.set(jobId, fraction)
      );
      let durationMs = expectedOutputMs(session.duration_ms, params);
      try {
        durationMs = (await probe(outputPath)).durationMs || durationMs;
      } catch { /* estimate is fine for display */ }
      db.prepare("UPDATE edit_jobs SET state = 'done', progress = 1, duration_ms = ? WHERE id = ?").run(
        durationMs,
        jobId
      );
      log.info(`edit job ${jobId} done (${durationMs} ms)`);
    } catch (e) {
      log.error(`edit job ${jobId} failed`, e);
      db.prepare("UPDATE edit_jobs SET state = 'error', error = ? WHERE id = ?").run(
        e instanceof Error ? e.message : String(e),
        jobId
      );
    } finally {
      liveProgress.delete(jobId);
    }
  })();

  return getJob(jobId)!;
}

export function getJob(jobId: string): EditJobRow | undefined {
  const row = db.prepare('SELECT * FROM edit_jobs WHERE id = ?').get(jobId) as EditJobRow | undefined;
  if (row && row.state === 'running' && liveProgress.has(row.id)) {
    row.progress = liveProgress.get(row.id)!;
  }
  return row;
}

export function getSession(sessionId: string): EditSessionRow | undefined {
  return db.prepare('SELECT * FROM edit_sessions WHERE id = ?').get(sessionId) as EditSessionRow | undefined;
}
