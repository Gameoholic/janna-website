import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ReminderInfo } from '../shared/api';
import { onRemindersChanged } from '../shared/alarm';
import { requestNotificationPermission } from '../shared/push';
import { ConfirmDialog, Dialog, showToast, TopBar } from '../shared/ui';
import { IconBack, IconBell, IconChevronDown, IconPlus } from '../shared/icons';
import {
  addDays,
  dayKey,
  fmtDate,
  fmtIn,
  fmtTime,
  startOfDay,
} from '../shared/russian';
import { t } from '../shared/i18n';
import { Calendar, TimeStepper } from './Calendar';

export function RemindersApp() {
  const [reminders, setReminders] = useState<ReminderInfo[]>([]);
  const [rangeMonth, setRangeMonth] = useState<{ year: number; month: number }>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<number>(() => startOfDay(Date.now()));
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const monthStart = new Date(rangeMonth.year, rangeMonth.month, 1).getTime();
    const monthEnd = new Date(rangeMonth.year, rangeMonth.month + 1, 1).getTime();
    const from = Math.min(startOfDay(Date.now()), monthStart) - 7 * 86400e3;
    const to = Math.max(addDays(startOfDay(Date.now()), 2), monthEnd) + 7 * 86400e3;
    try {
      const res = await api.get<{ reminders: ReminderInfo[] }>(`/api/reminders?from=${from}&to=${to}`);
      setReminders(res.reminders);
    } catch { /* keep the previous list; SSE will retry */ }
  }, [rangeMonth]);

  useEffect(() => {
    void load();
    return onRemindersChanged(() => void load());
  }, [load]);

  return (
    <>
      <HomeStage
        reminders={reminders}
        selectedDay={selectedDay}
        highlightId={highlightId}
        onSelectDay={setSelectedDay}
        onMonthChange={(year, month) => setRangeMonth({ year, month })}
        onAdd={() => setCreateOpen(true)}
        onChanged={() => void load()}
      />
      <CreateReminderDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(reminder) => {
          setCreateOpen(false);
          setHighlightId(reminder.id);
          setSelectedDay(startOfDay(reminder.dueAt));
          window.setTimeout(() => setHighlightId(null), 6000);
          void load();
        }}
      />
    </>
  );
}

/* ---------------- Home: Сегодня / Завтра / calendar (8C) ---------------- */

function HomeStage(props: {
  reminders: ReminderInfo[];
  selectedDay: number;
  highlightId: string | null;
  onSelectDay: (ts: number) => void;
  onMonthChange: (year: number, month: number) => void;
  onAdd: () => void;
  onChanged: () => void;
}) {
  const [notifState, setNotifState] = useState<NotificationPermission | 'unsupported'>(() =>
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [opened, setOpened] = useState<ReminderInfo | null>(null);

  const todayStart = startOfDay(Date.now());
  const tomorrowStart = addDays(todayStart, 1);
  const afterTomorrow = addDays(todayStart, 2);

  const today = props.reminders.filter((r) => r.dueAt >= todayStart && r.dueAt < tomorrowStart);
  const tomorrow = props.reminders.filter((r) => r.dueAt >= tomorrowStart && r.dueAt < afterTomorrow);
  const selectedList = props.reminders.filter(
    (r) => startOfDay(r.dueAt) === props.selectedDay
  );

  const marks = useMemo(() => {
    const set = new Set<string>();
    for (const r of props.reminders) set.add(dayKey(r.dueAt));
    return set;
  }, [props.reminders]);

  const showSelectedSection =
    props.selectedDay !== todayStart && props.selectedDay !== tomorrowStart;

  return (
    <div className="page" style={{ maxWidth: 620 }}>
      <TopBar title={t('Напоминания')} />
      <p className="muted" style={{ margin: '0 2px 16px' }}>
        {t('сегодня —')} {fmtDate(Date.now())}, <span className="num">{fmtTime(Date.now())}</span>
      </p>

      {notifState === 'default' ? (
        <div className="card stack" style={{ marginBottom: 16, background: 'var(--accent-soft)', boxShadow: 'none' }}>
          <div className="row">
            <IconBell size={26} />
            <b className="grow">{t('Чтобы напоминания звонили на этом устройстве, разрешите уведомления.')}</b>
          </div>
          <button
            className="btn btn-primary btn-block"
            onClick={() => void requestNotificationPermission().then(setNotifState)}
          >
            {t('Разрешить')}
          </button>
        </div>
      ) : null}

      <Section title={t('Сегодня')} empty={t('Сегодня напоминаний нет.')}>
        {today.map((r) => (
          <ReminderRow key={r.id} reminder={r} highlight={props.highlightId === r.id} onOpen={() => setOpened(r)} />
        ))}
      </Section>

      <Section title={t('Завтра')} empty={t('Завтра напоминаний нет.')}>
        {tomorrow.map((r) => (
          <ReminderRow key={r.id} reminder={r} highlight={props.highlightId === r.id} onOpen={() => setOpened(r)} />
        ))}
      </Section>

      <div className="card" style={{ marginBottom: 18 }}>
        <Calendar
          selected={props.selectedDay}
          onSelect={props.onSelectDay}
          marks={marks}
          onMonthChange={props.onMonthChange}
        />
      </div>

      {showSelectedSection ? (
        <Section title={fmtDate(props.selectedDay)} empty={t('В этот день напоминаний нет.')}>
          {selectedList.map((r) => (
            <ReminderRow key={r.id} reminder={r} highlight={props.highlightId === r.id} onOpen={() => setOpened(r)} />
          ))}
        </Section>
      ) : null}

      <div className="bottombar">
        <button className="btn btn-primary btn-big" onClick={props.onAdd}>
          <IconPlus size={26} /> {t('Добавить напоминание')}
        </button>
      </div>

      {opened ? (
        <ReminderDialog reminder={opened} onClose={() => setOpened(null)} onChanged={props.onChanged} />
      ) : null}
    </div>
  );
}

function Section(props: { title: string; empty: string; children: ReactNode }) {
  const hasItems = Array.isArray(props.children) ? props.children.length > 0 : !!props.children;
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ margin: '0 2px 10px', textTransform: 'capitalize' }}>{props.title}</h2>
      {hasItems ? (
        <div className="list-wrap">{props.children}</div>
      ) : (
        <p className="muted" style={{ margin: '0 2px' }}>
          {props.empty}
        </p>
      )}
    </div>
  );
}

