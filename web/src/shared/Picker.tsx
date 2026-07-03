import { useEffect, useMemo, useState } from 'react';
import { api, FileInfo, FolderInfo } from './api';
import { ConfirmDialog, Dialog, showToast } from './ui';
import { IconBack, IconCamera, IconChevron, IconFolder, IconPlus } from './icons';
import { fmtDuration } from './russian';
import { t } from './i18n';

/**
 * THE folder picker (P12): one shared component for moving files, saving
 * edited videos and picking a video to edit. Tap into folders like WhatsApp
 * chats; a big labelled button confirms the destination. Never drag-and-drop,
 * never a path to type (8B).
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
  /** When set, an extra confirmation dialog appears (used for «Переместить»). */
  confirmQuestion?: (folderName: string) => string;
  onPickFolder: (folderId: string | null, folderName: string) => void;
}

interface VideoModeProps extends BaseProps {
  mode: 'video';
  onPickFile: (file: FileInfo) => void;
}

type PickerProps = FolderModeProps | VideoModeProps;

// Top level is not a folder she created — a file here just isn't in any folder.
const ROOT_NAME = 'Без папки';

export function Picker(props: PickerProps) {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [videos, setVideos] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const children = useMemo(
    () => folders.filter((f) => f.parentId === currentId),
    [folders, currentId]
  );
  const currentName = currentId ? byId.get(currentId)?.name || t(ROOT_NAME) : t(ROOT_NAME);

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
    setCurrentId(null);
    setConfirmOpen(false);
    setLoading(true);
    void loadFolders().then(() => setLoading(false));
  }, [props.open]);

  useEffect(() => {
    if (!props.open || props.mode !== 'video') return;
    let cancelled = false;
    void api
      .get<{ files: FileInfo[] }>(`/api/edit/pickable?folderId=${currentId || 'root'}`)
      .then(({ files }) => {
        if (!cancelled) setVideos(files);
      })
      .catch(() => {
        if (!cancelled) setVideos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.mode, currentId, folders]);

  if (!props.open) return null;

  const goUp = () => {
    const current = currentId ? byId.get(currentId) : null;
    setCurrentId(current ? current.parentId : null);
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await api.post('/api/folders', { name, parentId: currentId });
      setNewFolderOpen(false);
      setNewFolderName('');
      await loadFolders();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось создать папку.'));
    }
  };

  const pickHere = () => {
    if (props.mode !== 'folder') return;
    if (props.confirmQuestion) setConfirmOpen(true);
    else props.onPickFolder(currentId, currentName);
  };

  return (
    <Dialog open full onClose={props.busy ? undefined : props.onClose}>
      <div className="row" style={{ marginBottom: 10 }}>
        {currentId !== null ? (
          <button className="btn btn-ghost" onClick={goUp} aria-label={t('Назад')} style={{ minWidth: 56 }}>
            <IconBack size={26} />
          </button>
        ) : null}
        <div className="grow">
          <h2>{props.title}</h2>
          <div className="muted small">
            {currentId !== null ? (
              <>
                {t('Папка:')} <b>{currentName}</b>
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
        ) : (
          <div className="list-wrap" style={{ boxShadow: 'none', border: `1px solid var(--line)` }}>
            {children.map((folder) => (
              <button key={folder.id} className="list-row" onClick={() => setCurrentId(folder.id)}>
                <IconFolder size={26} />
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {folder.name}
                </span>
                <span className="side-count num">{folder.fileCount || ''}</span>
                <IconChevron size={22} />
              </button>
            ))}
            {props.mode === 'video'
              ? videos.map((file) => (
                  <button key={file.id} className="list-row" onClick={() => props.onPickFile(file)}>
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
                      {file.name}
                    </span>
                    <span className="muted small num">{fmtDuration(file.durationMs)}</span>
                  </button>
                ))
              : null}
            {children.length === 0 && (props.mode !== 'video' || videos.length === 0) ? (
              <div style={{ padding: 20 }} className="muted center">
                {props.mode === 'video' ? t('Здесь нет видео.') : t('Здесь нет вложенных папок.')}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {props.mode === 'folder' ? (
        <div className="stack" style={{ marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setNewFolderOpen(true)} disabled={props.busy}>
            <IconPlus size={22} /> {t('Новая папка')}
          </button>
          {/* Files always live in a folder — picking the top level isn't a valid destination. */}
          {currentId !== null ? (
            <button className="btn btn-primary btn-big btn-block" onClick={pickHere} disabled={props.busy}>
              {props.busy ? t('Подождите…') : props.confirmLabel(currentName)}
            </button>
          ) : (
            <p className="muted center" style={{ margin: '4px 2px 0' }}>
              {t('Откройте папку или создайте новую.')}
            </p>
          )}
        </div>
      ) : null}

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

      {props.mode === 'folder' && props.confirmQuestion ? (
        <ConfirmDialog
          open={confirmOpen}
          title={props.confirmQuestion(currentName)}
          confirmLabel={props.confirmLabel(currentName)}
          busy={props.busy}
          onConfirm={() => props.onPickFolder(currentId, currentName)}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}
