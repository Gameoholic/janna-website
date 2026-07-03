import { db, getSetting, setSetting } from './db';
import { broadcast } from './sse';
import { pushToAll } from './push';
import { log } from './log';
import { now, ruDate, ruIn, ruTime } from './util';

export interface ReminderRow {
  id: string;
  text: string;
  due_at: number;
  created_at: number;
  status: 'scheduled' | 'ringing' | 'snoozed' | 'done';
  snooze_until: number | null;
  snooze_used: number;
  dismissed_at: number | null;
}

/** Dev-only, global to all reminders (8C): heads-up pushes before the alarm. */
export const DEFAULT_LEADS_MS = [5 * 60_000, 60 * 60_000, 24 * 60 * 60_000];

export function getLeadTimes(): number[] {
  const raw = getSetting('lead_times_ms');
  if (!raw) return DEFAULT_LEADS_MS;
  try {
    const arr = JSON.parse(raw) as number[];
    return Array.isArray(arr) ? arr.filter((n) => Number.isFinite(n) && n > 0) : DEFAULT_LEADS_MS;
  } catch {
    return DEFAULT_LEADS_MS;
  }
}

export function setLeadTimes(leads: number[]): void {
  setSetting('lead_times_ms', JSON.stringify(leads));
}

export function alarmPayload(rem: ReminderRow) {
  return {
    id: rem.id,
    text: rem.text,
    dueAt: rem.due_at,
    time: ruTime(rem.due_at),
    date: ruDate(rem.due_at),
    snoozeUsed: rem.snooze_used === 1,
  };
}

/** Ring everywhere: SSE takeover for open apps + strongest push for closed ones. */
function ring(rem: ReminderRow): void {
  log.info(`reminder ringing: ${rem.id} «${rem.text}»`);
  broadcast('alarm-ring', alarmPayload(rem));
  void pushToAll(
    {
      kind: 'alarm',
      reminderId: rem.id,
      title: '⏰ Напоминание',
      body: `${rem.text}\n${ruTime(rem.due_at)}`,
      snoozeUsed: rem.snooze_used === 1,
    },
    3600
  );
}

export function stopEverywhere(rem: ReminderRow, action: 'dismiss' | 'snooze'): void {
  broadcast('alarm-stop', { id: rem.id, action });
  void pushToAll({ kind: 'stop', reminderId: rem.id }, 600);
}

function sendLeads(nowMs: number): void {
  const leads = getLeadTimes();
  for (const lead of leads) {
    // A lead is only sent when the reminder existed before its window opened,
    // so creating a reminder 30 minutes out doesn't dump the 24h/1h heads-ups
    // on her all at once.
    const rows = db
      .prepare(
        `SELECT r.* FROM reminders r
         WHERE r.status = 'scheduled'
           AND r.due_at - ? <= ?
           AND r.due_at - ? >= r.created_at
           AND r.due_at > ? + 60000
           AND NOT EXISTS (SELECT 1 FROM lead_sent ls WHERE ls.reminder_id = r.id AND ls.lead_ms = ?)`
      )
      .all(lead, nowMs, lead, nowMs, lead) as ReminderRow[];
    for (const rem of rows) {
      db.prepare('INSERT OR IGNORE INTO lead_sent (reminder_id, lead_ms) VALUES (?, ?)').run(rem.id, lead);
      const body = `${ruIn(rem.due_at - nowMs)} — ${ruDate(rem.due_at)}, ${ruTime(rem.due_at)}`;
      void pushToAll(
        { kind: 'lead', reminderId: rem.id, title: `Скоро: ${rem.text}`, body },
        Math.max(600, Math.round(lead / 1000))
      );
      log.info(`lead notification sent for ${rem.id} (lead ${lead} ms)`);
    }
  }
}

function tick(): void {
  const nowMs = now();
  try {
    // Fire due reminders. If the server was down at the exact minute, they
    // still fire on the next tick — she can never silently miss one.
    const due = db
      .prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND due_at <= ?")
      .all(nowMs) as ReminderRow[];
    for (const rem of due) {
      db.prepare("UPDATE reminders SET status = 'ringing' WHERE id = ?").run(rem.id);
      ring({ ...rem, status: 'ringing' });
    }

    // Snoozed once («Показать через 5 минут») → ring again, this time OK-only.
    const snoozed = db
      .prepare("SELECT * FROM reminders WHERE status = 'snoozed' AND snooze_until <= ?")
      .all(nowMs) as ReminderRow[];
    for (const rem of snoozed) {
      db.prepare("UPDATE reminders SET status = 'ringing' WHERE id = ?").run(rem.id);
      ring({ ...rem, status: 'ringing', snooze_used: 1 });
    }

    sendLeads(nowMs);
  } catch (e) {
    log.error('scheduler tick failed', e);
  }
}

export function startScheduler(): void {
  setInterval(tick, 5000).unref();
  tick();
}
