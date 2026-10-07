import { CSSProperties, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, FileInfo, PathPart } from '../shared/api';
import { ConfirmDialog, Dialog, copyText, showToast, useIsPhone } from '../shared/ui';
import { MenuItem, useMenu } from '../shared/ContextMenu';
import { Picker } from '../shared/Picker';
import { VideoPlayer } from '../shared/VideoPlayer';
import {
  IconBack,
  IconCheck,
  IconDownload,
  IconMore,
  IconMove,
  IconPencil,
  IconShare,
  IconTrash,
} from '../shared/icons';
import { displayName, fmtDate, fmtDuration, fmtSize } from '../shared/russian';
import { t } from '../shared/i18n';

/**
 * Full-screen file view (8B): normal playback + scrubbing, big «Поделиться»,
 * a back arrow, and forgiving secondary actions. Nothing destructive happens
 * without a confirmation.
 */
export function Viewer(props: {
  file: FileInfo;
  folderPath: PathPart[];
  onClose: () => void;
  onChanged: (updated?: FileInfo, movedToName?: string) => void;
  onDeleted: () => void;
}) {
  const { file } = props;
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isPhone = useIsPhone();
  const menu = useMenu();

  /*
   * The same four secondary actions, offered differently by device. On the
   * desktop they sit in a row under the file, where there is room for them.
   * On her phone that row became eight lines of stacked, broken-up words
   * («Пере / мест / ить») filling half the screen under the video — so there
   * they move behind the ⋯ handle instead, exactly like the one on every file
   * row in the list she just came from (P4: one pattern, learned once).
   */
  const secondaryActions = (): MenuItem[] => [
    {
      label: t('Скачать'),
      icon: <IconDownload size={20} />,
      // Content-Disposition is attachment, so this downloads without
      // navigating the viewer away.
      onClick: () => {
        window.location.href = `/api/download/${file.id}`;
      },
    },
    { label: t('Переместить'), icon: <IconMove size={20} />, onClick: () => setMoveOpen(true) },
    { label: t('Переименовать'), icon: <IconPencil size={20} />, onClick: () => setRenameOpen(true) },
    { label: t('Удалить'), icon: <IconTrash size={20} />, danger: true, onClick: () => setDeleteOpen(true) },
  ];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const doMove = async (folderId: string | null, folderName: string) => {
    setBusy(true);
    try {
      const res = await api.patch<{ file: FileInfo }>(`/api/files/${file.id}`, { folderId });
      setMoveOpen(false);
      setMovedTo(folderName);
      props.onChanged(res.file, folderName);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось переместить.'));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.del(`/api/files/${file.id}`);
      setDeleteOpen(false);
      props.onDeleted();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось удалить.'));
      setBusy(false);
    }
  };

  const mediaUrl = `/api/media/${file.id}`;
  const details: string[] = [];
  if (file.durationMs) details.push(fmtDuration(file.durationMs));
  details.push(fmtSize(file.size));
  details.push(fmtDate(file.createdAt));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: '#10141C',
        color: '#F3F4F6',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="row" style={{ padding: '8px 12px', gap: 10 }}>
        <button
          className="btn btn-compact"
          style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', boxShadow: 'none', minWidth: 56 }}
          onClick={props.onClose}
          aria-label={t('Назад')}
        >
          <IconBack size={24} />
        </button>
        <div className="grow">
          <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
            {displayName(file.name)}
          </div>
          <div className="small num" style={{ color: '#9CA3AF' }}>
            {details.join(' · ')}
          </div>
        </div>
        {isPhone ? (
          <button
            className="btn btn-compact"
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', boxShadow: 'none', minWidth: 48, padding: '8px 10px' }}
            onClick={(e) => menu.openFromButton(e, secondaryActions())}
            aria-label={t('Действия')}
          >
            <IconMore size={24} />
          </button>
        ) : null}
      </div>

      <div
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 8px',
        }}
      >
        {file.kind === 'video' || file.kind === 'audio' ? (
          <VideoPlayer
            fill
            kind={file.kind}
            src={mediaUrl}
            poster={file.kind === 'video' && file.hasThumb ? `/api/thumb/${file.id}` : undefined}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', borderRadius: 10 }}
          />
        ) : null}
        {file.kind === 'video' ? (
          // She's used to WhatsApp, where closing a played file means tapping
          // the bottom-right corner — this sits alongside (not instead of)
          // the top-left back button, same action either way. Held clear of
          // VideoPlayer's own bottom control bar so the two never overlap.
          <button
            className="btn btn-compact"
            style={{
              position: 'absolute',
              right: 18,
              bottom: 70,
              width: 52,
              height: 52,
              minWidth: 0,
              padding: 0,
              borderRadius: '50%',
              background: 'rgba(20,20,20,0.55)',
              border: '2px solid rgba(255,255,255,0.85)',
              color: '#fff',
              boxShadow: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={props.onClose}
            aria-label={t('Назад')}
          >
            <IconBack size={26} />
          </button>
        ) : null}
        {file.kind === 'image' ? (
          <ZoomableImage src={mediaUrl} alt={file.name} />
        ) : file.kind === 'video' || file.kind === 'audio' ? null : (
          <div className="center">
            <p>{t('Этот файл нельзя показать здесь.')}</p>
            <a className="btn btn-primary btn-big" href={`/api/download/${file.id}`}>
              <IconDownload size={24} /> {t('Скачать файл')}
            </a>
          </div>
        )}
      </div>

      {movedTo ? (
        <div style={{ padding: '0 14px' }}>
          <div className="card row" style={{ background: '#173B26', color: '#D9F3E1', boxShadow: 'none' }}>
            <IconCheck size={24} />
            <div className="grow">{t('Файл теперь в папке «{name}»', { name: movedTo })}</div>
          </div>
        </div>
      ) : null}

      <div style={{ padding: '8px 10px 10px' }} className="stack" >
        <button className="btn btn-primary btn-block" onClick={() => setShareOpen(true)}>
          <IconShare size={20} /> {t('Поделиться')}
        </button>
        {isPhone ? null : (
          <div className="row-wrap" style={{ gap: 8 }}>
            <a className="btn btn-compact grow" style={darkBtn} href={`/api/download/${file.id}`}>
              <IconDownload size={18} /> {t('Скачать')}
            </a>
            <button className="btn btn-compact grow" style={darkBtn} onClick={() => setMoveOpen(true)}>
              <IconMove size={18} /> {t('Переместить')}
            </button>
            <button className="btn btn-compact grow" style={darkBtn} onClick={() => setRenameOpen(true)}>
              <IconPencil size={18} /> {t('Переименовать')}
            </button>
            <button className="btn btn-compact grow" style={{ ...darkBtn, color: '#FCA5A5' }} onClick={() => setDeleteOpen(true)}>
              <IconTrash size={18} /> {t('Удалить')}
            </button>
          </div>
        )}
      </div>

      {menu.menu}

      <ShareDialog file={file} open={shareOpen} onClose={() => setShareOpen(false)} />

      <RenameDialog
        open={renameOpen}
        file={file}
        onClose={() => setRenameOpen(false)}
        onRenamed={(updated) => {
          setRenameOpen(false);
          props.onChanged(updated);
        }}
      />

      <Picker
        mode="folder"
        open={moveOpen}
        title={t('Куда переместить файл?')}
        busy={busy}
        confirmLabel={(name) => t('Переместить в «{name}»', { name })}
        allowCreateFolder={false}
        onClose={() => setMoveOpen(false)}
        onPickFolder={(folderId, folderName) => void doMove(folderId, folderName)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={t('Удалить файл?')}
        body={<span>{t('«{name}» будет удалён.', { name: displayName(file.name) })}</span>}
        confirmLabel={t('Удалить')}
        danger
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

/**
 * Photo view with plain scroll-wheel zoom — no Ctrl held down: on her
 * Windows laptop the wheel alone zooms, the way a photo is expected to
 * behave everywhere else. The wheel listener is attached by hand (not via
 * onWheel) because React registers wheel handlers as passive, where
 * preventDefault is ignored and the page would scroll underneath instead.
 * Once zoomed she can drag the photo to look around, and one big Russian
 * button puts it back to normal size.
 */
const MAX_ZOOM = 6;

function ZoomableImage(props: { src: string; alt: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // A different photo always opens at normal size.
  useEffect(() => reset(), [props.src, reset]);

  /** Keeps the photo from being dragged or zoomed off into empty space. */
  const clamp = useCallback((x: number, y: number, z: number) => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return { x, y };
    // offsetWidth/Height are the laid-out size, unaffected by the transform.
    const maxX = Math.max(0, (img.offsetWidth * z - box.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * z - box.clientHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // deltaMode 1 means the browser is reporting lines, not pixels.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const step = Math.min(2, Math.max(0.5, Math.exp(-delta * 0.0015)));
      const rect = box.getBoundingClientRect();
      // Pointer position relative to the centre of the photo area, so the
      // spot under the cursor stays under the cursor while zooming.
      const px = e.clientX - (rect.left + rect.width / 2);
      const py = e.clientY - (rect.top + rect.height / 2);
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, z * step));
        if (next === z) return z;
        const k = next / z;
        setOffset((o) =>
          next === 1
            ? { x: 0, y: 0 }
            : clamp(px * (1 - k) + k * o.x, py * (1 - k) + k * o.y, next),
        );
        return next;
      });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [clamp]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom === 1) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    setOffset((o) => clamp(o.x + dx, o.y + dy, zoom));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current && drag.current.id === e.pointerId) drag.current = null;
  };

  return (
    <div
      ref={boxRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Only take over the touch gestures once she has zoomed in, so the
        // phone keeps its own familiar pinch-zoom at normal size.
        touchAction: zoom > 1 ? 'none' : 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={reset}
    >
      <img
        ref={imgRef}
        src={props.src}
        alt={props.alt}
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          borderRadius: 10,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          cursor: zoom > 1 ? 'move' : 'default',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      />
      {zoom > 1 ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 12,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <button
            className="btn btn-compact"
            style={{
              background: 'rgba(20,20,20,0.7)',
              border: '2px solid rgba(255,255,255,0.85)',
              color: '#fff',
              boxShadow: 'none',
            }}
            onClick={reset}
          >
            {t('Обычный размер')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const darkBtn: CSSProperties = {
  background: '#2A3242',
  color: '#fff',
  boxShadow: 'none',
  flexBasis: '44%',
  minWidth: 0,
  fontSize: 17,
  padding: '8px 14px',
};

export function RenameDialog(props: {
  open: boolean;
  file: FileInfo;
  onClose: () => void;
  onRenamed: (updated: FileInfo) => void;
}) {
  const [name, setName] = useState(() => displayName(props.file.name));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.open) setName(displayName(props.file.name));
  }, [props.open, props.file.name]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await api.patch<{ file: FileInfo }>(`/api/files/${props.file.id}`, { name: trimmed });
      props.onRenamed(res.file);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось переименовать.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} title={t('Переименовать файл')} onClose={busy ? undefined : props.onClose}>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn btn-primary btn-big btn-block" onClick={() => void save()} disabled={busy}>
          {busy ? t('Подождите…') : t('Сохранить')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={props.onClose} disabled={busy}>
          {t('Отмена')}
        </button>
      </div>
    </Dialog>
  );
}

/** Section 7: one permanent link per file; creating copies it for WhatsApp. */
export function ShareDialog(props: { file: FileInfo; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setUrl(null);
    setCopied(false);
    void api
      .get<{ shareToken: string | null }>(`/api/files/${props.file.id}`)
      .then(({ shareToken }) => {
        if (shareToken) setUrl(`${window.location.origin}/s/${shareToken}`);
      })
      .catch(() => { /* dialog still lets her create one */ });
  }, [props.open, props.file.id]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`/api/files/${props.file.id}/share`);
      setUrl(res.url);
      const ok = await copyText(res.url);
      if (ok) {
        setCopied(true);
        showToast(t('Ссылка скопирована'));
      }
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось создать ссылку.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      showToast(t('Ссылка скопирована'));
      window.setTimeout(() => setCopied(false), 2500);
    } else {
      showToast(t('Не получилось скопировать. Выделите ссылку пальцем.'));
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.del(`/api/files/${props.file.id}/share`);
      setUrl(null);
      setRevokeOpen(false);
      showToast(t('Ссылка удалена'));
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось удалить ссылку.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} title={t('Поделиться')} onClose={busy ? undefined : props.onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('Постоянная ссылка на этот файл. Отправьте её в WhatsApp — человек увидит только этот один файл.')}
      </p>
      {url ? (
        <div className="stack">
          <div
            className="card num"
            style={{ boxShadow: 'none', border: '1px solid var(--line)', fontSize: 15, wordBreak: 'break-all', userSelect: 'all' }}
          >
            {url}
          </div>
          <button className="btn btn-primary btn-big btn-block" onClick={() => void copy()}>
            {copied ? t('Скопировано') : t('Скопировать ссылку')}
          </button>
          <button className="btn btn-ghost btn-compact" onClick={() => setRevokeOpen(true)} disabled={busy}>
            {t('Удалить ссылку')}
          </button>
          <button className="btn btn-ghost btn-block" onClick={props.onClose}>
            {t('Закрыть')}
          </button>
        </div>
      ) : (
        <div className="stack">
          <button className="btn btn-primary btn-big btn-block" onClick={() => void create()} disabled={busy}>
            {busy ? t('Создаём…') : t('Создать постоянную ссылку')}
          </button>
          <button className="btn btn-ghost btn-block" onClick={props.onClose} disabled={busy}>
            {t('Отмена')}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={revokeOpen}
        title={t('Удалить ссылку?')}
        body={t('Ссылка перестанет открываться у всех, кому вы её отправляли. Сам файл останется.')}
        confirmLabel={t('Удалить ссылку')}
        danger
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setRevokeOpen(false)}
      />
    </Dialog>
  );
}
