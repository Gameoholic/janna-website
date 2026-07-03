/**
 * Generates the alarm sound (web/public/alarm.mp3) with ffmpeg: a loud,
 * classic two-tone beep pattern, 6 s, looped by the client while ringing.
 * Re-run with: npm run gen:alarm
 */
const { spawnSync } = require('child_process');
const path = require('path');

const out = path.join(__dirname, '..', 'web', 'public', 'alarm.mp3');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

// Alternating 880/990 Hz beeps: 0.3 s beep every 0.5 s, tone changes each second.
const expr = '0.85*sin(2*PI*(880+110*floor(mod(t\\,1)/0.5))*t)*lt(mod(t\\,0.5)\\,0.3)';

const result = spawnSync(
  ffmpeg,
  ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc=${expr}:s=44100:d=6`, '-ac', '1', '-b:a', '128k', out],
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('ffmpeg failed — is it installed and on PATH?');
  process.exit(1);
}
console.log('alarm sound written to', out);
