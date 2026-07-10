import { CSSProperties, useEffect, useState } from 'react';
import { api, FileInfo, PathPart } from '../shared/api';
import { ConfirmDialog, Dialog, copyText, showToast } from '../shared/ui';
import { Picker } from '../shared/Picker';
import { VideoPlayer } from '../shared/VideoPlayer';
import {
  IconBack,
  IconCheck,
  IconDownload,
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
        <div className="grow" style={{ overflow: 'hidden' }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName(file.name)}
          </div>
          <div className="small num" style={{ color: '#9CA3AF' }}>
            {details.join(' · ')}
          </div>
        </div>
      </div>

      <div
        style={{
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
        ) : file.kind === 'image' ? (
          <img src={mediaUrl} alt={file.name} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10 }} />
        ) : (
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
      </div>

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
        confirmQuestion={(name) => t('Переместить файл в «{name}»?', { name })}
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
