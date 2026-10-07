import { Dialog } from './ui';
import { t } from './i18n';

/**
 * Shared chooser (P12): Файлы sends a link, Голос sends text, both through
 * the same three buttons.
 *
 * Android ranks its own share sheet by what she has used lately, and the Web
 * Share API gives a page no say in that order — so the apps she actually
 * sends things through kept appearing below ones she never opens. That part
 * is a platform limit, not something to work around. What we can decide is
 * what she sees *first*: WhatsApp and почта in a fixed place she can learn,
 * with the Android sheet still one tap away for everything else.
 */
export function ShareChooser(props: {
  open: boolean;
  onClose: () => void;
  /** A link (Файлы) or free text (Голос) — whichever this screen sends. */
  payload: string | null;
  /** Mail subject, and the title handed to the Android sheet. */
  title?: string;
  /** True when the payload is a link, so the Android sheet is told so. */
  asUrl?: boolean;
  /** Called when the Android sheet itself fails, so the caller can fall back. */
  onNativeFailed?: () => void;
}) {
  const { payload } = props;

  const sendTo = (href: string) => {
    props.onClose();
    // Navigation, not window.open: a window opened from a handler like this
    // is treated as a popup and blocked, while a navigation hands straight
    // over to the app.
    window.location.href = href;
  };

  const openAndroidSheet = () => {
    props.onClose();
    if (!payload) return;
    const data: ShareData = props.asUrl ? { url: payload } : { text: payload };
    if (props.title) data.title = props.title;
    navigator.share(data).catch((e: unknown) => {
      // She closed the sheet without picking anything — a choice, not a
      // failure, and not something to nag her about.
      if (e instanceof Error && e.name === 'AbortError') return;
      props.onNativeFailed?.();
    });
  };

  return (
    <Dialog open={props.open} title={t('Отправить')} onClose={props.onClose}>
      {/* Only Файлы has a link to wait for; Голос always opens with its text. */}
      {payload === null ? <p className="muted" style={{ marginTop: 0 }}>{t('Готовим ссылку…')}</p> : null}
      <div className="stack">
        <button
          className="btn btn-primary btn-big btn-block"
          disabled={!payload}
          onClick={() => sendTo(`https://wa.me/?text=${encodeURIComponent(payload || '')}`)}
        >
          WhatsApp
        </button>
        <button
          className="btn btn-big btn-block"
          disabled={!payload}
          onClick={() =>
            sendTo(
              `mailto:?subject=${encodeURIComponent(props.title || '')}&body=${encodeURIComponent(payload || '')}`,
            )
          }
        >
          {t('Почта')}
        </button>
        <button className="btn btn-big btn-block" disabled={!payload} onClick={openAndroidSheet}>
          {t('Другое приложение')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={props.onClose}>
          {t('Отмена')}
        </button>
      </div>
    </Dialog>
  );
}
