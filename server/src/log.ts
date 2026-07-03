import fs from 'fs';
import path from 'path';
import { DIRS } from './config';

const LOG_FILE = () => path.join(DIRS.logs, 'app.log');
const MAX_BYTES = 5 * 1024 * 1024;

function write(level: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra !== undefined ? ' ' + safeJson(extra) : ''}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try {
    const file = LOG_FILE();
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_BYTES) fs.renameSync(file, file + '.1');
    } catch { /* file may not exist yet */ }
    fs.appendFileSync(file, line + '\n');
  } catch { /* logging must never crash the app */ }
}

function safeJson(v: unknown): string {
  try {
    if (v instanceof Error) return v.stack || v.message;
    return JSON.stringify(v);
  } catch { return String(v); }
}

export const log = {
  info: (msg: string, extra?: unknown) => write('info', msg, extra),
  warn: (msg: string, extra?: unknown) => write('warn', msg, extra),
  error: (msg: string, extra?: unknown) => write('error', msg, extra),
};

export function tailLog(lines: number): string {
  try {
    const data = fs.readFileSync(LOG_FILE(), 'utf8');
    const arr = data.split('\n');
    return arr.slice(Math.max(0, arr.length - lines)).join('\n');
  } catch {
    return '';
  }
}