function ReminderRow(props: { reminder: ReminderInfo; highlight: boolean; onOpen: () => void }) {
  const { reminder } = props;
  return (
    <button
      className="list-row"
      style={props.highlight ? { background: 'var(--accent-soft)' } : undefined}
      onClick={props.onOpen}
    >
      <span className="num" style={{ fontSize: 24, fontWeight: 700, minWidth: 76, color: 'var(--accent)' }}>
        {fmtTime(reminder.dueAt)}
      </span>
      <span className="grow">
        {reminder.text}
        {reminder.status === 'ringing' ? <b style={{ color: 'var(--danger)' }}> {t('— звонит!')}</b> : null}
        {reminder.status === 'snoozed' && reminder.snoozeUntil ? (
          <span className="muted small"> {t('— отложено до {time}', { time: fmtTime(reminder.snoozeUntil) })}</span>
        ) : null}
      </span>
    </button>
  );
}

function ReminderDialog(props: { reminder: ReminderInfo; onClose: () => void; onChanged: () => void }) {
  const { reminder } = props;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.del(`/api/reminders/${reminder.id}`);
      showToast(t('Напоминание удалено'));
      props.onChanged();
      props.onClose();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось удалить.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t('Напоминание')} onClose={busy ? undefined : props.onClose}>
      <p style={{ fontSize: 21, margin: '4px 0 10px' }}>{reminder.text}</p>
      <p className="num" style={{ margin: '0 0 18px', fontSize: 19 }}>
        {fmtDate(reminder.dueAt)}, <b>{fmtTime(reminder.dueAt)}</b>
        {reminder.status === 'scheduled' && reminder.dueAt > Date.now() ? (
          <span className="muted"> ({fmtIn(reminder.dueAt - Date.now())})</span>
        ) : null}
      </p>
      <div className="stack">
        <button className="btn btn-block" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)} disabled={busy}>
          {t('Удалить напоминание')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={props.onClose} disabled={busy}>
          {t('Закрыть')}
        </button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t('Удалить напоминание?')}
        body={<span>{t('«{text}» больше не прозвонит.', { text: reminder.text })}</span>}
        confirmLabel={t('Удалить')}
        danger
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Dialog>
  );
}

/* ---------------- Create: a modal so it's never ambiguous whether she's on
   «Напоминания» or creating one (P2/P3). Two steps inside the same dialog:
   fill in the details, then a separate confirm screen with all the numbers
   before anything is actually created. ---------------- */

