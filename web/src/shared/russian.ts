/**
 * User-visible formatting: Russian for her (24-hour, Monday-first, P5). The
 * locale follows the developer language switch so English testing shows
 * English dates too; her default stays Russian.
 */
import { getLang } from './i18n';

function locale(): string {
  return getLang() === 'en' ? 'en-GB' : 'ru-RU';
}

export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** «понедельник, 5 января» / "Monday, 5 January" */
export function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ts));
}

/** «5 января» / "5 January" */
export function fmtDateShort(ts: number): string {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' }).format(new Date(ts));
}

/** «18:30» (24-hour in both languages) */
export function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts));
}

/** «июль 2026» / "July 2026" */
export function fmtMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

/** «0:37» / «12:05» / «1:02:03» — the numbers she likes to see. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export function fmtSize(bytes: number): string {
  const en = getLang() === 'en';
  if (bytes < 1024) return `${bytes} ${en ? 'B' : 'Б'}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} ${en ? 'KB' : 'КБ'}`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} ${en ? 'MB' : 'МБ'}`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} ${en ? 'GB' : 'ГБ'}`;
}

/**
 * Static «через N …» / "in N …" (8C): minutes are omitted once the lead is
 * >= 1 hour.
 */
export function fmtIn(ms: number): string {
  const en = getLang() === 'en';
  if (ms < 60_000) return en ? 'in less than a minute' : 'меньше чем через минуту';
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return en
      ? `in ${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`
      : `через ${totalMinutes} ${plural(totalMinutes, ['минуту', 'минуты', 'минут'])}`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts: string[] = [];
  if (en) {
    if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (parts.length === 0) parts.push(`${totalHours} ${totalHours === 1 ? 'hour' : 'hours'}`);
    return `in ${parts.join(', ')}`;
  }
  if (days > 0) parts.push(`${days} ${plural(days, ['день', 'дня', 'дней'])}`);
  if (hours > 0) parts.push(`${hours} ${plural(hours, ['час', 'часа', 'часов'])}`);
  if (parts.length === 0) parts.push(`${totalHours} ${plural(totalHours, ['час', 'часа', 'часов'])}`);
  return `через ${parts.join(', ')}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const WEEKDAYS_RU = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday-first short weekday labels for the calendar header. */
export function weekdaysShort(): string[] {
  return getLang() === 'en' ? WEEKDAYS_EN : WEEKDAYS_RU;
}

export interface CalendarCell {
  ts: number;
  day: number;
  inMonth: boolean;
}

/** Monday-first month grid covering full weeks. */
export function monthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ ts: d.getTime(), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  // Trim a fully out-of-month trailing week for a compact grid.
  if (cells.slice(35).every((c) => !c.inMonth)) cells.length = 35;
  return cells;
}
