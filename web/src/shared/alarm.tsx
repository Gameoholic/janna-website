import { useEffect, useState } from 'react';
import { api, ActiveAlarm } from './api';
import { t } from './i18n';

/**
 * The alarm client (P9): listens on the real-time channel, re-syncs on app
 * open, and renders the full-screen takeover with loud sound + vibration.
 * The first «OK» on any device stops it everywhere.
 */

type AlarmListener = (alarms: ActiveAlarm[]) => void;

const alarms = new Map<string, ActiveAlarm>();
const listeners = new Set<AlarmListener>();
const remindersChangedListeners = new Set<() => void>();

let audio: HTMLAudioElement | null = null;
let audioUnlocked = false;
let vibrateTimer: number | undefined;
let wakeLock: { release: () => Promise<void> } | null = null;

function notify(): void {
  const list = Array.from(alarms.values()).sort((a, b) => a.dueAt - b.dueAt);
  for (const listener of listeners) listener(list);
  updateEffects(list.length > 0);
}

function updateEffects(active: boolean): void {
  if (active) {
    startSound();
    if (vibrateTimer === undefined && 'vibrate' in navigator) {
      const buzz = () => navigator.vibrate([500, 220, 500]);
      buzz();
      vibrateTimer = window.setInterval(buzz, 1700);
    }
    if (!wakeLock && 'wakeLock' in navigator) {
      (navigator as unknown as { wakeLock: { request: (t: string) => Promise<never> } }).wakeLock
        .request('screen')
        .then((lock: never) => {
          wakeLock = lock as { release: () => Promise<void> };
        })
        .catch(() => { /* not critical */ });
    }
  } else {
    stopSound();
    if (vibrateTimer !== undefined) {
      window.clearInterval(vibrateTimer);
      vibrateTimer = undefined;
      if ('vibrate' in navigator) navigator.vibrate(0);
    }
    if (wakeLock) {
      wakeLock.release().catch(() => { /* ignore */ });
      wakeLock = null;
    }
  }
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio('/alarm.mp3');
    audio.loop = true;
    audio.volume = 1;
  }
  return audio;
}

function startSound(): void {
  const a = getAudio();
  if (a.paused) {
    a.currentTime = 0;
    a.play().catch(() => {
      /* Autoplay may be blocked until her first tap in this session — an
       * honest browser limit. Vibration + takeover still fire, and the push
       * notification on the phone carries its own sound. */
    });
  }
}

function stopSound(): void {
  if (audio && !audio.paused) {
    audio.pause();
    audio.currentTime = 0;
  }
}

/** Pre-authorize audio on her first interaction so a later alarm can sound. */
function unlockAudioOnGesture(): void {
  const unlock = () => {
    if (audioUnlocked) return;
    audioUnlocked = true;
    const a = getAudio();
    if (!a.paused) return; // already ringing
    a.muted = true;
    a.play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      })
      .catch(() => {
        a.muted = false;
      });
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function addAlarm(alarm: ActiveAlarm): void {
  alarms.set(alarm.id, alarm);
  notify();
}

function removeAlarm(id: string): void {
  if (alarms.delete(id)) notify();
}

async function resync(): Promise<void> {
  try {
    const { alarms: active } = await api.get<{ alarms: ActiveAlarm[] }>('/api/reminders/active');
    alarms.clear();
    for (const alarm of active) alarms.set(alarm.id, alarm);
    notify();
  } catch { /* offline — SSE will retry */ }
}

let started = false;

export function startAlarmClient(): void {
  if (started) return;
  started = true;
  unlockAudioOnGesture();
  void resync();

  const connect = () => {
    const source = new EventSource('/api/events');
    source.addEventListener('alarm-ring', (e) => {
      try {
        addAlarm(JSON.parse((e as MessageEvent).data));
      } catch { /* ignore malformed */ }
    });
    source.addEventListener('alarm-stop', (e) => {
      try {
        removeAlarm(JSON.parse((e as MessageEvent).data).id);
      } catch { /* ignore malformed */ }
    });
    source.addEventListener('reminders-changed', () => {
      for (const listener of remindersChangedListeners) listener();
    });
    source.onerror = () => {
      /* EventSource auto-reconnects; also resync when we come back */
    };
    source.onopen = () => void resync();
  };
  connect();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void resync();
  });

  // Belt and braces: the service worker mirrors push events to open windows.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string; alarm?: ActiveAlarm; id?: string };
      if (data?.type === 'alarm-ring' && data.alarm) addAlarm(data.alarm);
      if (data?.type === 'alarm-stop' && data.id) removeAlarm(data.id);
    });
  }
}

export function onRemindersChanged(listener: () => void): () => void {
  remindersChangedListeners.add(listener);
  return () => remindersChangedListeners.delete(listener);
}

export function useActiveAlarms(): ActiveAlarm[] {
  const [list, setList] = useState<ActiveAlarm[]>(() =>
    Array.from(alarms.values()).sort((a, b) => a.dueAt - b.dueAt)
  );
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

/** Full-screen alarm takeover — mounted by every app shell (8C). */
export function AlarmTakeover() {
  const list = useActiveAlarms();
  const alarm = list[0];
  if (!alarm) return null;

  const dismiss = () => {
    removeAlarm(alarm.id); // optimistic: silence immediately
    api.post(`/api/reminders/${alarm.id}/dismiss`).catch(() => void resync());
  };
  const snooze = () => {
    removeAlarm(alarm.id);
    api.post(`/api/reminders/${alarm.id}/snooze`).catch(() => void resync());
  };

  return (
    <div className="alarm-overlay" role="alertdialog" aria-label={t('Напоминание')}>
      <div className="alarm-time num">{alarm.time}</div>
      <div className="alarm-text">{alarm.text}</div>
      <div className="alarm-date">{alarm.date}</div>
      <button className="alarm-ok" onClick={dismiss}>
        OK
      </button>
      {!alarm.snoozeUsed ? (
        <button className="alarm-snooze" onClick={snooze}>
          {t('Показать через 5 минут')}
        </button>
      ) : null}
      {list.length > 1 ? (
        <div style={{ marginTop: 26, fontSize: 18, opacity: 0.85 }}>
          {t('и ещё {n} напоминание…', { n: list.length - 1 })}
        </div>
      ) : null}
    </div>
  );
}