function CreateReminderDialog(props: {
  open: boolean;
  onClose: () => void;
  onCreated: (reminder: ReminderInfo) => void;
}) {
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [text, setText] = useState('');
  const [day, setDay] = useState<number>(() => startOfDay(Date.now()));
  const [time, setTime] = useState<{ hour: number; minute: number }>(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    return { hour: d.getHours(), minute: Math.floor(d.getMinutes() / 5) * 5 };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollMore, setCanScrollMore] = useState(false);

  // Fresh form every time the modal opens.
  useEffect(() => {
    if (!props.open) return;
    setStep('form');
    setText('');
    setDay(startOfDay(Date.now()));
    const d = new Date(Date.now() + 60 * 60_000);
    setTime({ hour: d.getHours(), minute: Math.floor(d.getMinutes() / 5) * 5 });
    setError(null);
    setBusy(false);
  }, [props.open]);

  const dueAt = useMemo(() => {
    const d = new Date(day);
    d.setHours(time.hour, time.minute, 0, 0);
    return d.getTime();
  }, [day, time]);

  const inFuture = dueAt > Date.now() + 30_000;

  // Show a gentle "scroll down" hint only while there's more below the fold —
  // never once she's reached the bottom, and never anything flashy (Section 9).
  useEffect(() => {
    if (!props.open || step !== 'form') return;
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setCanScrollMore(el.scrollHeight - el.clientHeight - el.scrollTop > 12);
    check();
    el.addEventListener('scroll', check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, [props.open, step]);

  const goToConfirm = () => {
    if (!text.trim()) {
      setError(t('Напишите, о чём напомнить.'));
      return;
    }
    if (!inFuture) {
      setError(t('Это время уже прошло. Выберите время в будущем.'));
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ reminder: ReminderInfo }>('/api/reminders', {
        text: text.trim(),
        dueAt,
      });
      showToast(t('Напоминание создано'));
      props.onCreated(res.reminder);
    } catch (e) {
      setError(e instanceof Error ? t(e.message) : t('Не получилось создать напоминание.'));
      setStep('form');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      full={step === 'form'}
      title={step === 'form' ? t('Новое напоминание') : t('Проверьте и подтвердите')}
      onClose={busy ? undefined : props.onClose}
    >
      {step === 'form' ? (
        <>
          <div className="scroll-hint-wrap grow" style={{ minHeight: 0 }}>
            <div ref={scrollRef} className="stack" style={{ gap: 18, overflowY: 'auto', height: '100%', paddingBottom: 8 }}>
              <div>
                <h2 style={{ margin: '0 2px 10px' }}>{t('О чём напомнить?')}</h2>
                <textarea
                  className="textarea"
                  placeholder={t('Например: занятие по танцам')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={300}
                  autoFocus
                />
              </div>

              <div>
                <h2 style={{ margin: '0 2px 10px' }}>{t('Какого числа?')}</h2>
                <div className="card">
                  <Calendar selected={day} onSelect={setDay} marks={new Set()} minDate={Date.now()} />
                </div>
              </div>

              <div>
                <h2 style={{ margin: '0 2px 10px' }}>{t('Во сколько?')}</h2>
                <div className="card">
                  <TimeStepper hour={time.hour} minute={time.minute} onChange={(hour, minute) => setTime({ hour, minute })} />
                </div>
              </div>

              {error ? (
                <div className="card" style={{ background: 'var(--danger-soft)', boxShadow: 'none' }}>
                  {error}
                </div>
              ) : null}
            </div>
            {canScrollMore ? (
              <div className="scroll-hint">
                <IconChevronDown size={22} />
              </div>
            ) : null}
          </div>

          <div className="stack" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-big btn-block" onClick={goToConfirm}>
              {t('Далее')}
            </button>
            <button className="btn btn-ghost btn-block" onClick={props.onClose}>
              {t('Отмена')}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* The confirmation summary: exact date, weekday, 24h time, static «через …» (8C). */}
          <div className="card" style={{ background: 'var(--accent-soft)', boxShadow: 'none', marginBottom: 16 }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>{text}</div>
            <div style={{ fontSize: 21 }}>
              <b>{fmtDate(dueAt)}</b>, <b className="num">{fmtTime(dueAt)}</b>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {fmtIn(dueAt - Date.now())}
            </div>
          </div>

          {error ? (
            <div className="card" style={{ background: 'var(--danger-soft)', boxShadow: 'none', marginBottom: 16 }}>
              {error}
            </div>
          ) : null}

          <div className="stack">
            <button className="btn btn-primary btn-big btn-block" onClick={() => void create()} disabled={busy}>
              {busy ? t('Создаём…') : t('Добавить напоминание')}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setStep('form')} disabled={busy}>
              <IconBack size={20} /> {t('Назад')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
