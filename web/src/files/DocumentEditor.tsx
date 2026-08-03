import { ChangeEvent, ClipboardEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, FileInfo } from '../shared/api';
import { ConfirmDialog, Dialog, showToast } from '../shared/ui';
import { Picker } from '../shared/Picker';
import { MenuItem, useMenu } from '../shared/ContextMenu';
import {
  IconBack,
  IconBold,
  IconCamera,
  IconCheck,
  IconDownload,
  IconMore,
  IconMove,
  IconPalette,
  IconPencil,
  IconShare,
  IconTrash,
} from '../shared/icons';
import { displayName } from '../shared/russian';
import { t } from '../shared/i18n';
import { RenameDialog, ShareDialog } from './Viewer';

// Her literal ask: bold, one text color at a time, pasted images — nothing
// fancier. These hexes double as both the swatch colour AND the literal
// execCommand argument, so what's on screen is exactly what gets saved.
const COLORS = ['#1D2430', '#C6373C', '#2B5FD9', '#1F7A46', '#B85C1E', '#7C3AED'];
const MAX_IMAGE_DIM = 1400;
const IMAGE_QUALITY = 0.82;
const AUTOSAVE_DEBOUNCE_MS = 1200;

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Downscales + re-encodes so a phone photo doesn't balloon the document. */
async function downscaleToDataUrl(blob: Blob): Promise<string | null> {
  try {
    const img = await loadImage(blob);
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
  } catch {
    return null;
  }
}

/**
 * A Google-Keep-simple note (8B): bold, one text color, pasted images, and —
 * per her explicit ask — zero decorative margin around the writing surface.
 * Same props shape as Viewer so FilesApp can swap between the two by kind.
 */
