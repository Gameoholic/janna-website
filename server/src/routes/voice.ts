import { Router } from 'express';
import multer from 'multer';
import { DIRS } from '../config';
import { id } from '../util';
import { startTranscriptionJob, getTranscriptionJob, TranscriptionJobRow } from '../voiceJobs';
import { log } from '../log';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DIRS.voiceTmp),
    filename: (_req, _file, cb) => cb(null, `rec-${id()}`),
  }),
  // Generous for 1-5 minutes of opus-encoded speech.
  limits: { fileSize: 50 * 1024 * 1024 },
});

function jobToJson(job: TranscriptionJobRow) {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    text: job.text,
    error: job.error,
    durationMs: job.duration_ms,
  };
}

export const voiceRouter = Router();

/** She stops recording — upload the clip and kick off local transcription. */
voiceRouter.post('/voice/jobs', upload.single('file'), (req, res) => {
  const f = req.file;
  if (!f) {
    res.status(400).json({ message: 'Запись не получена.' });
    return;
  }
  try {
    const job = startTranscriptionJob(f.path);
    res.json({ job: jobToJson(job) });
  } catch (e) {
    log.error('voice job start failed', e);
    res.status(500).json({ message: 'Не получилось распознать речь. Попробуйте ещё раз.' });
  }
});

voiceRouter.get('/voice/jobs/:id', (req, res) => {
  const job = getTranscriptionJob(req.params.id);
  if (!job) {
    res.status(404).json({ message: 'Задание не найдено.' });
    return;
  }
  res.json({ job: jobToJson(job) });
});
