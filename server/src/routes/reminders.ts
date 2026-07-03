import { Router } from 'express';
import { db } from '../db';
import { id, now, ruDate, ruIn, ruTime } from '../util';
import { broadcast } from '../sse';
import { alarmPayload, ReminderRow, stopEverywhere } from '../scheduler';
import { log } from '../log';

const SNOOZE_MS = 5 * 60_000;

function toJson(rem: ReminderRow) {
  return {
    id: rem.id,
    text: rem.text,
    dueAt: rem.due_at,
    status: rem.status,
    snoozeUntil: rem.snooze_until,
    snoozeUsed: rem.snooze_used === 1,
    createdAt: rem.created_at,
  };
}

export const remindersRouter = Router();

remindersRouter.get('/reminders', (req, res) => {
  const from = Number(req.query.from || 0);
  const to = Number(req.query.to || Number.MAX_SAFE_INTEGER);
  const rows = db
    .prepare('SELECT * FROM reminders WHERE due_at >= ? AND due_at < ? ORDER BY due_at ASC')
    .all(from, to) as ReminderRow[];
  res.json({ reminders: rows.map(toJson) });
});

/** Ringing right now — fetched on every app open as the re-sync safety net (8C). */
remindersRouter.get('/reminders/active', (_req, res) => {
  const rows = db.prepare("SELECT * FROM reminders WHERE status = 'ringing' ORDER BY due_at ASC").all() as ReminderRow[];
  res.json({ alarms: rows.map(alarmPayload) });
});

remindersRouter.post('/reminders', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 500);
  const dueAt = Math.round(Number(req.body?.dueAt));
  if (!text) {
    res.status(400).json({ message: 'Напишите, о чём напомнить.' });
    return;
  }
  if (!Number.isFinite(dueAt)) {
    res.status(400).json({ message: 'Выберите дату и время.' });
    return;
  }
  if (dueAt <= now() + 30_000) {
    res.status(400).json({ message: 'Это время уже прошло. Выберите время в будущем.' });
    return;
  }
  const remId = id();
  db.prepare('INSERT INTO reminders (id, text, due_at, created_at) VALUES (?, ?, ?, ?)').run(
    remId,
    text,
    dueAt,
    now()
  );
  broadcast('reminders-changed', { id: remId });
  log.info(`reminder created: «${text}» at ${new Date(dueAt).toISOString()}`);
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(remId) as ReminderRow;
  res.json({
    reminder: toJson(row),
    summary: { date: ruDate(dueAt), time: ruTime(dueAt), inText: ruIn(dueAt - now()) },
  });
});

remindersRouter.delete('/reminders/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id) as ReminderRow | undefined;
  if (!row) {
    res.status(404).json({ message: 'Напоминание не найдено.' });
    return;
  }
  if (row.status === 'ringing' || row.status === 'snoozed') stopEverywhere(row, 'dismiss');
  db.prepare('DELETE FROM reminders WHERE id = ?').run(row.id);
  broadcast('reminders-changed', { id: row.id });
  res.json({ ok: true });
});

/** First «OK» anywhere stops it everywhere. */
remindersRouter.post('/reminders/:id/dismiss', (req, res) => {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id) as ReminderRow | undefined;
  if (!row) {
    res.status(404).json({ message: 'Напоминание не найдено.' });
    return;
  }
  if (row.status !== 'done') {
    db.prepare("UPDATE reminders SET status = 'done', dismissed_at = ? WHERE id = ?").run(now(), row.id);
    stopEverywhere(row, 'dismiss');
    broadcast('reminders-changed', { id: row.id });
  }
  res.json({ ok: true });
});

/** «Показать через 5 минут» — allowed exactly once; the next ring is OK-only. */
remindersRouter.post('/reminders/:id/snooze', (req, res) => {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id) as ReminderRow | undefined;
  if (!row) {
    res.status(404).json({ message: 'Напоминание не найдено.' });
    return;
  }
  if (row.snooze_used === 1 || row.status !== 'ringing') {
    res.status(400).json({ message: 'Отложить можно только один раз.' });
    return;
  }
  db.prepare("UPDATE reminders SET status = 'snoozed', snooze_until = ?, snooze_used = 1 WHERE id = ?").run(
    now() + SNOOZE_MS,
    row.id
  );
  stopEverywhere(row, 'snooze');
  broadcast('reminders-changed', { id: row.id });
  res.json({ ok: true, snoozeUntil: now() + SNOOZE_MS });
});
