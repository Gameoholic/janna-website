import { ReactNode, useEffect, useState } from 'react';
import './tokens.css';
import { api, ApiError } from './api';
import { AlarmTakeover, startAlarmClient } from './alarm';
import { registerServiceWorker, ensurePushSubscription } from './push';
import { CenterMessage, Spinner, ToastHost } from './ui';
import { t } from './i18n';

type Gate = 'loading' | 'ok' | 'unprovisioned' | 'offline';

/**
 * Common wrapper for the three apps: device gate (P7 — no login UI, ever),
 * service worker + push registration, alarm client, toast host.
 */
export function AppShell(props: { app: 'video' | 'files' | 'reminders'; children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('loading');

  useEffect(() => {
    document.body.classList.add(`app-${props.app}`);
    let cancelled = false;
    const check = async () => {
      try {
        await api.get('/api/me');
        if (cancelled) return;
        setGate('ok');
        startAlarmClient();
        void registerServiceWorker().then(() => void ensurePushSubscription());
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) setGate('unprovisioned');
        else setGate('offline');
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [props.app]);

  if (gate === 'loading') {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  if (gate === 'unprovisioned') {
    // No login screen exists. A device is connected once via a setup link.
    return (
      <CenterMessage
        title={t('Это устройство ещё не подключено')}
        body={t(
          'Чтобы всё заработало, нужно один раз открыть на этом устройстве специальную ссылку. Позвоните Даниилу — он поможет.'
        )}
      />
    );
  }

  if (gate === 'offline') {
    return (
      <CenterMessage title={t('Нет связи')} body={t('Проверьте интернет и попробуйте ещё раз.')}>
        <button className="btn btn-primary btn-big btn-block" onClick={() => window.location.reload()}>
          {t('Попробовать ещё раз')}
        </button>
      </CenterMessage>
    );
  }

  return (
    <>
      {props.children}
      <AlarmTakeover />
      <ToastHost />
    </>
  );
}
