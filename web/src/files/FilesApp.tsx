import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  FileInfo,
  FolderInfo,
  LARGE_FILE_THRESHOLD,
  PathPart,
  StorageState,
  uploadLarge,
  uploadWithProgress,
} from '../shared/api';
import { ConfirmDialog, Dialog, ProgressBar, showToast, TopBar, useIsPhone } from '../shared/ui';
import { Picker } from '../shared/Picker';
import { MenuItem, useMenu } from '../shared/ContextMenu';
import {
  IconCamera,
  IconDownload,
  IconFile,
  IconFolder,
  IconMore,
  IconMove,
  IconNote,
  IconPencil,
  IconPlus,
  IconSearch,
  IconShare,
  IconTrash,
  IconUpload,
  IconX,
} from '../shared/icons';
import { displayName, fmtDuration, fmtSize } from '../shared/russian';
import { t } from '../shared/i18n';
import { RenameDialog, ShareDialog, Viewer } from './Viewer';

// Folders are a single flat level (no nesting for now — see master-prompt P4
// "familiar patterns"; nesting can be re-enabled later). There is no "Home" /
// "All files" folder: the top level is just where loose files and folders sit.

interface SearchResult {
  file: FileInfo;
  folderPath: PathPart[];
}

export function FilesApp() {
  const isPhone = useIsPhone();
  const menu = useMenu();
  const [state, setState] = useState<StorageState>({ folders: [], rootFileCount: 0 });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [viewer, setViewer] = useState<FileInfo | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [highlightFileId, setHighlightFileId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const [upload, setUpload] = useState<{ names: string[]; progress: number } | null>(null);
  const uploadAbort = useRef<(() => void) | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameFolderTarget, setRenameFolderTarget] = useState<FolderInfo | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<FolderInfo | null>(null);

  // File operations reachable straight from a card's menu (no need to open it).
  const [renameFileTarget, setRenameFileTarget] = useState<FileInfo | null>(null);
  const [moveFileTarget, setMoveFileTarget] = useState<FileInfo | null>(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState<FileInfo | null>(null);
  const [shareFileTarget, setShareFileTarget] = useState<FileInfo | null>(null);

  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(state.folders.map((f) => [f.id, f])), [state.folders]);
  const currentFolder = currentId ? byId.get(currentId) || null : null;

  const loadState = useCallback(async () => {
    try {
      setState(await api.get<StorageState>('/api/state'));
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось загрузить папки.'));
    }
  }, []);

  const loadFiles = useCallback(async (folderId: string) => {
    setLoadingFiles(true);
    try {
      const res = await api.get<{ files: FileInfo[] }>(`/api/folders/${folderId}/files`);
      setFiles(res.files);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось загрузить файлы.'));
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const reload = useCallback(() => {
    if (currentId !== null) void loadFiles(currentId);
    void loadState();
  }, [currentId, loadFiles, loadState]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // No folder selected → nothing is browsed or shown; she can only ever see
  // files after picking a real folder (never a loose top-level file list).
  useEffect(() => {
    if (currentId === null) {
      setFiles([]);
      setLoadingFiles(false);
      return;
    }
    void loadFiles(currentId);
  }, [currentId, loadFiles]);

  // Once the target folder's files finish loading, scroll the highlighted
  // search result into view.
  useEffect(() => {
    if (!highlightFileId || loadingFiles) return;
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightFileId, loadingFiles]);

  // Typo-tolerant search, debounced.
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query.trim())}`);
        setResults(res.results);
      } catch { /* keep previous results */ }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const openFolder = (id: string | null) => {
    setCurrentId(id);
    setSearchOpen(false);
    setQuery('');
  };

  const openSearchResult = (file: FileInfo) => {
    openFolder(file.folderId);
    setHighlightFileId(file.id);
    window.setTimeout(() => setHighlightFileId(null), 4000);
  };

  // Only ever called while a real folder is open — the upload button is
  // hidden whenever no folder is selected (see render below).
  const startUpload = (list: FileList) => {
    if (currentId === null) return;
    const folderId = currentId;
    const filesArr = Array.from(list);
    if (filesArr.length === 0) return;

    // Cloudflare Tunnel caps a single request at ~100MB. Files at or over
    // that go up individually in chunks; smaller ones are still grouped
    // into one request each, but only as many as fit under the cap together.
    const batches: File[][] = [];
    let current: File[] = [];
    let currentBytes = 0;
    for (const f of filesArr) {
      if (f.size >= LARGE_FILE_THRESHOLD) {
        if (current.length) batches.push(current);
        batches.push([f]);
        current = [];
        currentBytes = 0;
        continue;
      }
      if (current.length && currentBytes + f.size >= LARGE_FILE_THRESHOLD) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(f);
      currentBytes += f.size;
    }
    if (current.length) batches.push(current);

    const totalBytes = filesArr.reduce((sum, f) => sum + f.size, 0) || 1;
    setUpload({ names: filesArr.map((f) => f.name), progress: 0 });

    let cancelled = false;
    let abortCurrentBatch: (() => void) | null = null;
    uploadAbort.current = () => {
      cancelled = true;
      abortCurrentBatch?.();
    };

    void (async () => {
      let bytesDone = 0;
      const allResults: FileInfo[] = [];
      try {
        for (const batch of batches) {
          if (cancelled) break;
          const batchBytes = batch.reduce((sum, f) => sum + f.size, 0);
          const onBatchProgress = (fraction: number) => {
            const done = bytesDone + fraction * batchBytes;
            setUpload((u) => (u ? { ...u, progress: done / totalBytes } : u));
          };
          let handle;
          if (batch.length === 1 && batch[0].size >= LARGE_FILE_THRESHOLD) {
            handle = uploadLarge(`/api/upload/chunked?folderId=${folderId}`, batch[0], onBatchProgress);
          } else {
            const form = new FormData();
            for (const f of batch) form.append('files', f, f.name);
            handle = uploadWithProgress(`/api/upload?folderId=${folderId}`, form, onBatchProgress);
          }
          abortCurrentBatch = handle.abort;
          const data = (await handle.promise) as { files: FileInfo[] };
          allResults.push(...(data.files || []));
          bytesDone += batchBytes;
        }
        setUpload(null);
        if (!cancelled) {
          showToast(allResults.length === 1 ? t('Файл загружен') : t('Загружено файлов: {n}', { n: allResults.length }));
        }
        await Promise.all([loadFiles(folderId), loadState()]);
      } catch (e) {
        setUpload(null);
        showToast(e instanceof Error ? t(e.message) : t('Не получилось загрузить.'));
        void loadFiles(folderId);
      }
    })();
  };

  // ---- folder operations (flat: create at top level; no move) ----

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const folder = await api.post<FolderInfo>('/api/folders', { name });
      setNewFolderOpen(false);
      setNewFolderName('');
      await loadState();
      openFolder(folder.id);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось создать папку.'));
    } finally {
      setBusy(false);
    }
  };

  const renameFolder = async () => {
    if (!renameFolderTarget) return;
    const name = renameFolderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.patch(`/api/folders/${renameFolderTarget.id}`, { name });
      setRenameFolderTarget(null);
      await loadState();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось переименовать.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async () => {
    if (!deleteFolderTarget) return;
    setBusy(true);
    try {
      const wasCurrent = currentId === deleteFolderTarget.id;
      await api.del(`/api/folders/${deleteFolderTarget.id}`);
      setDeleteFolderTarget(null);
      if (wasCurrent) openFolder(null);
      await loadState();
      showToast(t('Папка удалена'));
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось удалить папку.'));
    } finally {
      setBusy(false);
    }
  };

  // ---- file operations ----

  const downloadFile = (file: FileInfo) => {
    const a = document.createElement('a');
    a.href = `/api/download/${file.id}`;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const doMoveFile = async (folderId: string | null) => {
    if (!moveFileTarget) return;
    setBusy(true);
    try {
      await api.patch(`/api/files/${moveFileTarget.id}`, { folderId });
      const destName = folderId ? byId.get(folderId)?.name || '' : null;
      setMoveFileTarget(null);
      showToast(destName ? t('Файл теперь в папке «{name}»', { name: destName }) : t('Файл перемещён'));
      reload();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось переместить.'));
    } finally {
      setBusy(false);
    }
  };

  const doDeleteFile = async () => {
    if (!deleteFileTarget) return;
    setBusy(true);
    try {
      await api.del(`/api/files/${deleteFileTarget.id}`);
      setDeleteFileTarget(null);
      showToast(t('Файл удалён'));
      reload();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось удалить.'));
    } finally {
      setBusy(false);
    }
  };

  const startRenameFolder = (folder: FolderInfo) => {
    setRenameFolderName(folder.name);
    setRenameFolderTarget(folder);
  };

  // ---- context-menu item sets ----

  const folderMenuItems = (folder: FolderInfo): MenuItem[] => [
    { label: t('Открыть'), icon: <IconFolder size={22} />, onClick: () => openFolder(folder.id) },
    { label: t('Переименовать'), icon: <IconPencil size={22} />, onClick: () => startRenameFolder(folder) },
    { label: t('Удалить'), danger: true, icon: <IconTrash size={22} />, onClick: () => setDeleteFolderTarget(folder) },
  ];

  const fileMenuItems = (file: FileInfo): MenuItem[] => [
    { label: t('Открыть'), icon: <IconFile size={22} />, onClick: () => setViewer(file) },
    { label: t('Поделиться'), icon: <IconShare size={22} />, onClick: () => setShareFileTarget(file) },
    { label: t('Переместить'), icon: <IconMove size={22} />, onClick: () => setMoveFileTarget(file) },
    { label: t('Переименовать'), icon: <IconPencil size={22} />, onClick: () => setRenameFileTarget(file) },
    { label: t('Скачать'), icon: <IconDownload size={22} />, onClick: () => downloadFile(file) },
    { label: t('Удалить'), danger: true, icon: <IconTrash size={22} />, onClick: () => setDeleteFileTarget(file) },
  ];

  const searchActive = query.trim().length > 0;

  // ---- reusable pieces ----

  const searchBox = (
    <div className="row" style={{ marginBottom: 14 }}>
      <div className="grow" style={{ position: 'relative' }}>
        <input
          className="input"
          placeholder={t('Найти файл по названию…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingRight: 52 }}
        />
        {query ? (
          <button
            onClick={() => setQuery('')}
            aria-label={t('Очистить')}
            style={{
              position: 'absolute',
              right: 6,
              top: 6,
              bottom: 6,
              width: 44,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--muted)',
            }}
          >
            <IconX size={22} />
          </button>
        ) : null}
      </div>
    </div>
  );

  const kindIcon = (file: FileInfo, size: number) =>
    file.kind === 'video' ? <IconCamera size={size} /> : file.kind === 'audio' ? <IconNote size={size} /> : <IconFile size={size} />;

  const fileCard = (file: FileInfo) => (
    <div
      key={file.id}
      ref={file.id === highlightFileId ? highlightRef : undefined}
      className={file.id === highlightFileId ? 'file-card highlight' : 'file-card'}
      role="button"
      tabIndex={0}
      onClick={() => setViewer(file)}
      onContextMenu={(e) => menu.openFromEvent(e, fileMenuItems(file))}
    >
      <div style={{ position: 'relative' }}>
        {file.hasThumb ? (
          <img className="file-thumb" src={`/api/thumb/${file.id}`} alt="" loading="lazy" />
        ) : (
          <div className="file-thumb-placeholder">{kindIcon(file, 38)}</div>
        )}
        <button
          className="row-menu-btn card-menu-btn"
          aria-label={t('Действия')}
          onClick={(e) => menu.openFromButton(e, fileMenuItems(file))}
        >
          <IconMore size={22} />
        </button>
      </div>
      <div className="file-name">{displayName(file.name)}</div>
      <div className="muted small num">
        {file.durationMs ? `${fmtDuration(file.durationMs)} · ` : ''}
        {fmtSize(file.size)}
      </div>
    </div>
  );

  const searchResults = (
    <div className="list-wrap swap-enter">
      {(results || []).map(({ file, folderPath }) => (
        <div
          key={file.id}
          className="list-row"
          role="button"
          tabIndex={0}
          onClick={() => openSearchResult(file)}
          onContextMenu={(e) => menu.openFromEvent(e, fileMenuItems(file))}
        >
          {file.hasThumb ? (
            <img src={`/api/thumb/${file.id}`} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, flex: '0 0 auto' }} />
          ) : (
            <span style={{ width: 64, display: 'flex', justifyContent: 'center', flex: '0 0 auto' }}>{kindIcon(file, 28)}</span>
          )}
          <span className="grow">
            <span style={{ display: 'block', fontWeight: 600, wordBreak: 'break-word' }}>
              {displayName(file.name)}
            </span>
            <span className="muted small">{folderPath.length ? folderPath[folderPath.length - 1].name : t('Файлы')}</span>
          </span>
          <button className="row-menu-btn" aria-label={t('Действия')} onClick={(e) => menu.openFromButton(e, fileMenuItems(file))}>
            <IconMore size={22} />
          </button>
        </div>
      ))}
      {results !== null && results.length === 0 ? (
        <div style={{ padding: 20 }} className="muted center">
          {t('Ничего не нашлось. Попробуйте написать по-другому.')}
        </div>
      ) : null}
    </div>
  );

  // Only rendered while a real folder is open.
  const contentGrid = loadingFiles ? (
    <p className="muted center" style={{ padding: 24 }}>{t('Загрузка…')}</p>
  ) : files.length === 0 ? (
    <div className="card center" style={{ padding: 28 }}>
      <p style={{ marginTop: 0 }}>{t('Здесь пока пусто.')}</p>
      <p className="muted">{t('Нажмите «Загрузить файлы», чтобы добавить сюда фото, видео или музыку.')}</p>
    </div>
  ) : (
    <div className="file-grid">{files.map(fileCard)}</div>
  );

  // No folders exist anywhere yet — she must create one before she can save
  // anything (files always live in a folder).
  const noFoldersPrompt = (
    <div className="card center" style={{ padding: 32 }}>
      <IconFolder size={44} />
      <p style={{ marginTop: 14, fontSize: 20 }}>{t('У вас пока нет папок.')}</p>
      <p className="muted">{t('Создайте папку, чтобы сохранять туда файлы.')}</p>
      <button
        className="btn btn-primary btn-big"
        style={{ marginTop: 10 }}
        onClick={() => { setNewFolderName(''); setNewFolderOpen(true); }}
      >
        <IconPlus size={22} /> {t('Создать папку')}
      </button>
    </div>
  );

  // Folders exist, but none is open — desktop shows this in the main pane;
  // on the phone the folder list itself serves as the picker (no separate text).
  const chooseFolderPrompt = (
    <div className="card center" style={{ padding: 32 }}>
      <IconFolder size={44} />
      <p style={{ marginTop: 14, fontSize: 20 }}>{t('Выберите папку')}</p>
      <p className="muted">{t('Слева выберите папку, чтобы увидеть файлы.')}</p>
    </div>
  );

  const uploadPanel = upload ? (
    <div
      className="card"
      style={{ position: 'fixed', left: 14, right: 14, bottom: 96, zIndex: 60, maxWidth: 560, margin: '0 auto' }}
    >
      <div className="row" style={{ marginBottom: 8 }}>
        <b className="grow">
          {upload.names.length === 1 ? t('Загружаем файл…') : t('Загружаем файлы ({n})…', { n: upload.names.length })}
        </b>
        <button className="btn btn-ghost btn-compact" onClick={() => uploadAbort.current?.()}>
          {t('Отменить')}
        </button>
      </div>
      <ProgressBar value={upload.progress} />
      <div className="muted small num" style={{ marginTop: 6 }}>{Math.round(upload.progress * 100)}%</div>
    </div>
  ) : null;

  const hiddenInput = (
    <input
      ref={uploadInput}
      type="file"
      multiple
      style={{ display: 'none' }}
      onChange={(e) => {
        if (e.target.files) startUpload(e.target.files);
        e.target.value = '';
      }}
    />
  );

  const folderRow = (folder: FolderInfo, variant: 'side' | 'list') => (
    <div
      key={folder.id}
      className={variant === 'side' ? `side-row${currentId === folder.id ? ' active' : ''}` : 'list-row'}
      role="button"
      tabIndex={0}
      onClick={() => openFolder(folder.id)}
      onContextMenu={(e) => menu.openFromEvent(e, folderMenuItems(folder))}
    >
      <IconFolder size={variant === 'side' ? 24 : 28} />
      <span className="grow" style={{ wordBreak: 'break-word' }}>
        {folder.name}
      </span>
      <span className="side-count num">{folder.fileCount || ''}</span>
      <button
        className="row-menu-btn"
        aria-label={t('Действия с папкой')}
        onClick={(e) => menu.openFromButton(e, folderMenuItems(folder))}
      >
        <IconMore size={22} />
      </button>
    </div>
  );

  /* ---------------- Phone: folders + files, one level deep ---------------- */
  if (isPhone) {
    return (
      <div className="page">
        <TopBar
          title={searchActive ? t('Поиск') : currentFolder ? currentFolder.name : t('Файлы')}
          onBack={
            searchActive
              ? () => { setQuery(''); setSearchOpen(false); }
              : currentId !== null
                ? () => openFolder(null)
                : undefined
          }
          right={
            !searchOpen && state.folders.length > 0 ? (
              <button className="btn btn-ghost" style={{ minWidth: 56 }} aria-label={t('Поиск')} onClick={() => setSearchOpen(true)}>
                <IconSearch size={24} />
              </button>
            ) : null
          }
        />
        {searchOpen ? searchBox : null}
        {searchActive ? (
          searchResults
        ) : currentId === null ? (
          state.folders.length === 0 ? (
            noFoldersPrompt
          ) : (
            <div className="list-wrap" style={{ marginBottom: 16 }}>
              {state.folders.map((folder) => folderRow(folder, 'list'))}
            </div>
          )
        ) : (
          contentGrid
        )}
        {!searchActive ? (
          <div className="bottombar">
            {currentId !== null ? (
              <button className="btn btn-primary btn-big" onClick={() => uploadInput.current?.click()}>
                <IconUpload size={24} /> {t('Загрузить файлы')}
              </button>
            ) : null}
            <button
              className={`btn btn-big${currentId === null ? ' btn-primary' : ''}`}
              onClick={() => { setNewFolderName(''); setNewFolderOpen(true); }}
              aria-label={t('Новая папка')}
            >
              <IconPlus size={24} />
              {currentId === null ? <>&nbsp;{t('Новая папка')}</> : null}
            </button>
          </div>
        ) : null}
        {hiddenInput}
        {uploadPanel}
        {dialogs()}
      </div>
    );
  }

  /* ---------------- Desktop: flat sidebar + contents (WhatsApp model, P4) ---------------- */
  return (
    <div className="page" style={{ maxWidth: 1280 }}>
      <TopBar title={t('Файлы')} />
      <div className="split">
        <aside className="sidebar">
          {state.folders.map((folder) => folderRow(folder, 'side'))}
          <div style={{ padding: '10px 12px 4px' }}>
            <button className="btn btn-ghost btn-block" onClick={() => { setNewFolderName(''); setNewFolderOpen(true); }}>
              <IconPlus size={22} /> {t('Новая папка')}
            </button>
          </div>
        </aside>
        <main className="grow" style={{ minWidth: 0 }}>
          {state.folders.length > 0 ? searchBox : null}
          {searchActive ? (
            searchResults
          ) : currentId === null ? (
            state.folders.length === 0 ? noFoldersPrompt : chooseFolderPrompt
          ) : (
            <>
              <div className="row" style={{ marginBottom: 14 }}>
                <h2 className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentFolder?.name}
                </h2>
                <button className="btn btn-primary" onClick={() => uploadInput.current?.click()}>
                  <IconUpload size={22} /> {t('Загрузить файлы')}
                </button>
              </div>
              {contentGrid}
            </>
          )}
        </main>
      </div>
      {hiddenInput}
      {uploadPanel}
      {dialogs()}
    </div>
  );

  function dialogs() {
    return (
      <>
        {menu.menu}

        {viewer ? (
          <Viewer
            file={viewer}
            folderPath={
              viewer.folderId && byId.get(viewer.folderId)
                ? [{ id: viewer.folderId, name: byId.get(viewer.folderId)!.name }]
                : []
            }
            onClose={() => {
              setViewer(null);
              reload();
            }}
            onChanged={(updated) => {
              if (updated) setViewer(updated);
              reload();
            }}
            onDeleted={() => {
              setViewer(null);
              showToast(t('Файл удалён'));
              reload();
            }}
          />
        ) : null}

        <Dialog open={newFolderOpen} title={t('Новая папка')} onClose={busy ? undefined : () => setNewFolderOpen(false)}>
          <input
            className="input"
            placeholder={t('Название папки')}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            autoFocus
          />
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="btn btn-primary btn-big btn-block" onClick={() => void createFolder()} disabled={busy}>
              {t('Создать папку')}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setNewFolderOpen(false)} disabled={busy}>
              {t('Отмена')}
            </button>
          </div>
        </Dialog>

        <Dialog
          open={!!renameFolderTarget}
          title={t('Переименовать папку')}
          onClose={busy ? undefined : () => setRenameFolderTarget(null)}
        >
          <input className="input" value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)} autoFocus />
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="btn btn-primary btn-big btn-block" onClick={() => void renameFolder()} disabled={busy}>
              {t('Сохранить')}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setRenameFolderTarget(null)} disabled={busy}>
              {t('Отмена')}
            </button>
          </div>
        </Dialog>

        <ConfirmDialog
          open={!!deleteFolderTarget}
          title={t('Удалить папку «{name}»?', { name: deleteFolderTarget?.name || '' })}
          body={
            deleteFolderTarget && deleteFolderTarget.fileCount > 0 ? (
              <span>{t('В ней файлов: {n}. Они тоже будут удалены.', { n: deleteFolderTarget.fileCount })}</span>
            ) : (
              <span>{t('Папка пустая.')}</span>
            )
          }
          confirmLabel={t('Удалить папку')}
          danger
          busy={busy}
          onConfirm={() => void deleteFolder()}
          onCancel={() => setDeleteFolderTarget(null)}
        />

        {/* File operations straight from a card's menu */}
        {renameFileTarget ? (
          <RenameDialog
            open
            file={renameFileTarget}
            onClose={() => setRenameFileTarget(null)}
            onRenamed={() => {
              setRenameFileTarget(null);
              reload();
            }}
          />
        ) : null}

        {shareFileTarget ? (
          <ShareDialog file={shareFileTarget} open onClose={() => setShareFileTarget(null)} />
        ) : null}

        {moveFileTarget ? (
          <Picker
            mode="folder"
            open
            title={t('Куда переместить файл?')}
            busy={busy}
            confirmLabel={(name) => t('Переместить в «{name}»', { name })}
            confirmQuestion={(name) => t('Переместить файл в «{name}»?', { name })}
            allowCreateFolder={false}
            onClose={() => setMoveFileTarget(null)}
            onPickFolder={(folderId) => void doMoveFile(folderId)}
          />
        ) : null}

        <ConfirmDialog
          open={!!deleteFileTarget}
          title={t('Удалить файл?')}
          body={deleteFileTarget ? <span>{t('«{name}» будет удалён.', { name: displayName(deleteFileTarget.name) })}</span> : null}
          confirmLabel={t('Удалить')}
          danger
          busy={busy}
          onConfirm={() => void doDeleteFile()}
          onCancel={() => setDeleteFileTarget(null)}
        />
      </>
    );
  }
}
