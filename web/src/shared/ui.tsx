import { ReactNode, useEffect, useRef, useState } from 'react';
import { IconBack, IconHome } from './icons';
import { t } from './i18n';

/** Shared building blocks (P12): the same controls in all three apps. */

export function Dialog(props: {
  open: boolean;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  full?: boolean;
}) {
  useEffect(() => {
    if (!props.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [props.open]);
  if (!props.open) return null;
  return (
    <div
      className="dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && props.onClose) props.onClose();
      }}
    >
      <div className={`dialog swap-enter${props.full ? ' dialog-full' : ''}`}>
        {props.title ? <h2>{props.title}</h2> : null}
        {props.children}
      </div>
    </div>
  );
}

/** Confirmation dialog — nothing destructive happens from a single tap (8B). */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={props.open} title={props.title} onClose={props.busy ? undefined : props.onCancel}>
      {props.body ? <div style={{ marginBottom: 18 }}>{props.body}</div> : null}
      <div className="stack">
        <button
          className={`btn btn-big btn-block ${props.danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={props.onConfirm}
          disabled={props.busy}
        >
          {props.busy ? t('Подождите…') : props.confirmLabel}
        </button>
        <button className="btn btn-ghost btn-block" onClick={props.onCancel} disabled={props.busy}>
          {t('Отмена')}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * The left slot is «Назад» on a nested screen, or — when there's nowhere to
 * go back to — a «На главную» button (P12) back to the app chooser at «/».
 * She's never stranded without a way back (Section 9).
 */
export function TopBar(props: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="topbar">
      {props.onBack ? (
        <button className="btn btn-ghost" onClick={props.onBack} aria-label={t('Назад')} style={{ minWidth: 56 }}>
          <IconBack size={26} />
        </button>
      ) : (
        <button
          className="btn btn-ghost"
          onClick={() => {
            window.location.href = '/';
          }}
          aria-label={t('На главную')}
          style={{ minWidth: 56 }}
        >
          <IconHome size={24} />
        </button>
      )}
      <h1>{props.title}</h1>
      {props.right}
    </div>
  );
}

export function ProgressBar(props: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(props.value * 100)));
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function CenterMessage(props: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card center" style={{ maxWidth: 440, width: '100%' }}>
        <h2 style={{ marginBottom: 10 }}>{props.title}</h2>
        {props.body ? <p className="muted">{props.body}</p> : null}
        {props.children}
      </div>
    </div>
  );
}

let toastListener: ((text: string) => void) | null = null;

/** One-line feedback («Ссылка скопирована») — never used for results (P2). */
export function showToast(text: string): void {
  if (toastListener) toastListener(text);
}

export function ToastHost() {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    toastListener = (t) => {
      setText(t);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setText(null), 2600);
    };
    return () => {
      toastListener = null;
      window.clearTimeout(timer.current);
    };
  }, []);
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

/** Copy with a fallback for older Chrome / non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const handler = () => setIsPhone(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isPhone;
}