export function DocumentEditor(props: {
  file: FileInfo;
  onClose: () => void;
  onChanged: (updated?: FileInfo) => void;
  onDeleted: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const menu = useMenu();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const closingRef = useRef(false);

  const [currentFile, setCurrentFile] = useState(props.file);
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [boldActive, setBoldActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [movedTo, setMovedTo] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Load her content once, then leave the contentEditable alone — re-driving
  // it from React state on every keystroke is what causes the cursor to jump.
  useEffect(() => {
    let cancelled = false;
    void api.get<{ html: string }>(`/api/documents/${props.file.id}`).then((res) => {
      if (cancelled) return;
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = res.html;
      el.focus();
      placeCaretAtEnd(el);
      document.execCommand('defaultParagraphSeparator', false, 'div');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.file.id]);

  const updateBoldState = () => {
    try {
      setBoldActive(document.queryCommandState('bold'));
    } catch {
      /* ignore */
    }
  };

  const flushSave = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!dirtyRef.current) return;
    const el = editorRef.current;
    if (!el) return;
    dirtyRef.current = false;
    setSaveState('saving');
    try {
      const res = await api.put<{ file: FileInfo }>(`/api/documents/${currentFile.id}`, { html: el.innerHTML });
      setSaveState('saved');
      setCurrentFile(res.file);
      props.onChanged(res.file);
    } catch {
      dirtyRef.current = true; // try again next time
      setSaveState('idle');
      showToast(t('Не получилось сохранить.'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFile.id]);

  const scheduleSave = () => {
    dirtyRef.current = true;
    setSaveState('pending');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const handleClose = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    await flushSave();
    props.onClose();
  };

  const focusEditor = () => editorRef.current?.focus();

  const toggleBold = () => {
    focusEditor();
    document.execCommand('bold');
    updateBoldState();
    scheduleSave();
  };

  const applyColor = (hex: string) => {
    focusEditor();
    document.execCommand('foreColor', false, hex);
    setColorOpen(false);
    scheduleSave();
  };

  const insertImageBlob = async (blob: Blob) => {
    const dataUrl = await downscaleToDataUrl(blob);
    if (!dataUrl) {
      showToast(t('Не получилось добавить фото.'));
      return;
    }
    focusEditor();
    document.execCommand('insertHTML', false, `<img src="${dataUrl}">`);
    scheduleSave();
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) void insertImageBlob(blob);
          return;
        }
      }
    }
    // Pasted formatting from elsewhere (e.g. a webpage) is never carried in —
    // only plain text, keeping the content model to exactly what her own
    // toolbar can produce (bold / color / images).
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) {
      document.execCommand('insertText', false, text);
      scheduleSave();
    }
  };

  const handleImageFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void insertImageBlob(f);
  };

  const downloadDoc = () => {
    const a = document.createElement('a');
    a.href = `/api/download/${currentFile.id}`;
    a.download = `${currentFile.name}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const doMove = async (folderId: string | null, folderName: string) => {
    setBusy(true);
    try {
      const res = await api.patch<{ file: FileInfo }>(`/api/files/${currentFile.id}`, { folderId });
      setMoveOpen(false);
      setMovedTo(folderName);
      setCurrentFile(res.file);
      props.onChanged(res.file);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось переместить.'));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.del(`/api/files/${currentFile.id}`);
      setDeleteOpen(false);
      props.onDeleted();
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось удалить.'));
      setBusy(false);
    }
  };

  const menuItems: MenuItem[] = [
    { label: t('Поделиться'), icon: <IconShare size={22} />, onClick: () => setShareOpen(true) },
    { label: t('Переместить'), icon: <IconMove size={22} />, onClick: () => setMoveOpen(true) },
    { label: t('Переименовать'), icon: <IconPencil size={22} />, onClick: () => setRenameOpen(true) },
    { label: t('Скачать'), icon: <IconDownload size={22} />, onClick: downloadDoc },
    { label: t('Удалить'), danger: true, icon: <IconTrash size={22} />, onClick: () => setDeleteOpen(true) },
  ];

  // Clicking a <button> shifts focus to it, which collapses whatever text
  // she just selected in the contentEditable before the click handler even
  // runs — losing the exact selection Bold/Color are meant to apply to.
  // Preventing default on mousedown keeps focus (and the selection) right
  // where it was; the click still fires normally afterward.
  const preserveSelection = (e: ReactMouseEvent) => e.preventDefault();

  const saveLabel =
    saveState === 'saving' || saveState === 'pending' ? t('Сохраняем…') : saveState === 'saved' ? t('Сохранено') : ' ';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--card)', display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '8px 12px', gap: 10, borderBottom: '1px solid var(--line)' }}>
        <button className="btn btn-ghost btn-compact" style={{ minWidth: 56 }} onClick={() => void handleClose()} aria-label={t('Назад')}>
          <IconBack size={24} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName(currentFile.name)}
          </div>
          <div className="muted small">{saveLabel}</div>
        </div>
        <button className="row-menu-btn" aria-label={t('Действия')} onClick={(e) => menu.openFromButton(e, menuItems)}>
          <IconMore size={24} />
        </button>
      </div>

      {movedTo ? (
        <div style={{ padding: '8px 14px 0' }}>
          <div className="card row" style={{ boxShadow: 'none' }}>
            <IconCheck size={22} />
            <div className="grow">{t('Файл теперь в папке «{name}»', { name: movedTo })}</div>
          </div>
        </div>
      ) : null}

      <div
        ref={editorRef}
        className="doc-body grow"
        contentEditable
        suppressContentEditableWarning
        onInput={scheduleSave}
        onPaste={handlePaste}
        onMouseUp={updateBoldState}
        onKeyUp={updateBoldState}
      />

      <div className="row-wrap" style={{ padding: '8px 10px 10px', borderTop: '1px solid var(--line)', gap: 8, justifyContent: 'center' }}>
        <button
          className={`btn btn-compact grow${boldActive ? ' btn-primary' : ''}`}
          style={{ flexBasis: '31%' }}
          onMouseDown={preserveSelection}
          onClick={toggleBold}
        >
          <IconBold size={20} /> {t('Жирный')}
        </button>
        <button
          className="btn btn-compact grow"
          style={{ flexBasis: '31%' }}
          onMouseDown={preserveSelection}
          onClick={() => setColorOpen(true)}
        >
          <IconPalette size={20} /> {t('Цвет')}
        </button>
        <button className="btn btn-compact grow" style={{ flexBasis: '31%' }} onClick={() => imageInputRef.current?.click()}>
          <IconCamera size={20} /> {t('Фото')}
        </button>
      </div>

      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFile} />

      {menu.menu}

      <Dialog open={colorOpen} title={t('Выберите цвет текста')} onClose={() => setColorOpen(false)}>
        <p className="muted" style={{ marginTop: 0 }}>{t('Сначала выделите текст пальцем, затем выберите цвет.')}</p>
        <div className="row-wrap" style={{ gap: 14, justifyContent: 'center' }}>
          {COLORS.map((hex) => (
            <button
              key={hex}
              onMouseDown={preserveSelection}
              onClick={() => applyColor(hex)}
              aria-label={hex}
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: hex,
                border: '2px solid var(--line)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 18 }} onClick={() => setColorOpen(false)}>
          {t('Закрыть')}
        </button>
      </Dialog>

      <ShareDialog file={currentFile} open={shareOpen} onClose={() => setShareOpen(false)} />

      <RenameDialog
        open={renameOpen}
        file={currentFile}
        onClose={() => setRenameOpen(false)}
        onRenamed={(updated) => {
          setRenameOpen(false);
          setCurrentFile(updated);
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
        body={<span>{t('«{name}» будет удалён.', { name: displayName(currentFile.name) })}</span>}
        confirmLabel={t('Удалить')}
        danger
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
