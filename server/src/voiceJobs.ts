import fs from 'fs';
import path from 'path';
import { db } from './db';
import { DIRS } from './config';
import { id, now } from './util';
import { convertToWhisperWav } from './ffmpeg';
import { transcribe } from './whisper';
import { log } from './log';

export interface TranscriptionJobRow {
  id: string;
  state: 'running' | 'done' | 'error';
  progress: number;
  text: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: number;
}

/**
 * No fine-grained progress signal comes from faster-whisper without extra
 * plumbing — kept honest as 0 while running, 1 on done. Not a fake bar.
 */
export function startTranscriptionJob(uploadPath: string): TranscriptionJobRow {
  const jobId = id();
  db.prepare(
    `INSERT INTO transcription_jobs (id, state, progress, created_at) VALUES (?, 'running', 0, ?)`
  ).run(jobId, now());

  const wavPath = path.join(DIRS.voiceTmp, `${jobId}.wav`);

  void (async () => {
    const startedAt = Date.now();
    try {
      await convertToWhisperWav(uploadPath, wavPath);
      const text = await transcribe(fs.readFileSync(wavPath));
      db.prepare("UPDATE transcription_jobs SET state = 'done', progress = 1, text = ?, duration_ms = ? WHERE id = ?").run(
        text,
        Date.now() - startedAt,
        jobId
      );
      log.info(`transcription job ${jobId} done`);
    } catch (e) {
      log.error(`transcription job ${jobId} failed`, e);
      db.prepare("UPDATE transcription_jobs SET state = 'error', error = ? WHERE id = ?").run(
        e instanceof Error ? e.message : String(e),
        jobId
      );
    } finally {
      // Audio is never kept (8D) — this is the actual enforcement point, not just documentation.
      for (const p of [uploadPath, wavPath]) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) {
          log.warn(`voice temp cleanup failed for ${p}`, e);
        }
      }
    }
  })();

  return getTranscriptionJob(jobId)!;
}

export function getTranscriptionJob(jobId: string): TranscriptionJobRow | undefined {
  return db.prepare('SELECT * FROM transcription_jobs WHERE id = ?').get(jobId) as TranscriptionJobRow | undefined;
}
