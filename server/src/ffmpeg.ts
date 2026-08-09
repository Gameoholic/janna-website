import { spawn } from 'child_process';
import { FFMPEG, FFPROBE } from './config';
import { log } from './log';

export interface ProbeInfo {
  durationMs: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

export function run(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function probe(file: string): Promise<ProbeInfo> {
  const { code, stdout, stderr } = await run(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed (${code}): ${stderr.slice(0, 500)}`);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
  };
  const streams = data.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  let durationSec = Number(data.format?.duration || 0);
  if (!durationSec && video?.duration) durationSec = Number(video.duration);
  return {
    durationMs: Math.round(durationSec * 1000),
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: !!audio,
    hasVideo: !!video,
  };
}

/** Poster frame for a video, downscaled. Never upscales. */
export async function makeVideoThumb(input: string, output: string, atMs: number): Promise<void> {
  const at = Math.max(0, atMs / 1000).toFixed(3);
  const { code, stderr } = await run(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-ss', at,
    '-i', input,
    '-frames:v', '1',
    '-vf', "scale='min(480,iw)':-2",
    '-q:v', '4',
    output,
  ]);
  if (code !== 0) throw new Error(`thumbnail failed: ${stderr.slice(0, 500)}`);
}

export async function makeImageThumb(input: string, output: string): Promise<void> {
  const { code, stderr } = await run(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-i', input,
    '-frames:v', '1',
    '-vf', "scale='min(480,iw)':-2",
    '-q:v', '4',
    output,
  ]);
  if (code !== 0) throw new Error(`image thumbnail failed: ${stderr.slice(0, 500)}`);
}

/** Downscales + re-encodes an image as JPEG — used to keep imported/embedded document photos compact. Never upscales. */
export async function resizeImageToJpeg(input: string, output: string, maxDim: number, quality: number): Promise<void> {
  const { code, stderr } = await run(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-i', input,
    '-frames:v', '1',
    '-vf', `scale='min(${maxDim},iw)':-2`,
    '-q:v', String(quality),
    output,
  ]);
  if (code !== 0) throw new Error(`image resize failed: ${stderr.slice(0, 500)}`);
}

/** Голос (8D): normalizes whatever MediaRecorder produced (typically webm/opus) into the 16kHz mono PCM WAV faster-whisper wants. */
export async function convertToWhisperWav(input: string, output: string): Promise<void> {
  const { code, stderr } = await run(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-i', input,
    '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
    output,
  ]);
  if (code !== 0) throw new Error(`audio conversion failed: ${stderr.slice(0, 500)}`);
}

export interface Segment {
  startMs: number;
  endMs: number;
}

export interface EditParams {
  /** Parts of the source to KEEP, in order — her mental model (8A). */
  segments: Segment[];
  /** 0.6 | 0.7 | 0.8 | 0.9 | 1 — pitch is preserved via atempo. */
  speed: number;
}

/**
 * Multi-segment keep + jumpcut + optional slow-down in a single
 * filter_complex pass (no temp files, no concat artifacts). The original
 * file is only ever read (P10).
 */
export function buildEditArgs(
  input: string,
  output: string,
  hasAudio: boolean,
  params: EditParams
): string[] {
  const { segments, speed } = params;
  const filters: string[] = [];
  let vLabel: string;
  let aLabel: string;

  if (segments.length > 0) {
    segments.forEach((seg, i) => {
      const a = (seg.startMs / 1000).toFixed(3);
      const b = (seg.endMs / 1000).toFixed(3);
      filters.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
      if (hasAudio) filters.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
    });
    const inputs = segments.map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
    filters.push(`${inputs}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}${hasAudio ? '[vc][ac]' : '[vc]'}`);
    vLabel = '[vc]';
    aLabel = '[ac]';
  } else {
    filters.push('[0:v]null[vc]');
    vLabel = '[vc]';
    if (hasAudio) {
      filters.push('[0:a]anull[ac]');
    }
    aLabel = '[ac]';
  }

  if (speed !== 1) {
    filters.push(`${vLabel}setpts=PTS/${speed}[vs]`);
    vLabel = '[vs]';
    if (hasAudio) {
      // atempo changes tempo without changing pitch — no chipmunk audio.
      filters.push(`${aLabel}atempo=${speed}[as]`);
      aLabel = '[as]';
    }
  }

  const args = [
    '-y', '-loglevel', 'error',
    '-i', input,
    '-filter_complex', filters.join(';'),
    '-map', vLabel,
  ];
  if (hasAudio) args.push('-map', aLabel);
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p'
  );
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '160k');
  // faststart → plays immediately when re-shared through WhatsApp.
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
  return args;
}

export function expectedOutputMs(sourceMs: number, params: EditParams): number {
  const kept = params.segments.length
    ? params.segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0)
    : sourceMs;
  return Math.round(kept / params.speed);
}

export function runEdit(
  input: string,
  output: string,
  hasAudio: boolean,
  sourceMs: number,
  params: EditParams,
  onProgress: (fraction: number) => void
): Promise<void> {
  const args = buildEditArgs(input, output, hasAudio, params);
  const expected = expectedOutputMs(sourceMs, params);
  log.info(`ffmpeg edit: ${FFMPEG} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { windowsHide: true });
    let stderr = '';
    let buffer = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.stdout.on('data', (d) => {
      buffer += d.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line.trim());
        if (m && expected > 0) {
          const doneMs = Number(m[1]) / 1000;
          onProgress(Math.max(0, Math.min(0.99, doneMs / expected)));
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-800)}`));
      }
    });
  });
}
