import { useEffect, useMemo, useState } from 'react';
import { api, FileInfo, FolderInfo } from './api';
import { Dialog, showToast } from './ui';
import { IconBack, IconCamera, IconCheck, IconChevron, IconFolder, IconPlus } from './icons';
import { displayName, fmtDuration } from './russian';
import { t } from './i18n';

/**
 * THE folder picker (P12): one shared component for moving files, saving
 * edited videos and picking a video to edit. Folders are a single flat level
 * (no nesting) — a plain list. Never drag-and-drop, never a path to type,
 * never a single tap that commits (8B): tap a folder to select it, then a
 * big labelled button confirms the destination.
 */

interface BaseProps {
  open: boolean;
  title: string;
  onClose: () => void;
  busy?: boolean;
}

interface FolderModeProps extends BaseProps {
  mode: 'folder';
  confirmLabel: (folderName: string) => string;
  /** Move dialogs pick an existing destination only — no «Новая папка» there. */
  allowCreateFolder?: boolean;
  onPickFolder: (folderId: string | null, folderName: string) => void;
}

interface VideoModeProps extends BaseProps {
  mode: 'video';
  onPickFile: (file: FileInfo) => void;
}

type PickerProps = FolderModeProps | VideoModeProps;

export function Picker(props: PickerProps) {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Video mode only: which folder's videos are being browsed. This is just
  // browsing a flat folder's contents, not folder nesting.
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [videos, setVideos] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const selectedFolder = selectedId ? byId.get(selectedId) || null : null;
  const openFolderName = openFolderId ? byId.get(openFolderId)?.name || '' : '';

  const loadFolders = async () => {
    try {
      const state = await api.get<{ folders: FolderInfo[] }>('/api/state');
      setFolders(state.folders);
    } catch {
      showToast(t('Не получилось загрузить папки.'));
    }
  };

  useEffect(() => {
    if (!props.open) return;
    setSelectedId(null);
    setOpenFolderId(null);
    setLoading(true);
    void loadFolders().then(() => setLoading(false));
  }, [props.open]);

  useEffect(() => {
    if (!props.open || props.mode !== 'video' || !openFolderId) {
      setVideos([]);
      return;
    }
    let cancelled = false;
    void api
      .get<{ files: FileInfo[] }>(`/api/edit/pickable?folderId=${openFolderId}`)
      .then(({ files }) => {
        if (!cancelled) setVideos(files);
      })
      .catch(() => {
        if (!cancelled) setVideos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.mode, openFolderId]);

  if (!props.open) return null;

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await api.post('/api/folders', { name });
      setNewFolderOpen(false);
      setNewFolderName('');
      await loadFolders();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось создать папку.'));
    }
  };

  const confirmPick = () => {
    if (props.mode !== 'folder' || !selectedFolder) return;
    props.onPickFolder(selectedFolder.id, selectedFolder.name);
  };

  const browsingVideos = props.mode === 'video' && openFolderId !== null;
  const showCreateFolder = props.mode !== 'folder' || props.allowCreateFolder !== false;

  return (
    <Dialog open full onClose={props.busy ? undefined : props.onClose}>
      <div className="row" style={{ marginBottom: 10 }}>
        {browsingVideos ? (
          <button
            className="btn btn-ghost"
            onClick={() => setOpenFolderId(null)}
            aria-label={t('Назад')}
            style={{ minWidth: 56 }}
          >
            <IconBack size={26} />
          </button>
        ) : null}
        <div className="grow">
          <h2>{props.title}</h2>
          <div className="muted small">
            {browsingVideos ? (
              <>
                {t('Папка:')} <b>{openFolderName}</b>
              </>
            ) : (
              t('Выберите папку')
            )}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={props.onClose} disabled={props.busy}>
          {t('Закрыть')}
        </button>
      </div>

      <div className="grow" style={{ overflowY: 'auto', margin: '0 -6px', padding: '0 6px' }}>
        {loading ? (
          <p className="muted center">{t('Загрузка…')}</p>
        ) : browsingVideos ? (
          <div className="list-wrap" style={{ boxShadow: 'none', border: `1px solid var(--line)` }}>
            {videos.map((file) => (
              <button key={file.id} className="list-row" onClick={() => (props as VideoModeProps).onPickFile(file)}>
                {file.hasThumb ? (
                  <img
                    src={`/api/thumb/${file.id}`}
                    alt=""
                    style={{ width: 64, height: 44, objectFit: 'cover', borderRadius: 8, flex: '0 0 auto' }}
                  />
                ) : (
                  <span style={{ width: 64, display: 'flex', justifyContent: 'center' }}>
                    <IconCamera size={26} />
                  </span>
                )}
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {displayName(file.name)}
                </span>
                <span className="muted small num">{fmtDuration(file.durationMs)}</span>
              </button>
            ))}
            {videos.length === 0 ? (
              <div style={{ padding: 20 }} className="muted center">
                {t('Здесь нет видео.')}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="list-wrap" style={{ boxShadow: 'none', border: `1px solid var(--line)` }}>
            {folders.map((folder) => (
              <button
                key={folder.id}
                className="list-row"
                style={
                  props.mode === 'folder' && selectedId === folder.id
                    ? { background: 'var(--accent-soft)', boxShadow: 'inset 0 0 0 3px var(--accent)' }
                    : undefined
                }
                onClick={() => (props.mode === 'video' ? setOpenFolderId(folder.id) : setSelectedId(folder.id))}
              >
                <IconFolder size={26} />
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {folder.name}
                </span>
                <span className="side-count num">{folder.fileCount || ''}</span>
                {props.mode === 'video' ? (
                  <IconChevron size={22} />
                ) : selectedId === folder.id ? (
                  <IconCheck size={22} />
                ) : null}
              </button>
            ))}
            {folders.length === 0 ? (
              <div style={{ padding: 20 }} className="muted center">
                {t('Папок пока нет.')}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="stack" style={{ marginTop: 14 }}>
        {showCreateFolder ? (
          <button className="btn btn-ghost" onClick={() => setNewFolderOpen(true)} disabled={props.busy}>
            <IconPlus size={22} /> {t('Новая папка')}
          </button>
        ) : null}
        {props.mode === 'folder' ? (
          selectedFolder ? (
            <button className="btn btn-primary btn-big btn-block" onClick={confirmPick} disabled={props.busy}>
              {props.busy ? t('Подождите…') : props.confirmLabel(selectedFolder.name)}
            </button>
          ) : (
            <p className="muted center" style={{ margin: '4px 2px 0' }}>
              {t('Выберите папку из списка.')}
            </p>
          )
        ) : null}
      </div>

      <Dialog open={newFolderOpen} title={t('Новая папка')} onClose={() => setNewFolderOpen(false)}>
        <input
          className="input"
          placeholder={t('Название папки')}
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          autoFocus
        />
        <div className="stack" style={{ marginTop: 16 }}>
          <button className="btn btn-primary btn-block" onClick={() => void createFolder()}>
            {t('Создать')}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setNewFolderOpen(false)}>
            {t('Отмена')}
          </button>
        </div>
      </Dialog>
    </Dialog>
  );
}
