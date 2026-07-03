import crypto from 'crypto';
import { TIMEZONE } from './config';

export function id(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export function token(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function now(): number {
  return Date.now();
}

/** Russian plural: plural(2, ['минута','минуты','минут']) -> 'минуты' */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** «понедельник, 5 января» */
export function ruDate(ts: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: TIMEZONE,
  }).format(new Date(ts));
}

/** «18:30» (24-hour, always) */
export function ruTime(ts: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIMEZONE,
  }).format(new Date(ts));
}

/**
 * Static «через N …» line. If the lead is >= 1 hour, minutes are omitted
 * («через 5 дней, 2 часа»); otherwise minutes are shown («через 43 минуты»).
 */
export function ruIn(ms: number): string {
  if (ms < 60_000) return 'меньше чем через минуту';
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `через ${totalMinutes} ${plural(totalMinutes, ['минуту', 'минуты', 'минут'])}`;
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${plural(days, ['день', 'дня', 'дней'])}`);
  if (hours > 0) parts.push(`${hours} ${plural(hours, ['час', 'часа', 'часов'])}`);
  if (parts.length === 0) parts.push(`${totalHours} ${plural(totalHours, ['час', 'часа', 'часов'])}`);
  return `через ${parts.join(', ')}`;
}

/** Strip characters that are unsafe in filenames; keep spaces and Cyrillic. */
export function safeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  return cleaned || 'файл';
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? '.' + m[1].toLowerCase() : '';
}
