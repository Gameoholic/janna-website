import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { PYTHON, WHISPER_SERVICE_URL, WHISPER_SERVICE_PORT, WHISPER_DEFAULT_MODEL, DIRS } from './config';
import { getSetting, setSetting } from './db';
import { log } from './log';

const SERVICE_SCRIPT = path.join(__dirname, '..', 'whisper_service.py');
const ALLOWED_MODELS = ['tiny', 'base', 'small', 'medium'];

let child: ChildProcess | null = null;
let starting = false;

function currentModel(): string {
  const saved = getSetting('whisper_model');
  return saved && ALLOWED_MODELS.includes(saved) ? saved : WHISPER_DEFAULT_MODEL;
}

/** Spawns the warm faster-whisper process once at server boot; respawns with backoff if it dies. */
export function ensureWhisperService(): void {
  if (child || starting) return;
  starting = true;
  log.info(`starting whisper service (model=${currentModel()})`);
  child = spawn(PYTHON, [SERVICE_SCRIPT], {
    windowsHide: true,
    env: {
      ...process.env,
      WHISPER_SERVICE_PORT: String(WHISPER_SERVICE_PORT),
      WHISPER_DEFAULT_MODEL: currentModel(),
      WHISPER_CACHE_DIR: DIRS.whisperCache,
    },
  });
  starting = false;
  child.stdout?.on('data', (d) => log.info(`[whisper] ${d.toString().trim()}`));
  child.stderr?.on('data', (d) => log.warn(`[whisper] ${d.toString().trim()}`));
  child.on('error', (e) => log.error('whisper service failed to start', e));
  child.on('exit', (code) => {
    log.warn(`whisper service exited (code=${code}), respawning in 3s`);
    child = null;
    setTimeout(ensureWhisperService, 3000);
  });
}

/** Sends 16kHz mono WAV bytes to the local warm service, forcing Russian (P5 — this feature is Russian-only). */
export async function transcribe(wavBuffer: Buffer): Promise<string> {
  const res = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
    method: 'POST',
    body: new Uint8Array(wavBuffer),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`whisper service transcribe failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

/**
 * Swaps the live model without a container restart. Only persists the new
 * setting once the Python side confirms it actually loaded — a bad model
 * name shouldn't silently "stick" (admin-only, dev panel — see 8D).
 */
export async function reloadModel(model: string): Promise<void> {
  if (!ALLOWED_MODELS.includes(model)) {
    throw new Error(`unknown model "${model}"`);
  }
  const res = await fetch(`${WHISPER_SERVICE_URL}/reload?model=${encodeURIComponent(model)}`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`model reload failed (${res.status}): ${body.slice(0, 300)}`);
  }
  setSetting('whisper_model', model);
}
