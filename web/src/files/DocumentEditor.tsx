import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { api, FileInfo } from '../shared/api';
import { ConfirmDialog, showToast, useIsPhone } from '../shared/ui';
import { Picker } from '../shared/Picker';
import { MenuItem, useMenu } from '../shared/ContextMenu';
import { IconBack, IconCheck, IconDownload, IconMore, IconMove, IconPencil, IconShare, IconTrash } from '../shared/icons';
import { displayName } from '../shared/russian';
import { t } from '../shared/i18n';
import { RenameDialog, ShareDialog } from './Viewer';
import './docEditor.css';

/*
 * Her old habit was Google Docs opened from Google Drive, so this editor is
 * deliberately a lookalike of it: the same grey canvas, white A4 page, ruler
 * and pill toolbar — trimmed to the basic tools she actually uses. Pasting a
 * picture (Ctrl+V) and then dragging it somewhere else must be effortless:
 * a pasted picture arrives already selected, and grabbing it moves it, with a
 * blue insertion line showing exactly where it will land.
 */

const PAGE_W = 794; // A4 at 96 dpi — Docs' print layout
const PAGE_MARGIN = 96; // 2.54 cm, Docs' default margins
const PAGE_MIN_H = 1123;
const CM = 37.795;
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
const ZOOMS = [75, 90, 100, 125, 150, 200];
const MAX_IMAGE_DIM = 1400;
const IMAGE_QUALITY = 0.82;
const AUTOSAVE_DEBOUNCE_MS = 1200;

// Google Docs' own colour grid, so her colours are where she remembers them.
const PALETTE = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
  ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'],
];

// Material icon paths (24×24), the same glyphs Docs uses.
const P = {
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  redo: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
  bold: 'M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z',
  italic: 'M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z',
  underline: 'M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z',
  textColor: 'M5.49 17h2.42l1.27-3.58h5.65L16.09 17h2.42L13.25 3h-2.5L5.49 17zm4.42-5.61l2.03-5.79h.12l2.03 5.79H9.91z',
  highlight: 'M13.06 5.19l3.75 3.75L7.75 18H4v-3.75l9.06-9.06zm4.82 2.68l-3.75-3.75 1.83-1.83c.39-.39 1.02-.39 1.41 0l2.34 2.34c.39.39.39 1.02 0 1.41l-1.83 1.83z',
  image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  left: 'M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z',
  center: 'M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z',
  right: 'M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z',
  justify: 'M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z',
  bullets:
    'M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z',
  numbers:
    'M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z',
  clear: 'M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z',
  minus: 'M19 13H5v-2h14v2z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  caret: 'M7 10l5 5 5-5z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  cloud:
    'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17 15.18 9l1.42 1.41L10 17z',
  sync: 'M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
};

type Align = 'left' | 'center' | 'right' | 'justify';
type Block = 'div' | 'h1' | 'h2' | 'h3';

interface Fmt {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  block: Block;
  align: Align;
  ul: boolean;
  ol: boolean;
  pt: number;
}

const EMPTY_FMT: Fmt = { bold: false, italic: false, underline: false, block: 'div', align: 'left', ul: false, ol: false, pt: 11 };

function Svg(props: { d: string; size?: number; color?: string }) {
  const s = props.size ?? 20;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={props.d} fill={props.color ?? 'currentColor'} />
    </svg>
  );
}

/** Blue "Docs" page glyph at the start of the title row. */
function DocGlyph() {
  return (
    <svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true" className="gd-glyph">
      <path d="M18 0H3C1.3 0 0 1.3 0 3v32c0 1.7 1.3 3 3 3h22c1.7 0 3-1.3 3-3V10L18 0z" fill="#4285F4" />
      <path d="M18 0v7c0 1.7 1.3 3 3 3h7L18 0z" fill="#A1C2FA" />
      <rect x="6" y="17" width="16" height="2" fill="#fff" />
      <rect x="6" y="21.5" width="16" height="2" fill="#fff" />
      <rect x="6" y="26" width="16" height="2" fill="#fff" />
      <rect x="6" y="30.5" width="11" height="2" fill="#fff" />
    </svg>
  );
}

/** Docs' ruler above the page — centimetres counted from the left margin. */
function Ruler(props: { scale: number }) {
  const ticks: ReactNode[] = [];
  const quarter = CM / 4;
  const first = -Math.floor(PAGE_MARGIN / quarter);
  const last = Math.floor((PAGE_W - PAGE_MARGIN) / quarter);
  for (let i = first; i <= last; i++) {
    const x = PAGE_MARGIN + i * quarter;
    if (i % 4 === 0) {
      if (i !== 0) {
        ticks.push(
          <text key={i} x={x} y={15} textAnchor="middle" fontSize="10" fill="#444746">
            {Math.abs(i / 4)}
          </text>
        );
      }
    } else {
      const h = i % 2 === 0 ? 6 : 3;
      ticks.push(<line key={i} x1={x} x2={x} y1={11 - h / 2} y2={11 + h / 2} stroke="#80868b" strokeWidth="1" />);
    }
  }
  const r = PAGE_W - PAGE_MARGIN;
  return (
    <svg width={PAGE_W * props.scale} height={22 * props.scale} viewBox={`0 0 ${PAGE_W} 22`} aria-hidden="true" style={{ display: 'block' }}>
      <rect x="0" y="0" width={PAGE_W} height="22" fill="#fff" />
      <rect x="0" y="0" width={PAGE_MARGIN} height="22" fill="#f1f3f4" />
      <rect x={r} y="0" width={PAGE_MARGIN} height="22" fill="#f1f3f4" />
      {ticks}
      <rect x={PAGE_MARGIN - 5} y="0" width="10" height="3" fill="#1a73e8" />
      <polygon points={`${PAGE_MARGIN - 5},4 ${PAGE_MARGIN + 5},4 ${PAGE_MARGIN},10`} fill="#1a73e8" />
      <polygon points={`${r - 5},4 ${r + 5},4 ${r},10`} fill="#1a73e8" />
    </svg>
  );
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
    // JPEG has no transparency — paint white first so a transparent PNG
    // (e.g. a screenshot of a logo) doesn't turn black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
  } catch {
    return null;
  }
}

function rangeFromPoint(x: number, y: number): Range | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretRangeFromPoint) return d.caretRangeFromPoint(x, y);
  const pos = d.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}

/** Where to draw the blue insertion line for a collapsed range. */
function caretRect(r: Range): { x: number; y: number; h: number } | null {
  const rects = r.getClientRects();
  if (rects.length && rects[0].height) return { x: rects[0].left, y: rects[0].top, h: rects[0].height };
  const c = r.startContainer;
  if (c.nodeType === 1) {
    const after = c.childNodes[r.startOffset];
    if (after && after.nodeType === 1) {
      const b = (after as Element).getBoundingClientRect();
      return { x: b.left, y: b.top, h: b.height || 18 };
    }
    const before = c.childNodes[r.startOffset - 1];
    if (before && before.nodeType === 1) {
      const b = (before as Element).getBoundingClientRect();
      return { x: b.right, y: b.top, h: b.height || 18 };
    }
    const b = (c as Element).getBoundingClientRect();
    return { x: b.left, y: b.top, h: Math.min(b.height, 22) || 18 };
  }
  const b = c.parentElement?.getBoundingClientRect();
  return b ? { x: b.left, y: b.top, h: Math.min(b.height, 22) || 18 } : null;
}

/** The <img> a range selects exactly, if any. */
function imageOfRange(r: Range | null): HTMLImageElement | null {
  if (!r || r.startContainer !== r.endContainer || r.endOffset - r.startOffset !== 1) return null;
  const n = r.startContainer.childNodes[r.startOffset];
  return n && n.nodeName === 'IMG' ? (n as HTMLImageElement) : null;
}

const PASTE_TAGS: Record<string, string> = {
  P: 'p', DIV: 'div', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3',
  LI: 'li', UL: 'ul', OL: 'ol', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u',
  SPAN: 'span', FONT: 'span', BR: 'br', TR: 'div', BLOCKQUOTE: 'div', PRE: 'div',
};
const PASTE_DROP = new Set(['SCRIPT', 'STYLE', 'META', 'TITLE', 'HEAD', 'LINK', 'SVG', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'TEMPLATE']);
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp);base64,/;
const SIZE_RE = /^\d{1,3}(?:\.\d+)?(?:pt|px)$/;

function cleanInto(src: Node, out: Node) {
  src.childNodes.forEach((ch) => {
    if (ch.nodeType === 3) {
      out.appendChild(document.createTextNode(ch.textContent || ''));
      return;
    }
    if (ch.nodeType !== 1) return;
    const e = ch as HTMLElement;
    const tag = e.tagName.toUpperCase();
    if (PASTE_DROP.has(tag)) return;
    if (tag === 'IMG') {
      const s = e.getAttribute('src') || '';
      if (DATA_IMAGE.test(s)) {
        const img = document.createElement('img');
        img.src = s;
        if (/^\d+(?:\.\d+)?px$/.test(e.style.width)) img.style.width = e.style.width;
        out.appendChild(img);
      }
      return;
    }
    let mapped = PASTE_TAGS[tag];
    // Google Docs wraps its whole clipboard in <b style="font-weight:normal">.
    if (mapped === 'b' && /^(normal|[1-5]00)$/.test(e.style.fontWeight)) mapped = 'span';
    if (!mapped) {
      cleanInto(e, out);
      return;
    }
    const n = document.createElement(mapped);
    const color = e.style.color || (tag === 'FONT' ? e.getAttribute('color') || '' : '');
    if (color) n.style.color = color;
    if (e.style.backgroundColor) n.style.backgroundColor = e.style.backgroundColor;
    if (SIZE_RE.test(e.style.fontSize)) n.style.fontSize = e.style.fontSize;
    if (e.style.textAlign) n.style.textAlign = e.style.textAlign;
    out.appendChild(n);
    // Styles copied from Docs / web pages carry bold/italic/underline as CSS.
    let inner: Node = n;
    const wrap = (t: string) => {
      const w = document.createElement(t);
      inner.appendChild(w);
      inner = w;
    };
    if (mapped !== 'b' && (e.style.fontWeight === 'bold' || Number(e.style.fontWeight) >= 600)) wrap('b');
    if (mapped !== 'i' && e.style.fontStyle === 'italic') wrap('i');
    if (mapped !== 'u' && /underline/.test(e.style.textDecoration)) wrap('u');
    cleanInto(e, inner);
  });
}

/** Pasted HTML reduced to exactly what this editor itself can produce. */
function cleanPastedHtml(html: string): { html: string; hasContent: boolean } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createElement('div');
  cleanInto(doc.body, out);
  return { html: out.innerHTML, hasContent: !!out.textContent?.trim() || !!out.querySelector('img') };
}

function readZoom(isPhone: boolean): number {
  try {
    const v = Number(localStorage.getItem(isPhone ? 'doc-zoom-phone' : 'doc-zoom'));
    if (ZOOMS.includes(v)) return v;
  } catch { /* storage unavailable */ }
  return isPhone ? 125 : 100;
}

/** Keeps the editor's selection when a toolbar control is pressed. */
const keepSelection = (e: ReactMouseEvent) => {
  if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
};

export function DocumentEditor(props: {
  file: FileInfo;
  onClose: () => void;
  onChanged: (updated?: FileInfo) => void;
  onDeleted: () => void;
}) {
  const isPhone = useIsPhone();
  const editorRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imgBarRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const menu = useMenu();
  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const closingRef = useRef(false);
  const savedRange = useRef<Range | null>(null);
  const pendingPt = useRef<number | null>(null);

  const [currentFile, setCurrentFile] = useState(props.file);
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [fmt, setFmt] = useState<Fmt>(EMPTY_FMT);
  const [sizeText, setSizeText] = useState('11');
  const [textColor, setTextColor] = useState('#000000');
  const [hiColor, setHiColor] = useState('#ffff00');
  const [zoom, setZoomState] = useState(() => readZoom(isPhone));
  const [pop, setPop] = useState<{ key: string; el: HTMLElement } | null>(null);
  const [selImg, setSelImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [pageH, setPageH] = useState(PAGE_MIN_H);
  const [tick, setTick] = useState(0);

  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [movedTo, setMovedTo] = useState<string | null>(null);

  const scale = zoom / 100;
  // Phone: the page is as wide as the screen (no side canvas), like Docs'
  // mobile layout. Desktop: a real A4 sheet on the grey canvas.
  const pageW = isPhone ? Math.max(200, view.w / scale) : PAGE_W;
  const pagePad = isPhone ? '16px 14px 40px' : `${PAGE_MARGIN}px`;
  const pageMinH = isPhone ? Math.max(200, view.h / scale) : PAGE_MIN_H;

  const inEditor = (n: Node | null | undefined) => !!n && !!editorRef.current && editorRef.current.contains(n);

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
      document.execCommand('defaultParagraphSeparator', false, 'div');
      document.execCommand('styleWithCSS', false, 'false');
      el.focus({ preventScroll: true });
      const r = document.createRange();
      r.setStart(el, 0);
      r.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.file.id]);

  /* ---------------- toolbar state follows the caret ---------------- */

  const refreshState = useCallback(() => {
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    let blockVal = '';
    try {
      blockVal = String(document.queryCommandValue('formatBlock')).toLowerCase();
    } catch { /* ignore */ }
    const block: Block = blockVal === 'h1' || blockVal === 'h2' || blockVal === 'h3' ? blockVal : 'div';
    const align: Align = q('justifyCenter') ? 'center' : q('justifyRight') ? 'right' : q('justifyFull') ? 'justify' : 'left';
    const r = savedRange.current;
    let pt = 11;
    if (r) {
      let n: Node | null = r.startContainer;
      if (n.nodeType !== 1) n = n.parentNode;
      if (n && n.nodeType === 1) {
        const px = parseFloat(getComputedStyle(n as Element).fontSize);
        if (px) pt = Math.round(px * 0.75 * 2) / 2;
      }
    }
    setFmt({
      bold: q('bold'),
      italic: q('italic'),
      underline: q('underline'),
      block,
      align,
      ul: q('insertUnorderedList'),
      ol: q('insertOrderedList'),
      pt,
    });
    setSelImg(imageOfRange(r));
  }, []);

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!inEditor(r.commonAncestorContainer)) return;
      savedRange.current = r.cloneRange();
      refreshState();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshState]);

  useEffect(() => {
    if (document.activeElement?.tagName !== 'INPUT') setSizeText(String(fmt.pt));
  }, [fmt.pt]);

  /* ---------------- saving ---------------- */

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

  /* ---------------- commands ---------------- */

  const restoreSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    const r = savedRange.current;
    if (r && inEditor(r.startContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  };

  const exec = (cmd: string, value?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, value);
    refreshState();
  };

  /**
   * execCommand('fontSize') only knows HTML's 1–7 scale, so we ask for "7"
   * as a marker and immediately turn every marked <font> into the real point
   * size (in place — no nodes move, so the caret stays put). A collapsed
   * caret gets its marker on the next keystroke, handled from onInput.
   */
  const normalizeFontSizes = () => {
    const el = editorRef.current;
    const pt = pendingPt.current;
    if (!el || pt === null) return;
    el.querySelectorAll('font[size]').forEach((f) => {
      const font = f as HTMLElement;
      font.removeAttribute('size');
      font.style.fontSize = `${pt}pt`;
      font.querySelectorAll<HTMLElement>('[style]').forEach((n) => {
        n.style.fontSize = '';
      });
    });
  };

  const applyFontSize = (pt: number) => {
    const size = Math.min(400, Math.max(1, Math.round(pt * 2) / 2));
    pendingPt.current = size;
    exec('fontSize', '7');
    normalizeFontSizes();
    setSizeText(String(size));
    setFmt((f) => ({ ...f, pt: size }));
    scheduleSave();
  };

  const stepFontSize = (dir: 1 | -1) => {
    const cur = fmt.pt;
    const next = dir > 0 ? FONT_SIZES.find((s) => s > cur) ?? cur + 1 : [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
    applyFontSize(next);
  };

  const setZoom = (z: number) => {
    setZoomState(z);
    setPop(null);
    try {
      localStorage.setItem(isPhone ? 'doc-zoom-phone' : 'doc-zoom', String(z));
    } catch { /* storage unavailable */ }
  };

  const togglePop = (key: string) => (e: ReactMouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    setPop((p) => (p && p.key === key ? null : { key, el }));
  };

  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      const tgt = e.target as Node;
      if (pop.el.contains(tgt) || (tgt as Element).closest?.('.gd-pop')) return;
      setPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPop(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [pop]);

  /* ---------------- images ---------------- */

  const selectImage = (img: HTMLImageElement) => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNode(img);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    savedRange.current = r.cloneRange();
    setSelImg(img);
  };

  /** Finds the image just inserted via insertHTML (marked) and selects it. */
  const takeNewImage = (select: boolean) => {
    const img = editorRef.current?.querySelector<HTMLImageElement>('img[data-doc-new]');
    if (!img) return;
    img.removeAttribute('data-doc-new');
    if (select) {
      selectImage(img);
      img.scrollIntoView({ block: 'nearest' });
    } else {
      const r = document.createRange();
      r.setStartAfter(img);
      r.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
      savedRange.current = r.cloneRange();
    }
  };

  const insertImages = async (blobs: Blob[]) => {
    for (let i = 0; i < blobs.length; i++) {
      const dataUrl = await downscaleToDataUrl(blobs[i]);
      if (!dataUrl) {
        showToast(t('Не получилось добавить фото.'));
        continue;
      }
      exec('insertHTML', `<img src="${dataUrl}" data-doc-new="1">`);
      // The last one arrives selected, ready to be dragged into place.
      takeNewImage(i === blobs.length - 1);
    }
    scheduleSave();
  };

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    if (!selImg || !scroller || !selImg.isConnected) {
      setBox(null);
      return;
    }
    const r = selImg.getBoundingClientRect();
    const c = scroller.getBoundingClientRect();
    setBox({ x: r.left - c.left + scroller.scrollLeft, y: r.top - c.top + scroller.scrollTop, w: r.width, h: r.height });
  }, [selImg]);

  useLayoutEffect(measure, [measure, zoom, pageW, pageH, tick]);

  // Keep the floating picture bar under the picture but fully on screen.
  useLayoutEffect(() => {
    const bar = imgBarRef.current;
    const scroller = scrollRef.current;
    if (!bar || !scroller || !box) return;
    const bw = bar.offsetWidth;
    const min = scroller.scrollLeft + 8;
    const max = scroller.scrollLeft + scroller.clientWidth - bw - 8;
    bar.style.left = `${Math.max(min, Math.min(max, box.x + box.w / 2 - bw / 2))}px`;
  }, [box]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const page = editorRef.current;
    if (!scroller || !page || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setView({ w: scroller.clientWidth, h: scroller.clientHeight });
      setPageH(page.offsetHeight);
      setTick((n) => n + 1);
    });
    ro.observe(scroller);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  /** Moves an image to a drop point through execCommand, so Ctrl+Z undoes it. */
  const moveImage = (img: HTMLImageElement, drop: Range) => {
    const el = editorRef.current;
    if (!el) return;
    const clone = img.cloneNode() as HTMLImageElement;
    clone.setAttribute('data-doc-new', '1');
    const html = clone.outerHTML;
    selectImage(img);
    document.execCommand('delete');
    if (!drop.startContainer.isConnected || !el.contains(drop.startContainer)) {
      document.execCommand('undo');
      return;
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(drop);
    document.execCommand('insertHTML', false, html);
    takeNewImage(true);
  };

  const startDrag = (e: ReactPointerEvent, img: HTMLImageElement) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const scroller = scrollRef.current;
    if (!scroller) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let x = sx;
    let y = sy;
    let started = false;
    let drop: Range | null = null;
    let ghost: HTMLImageElement | null = null;
    let line: HTMLDivElement | null = null;
    let raf = 0;
    let gw = 0;
    let gh = 0;

    const update = () => {
      if (ghost) {
        ghost.style.left = `${x - gw / 2}px`;
        ghost.style.top = `${y - gh / 2}px`;
      }
      const r = rangeFromPoint(x, y);
      const p = img.parentNode;
      const idx = p ? Array.prototype.indexOf.call(p.childNodes, img) : -1;
      const onItself = !!r && (r.startContainer === img || (r.startContainer === p && (r.startOffset === idx || r.startOffset === idx + 1)));
      drop = r && inEditor(r.startContainer) && !onItself ? r : null;
      const cr = drop ? caretRect(drop) : null;
      if (line) {
        if (cr) {
          line.style.display = 'block';
          line.style.left = `${cr.x - 1}px`;
          line.style.top = `${cr.y}px`;
          line.style.height = `${cr.h}px`;
        } else {
          line.style.display = 'none';
        }
      }
    };
    const autoscroll = () => {
      const r = scroller.getBoundingClientRect();
      const dy = y < r.top + 48 ? -14 : y > r.bottom - 48 ? 14 : 0;
      if (dy) {
        scroller.scrollTop += dy;
        update();
      }
      raf = requestAnimationFrame(autoscroll);
    };
    const onMove = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      if (!started) {
        if (Math.hypot(x - sx, y - sy) < 5) return;
        started = true;
        setDragging(true);
        const ir = img.getBoundingClientRect();
        gw = Math.min(ir.width, 220);
        gh = ir.width ? (ir.height * gw) / ir.width : gw;
        ghost = document.createElement('img');
        ghost.src = img.src;
        ghost.className = 'gd-ghost';
        ghost.style.width = `${gw}px`;
        ghost.style.height = `${gh}px`;
        document.body.appendChild(ghost);
        line = document.createElement('div');
        line.className = 'gd-dropline';
        document.body.appendChild(line);
        raf = requestAnimationFrame(autoscroll);
      }
      update();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(raf);
      ghost?.remove();
      line?.remove();
      if (!started) return;
      setDragging(false);
      if (drop) moveImage(img, drop);
      else selectImage(img);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const startResize = (e: ReactPointerEvent, corner: string) => {
    if (!selImg || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const img = selImg;
    const startW = img.offsetWidth;
    const sx = e.clientX;
    const dir = corner.includes('e') ? 1 : -1;
    const maxW = (editorRef.current?.clientWidth ?? pageW) - (isPhone ? 28 : PAGE_MARGIN * 2);
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(24, Math.min(maxW, startW + (dir * (ev.clientX - sx)) / scale));
      img.style.width = `${Math.round(w)}px`;
      img.style.height = '';
      measure();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      measure();
      scheduleSave();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const alignImage = (a: Align) => {
    if (!selImg) return;
    const img = selImg;
    selectImage(img);
    document.execCommand(a === 'center' ? 'justifyCenter' : a === 'right' ? 'justifyRight' : 'justifyLeft');
    if (img.isConnected) selectImage(img);
    setTick((n) => n + 1);
  };

  const deleteImage = () => {
    if (!selImg) return;
    selectImage(selImg);
    document.execCommand('delete');
    setSelImg(null);
  };

  /* ---------------- editor events ---------------- */

  const onEditorPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const tgt = e.target as HTMLElement;
    if (tgt.nodeName !== 'IMG') return;
    e.preventDefault();
    selectImage(tgt as HTMLImageElement);
    // Mouse: grab and move in one go. Touch: the tap selects; dragging the
    // selection frame moves it (so swiping over a picture still scrolls).
    if (e.pointerType === 'mouse') startDrag(e, tgt as HTMLImageElement);
  };

  const onEditorMouseDown = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).nodeName === 'IMG') e.preventDefault();
  };

  const onInput = () => {
    normalizeFontSizes();
    scheduleSave();
    setTick((n) => n + 1);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // A selected picture must never vanish because she started typing —
    // typing just continues after it.
    if (selImg && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const r = document.createRange();
      r.setStartAfter(selImg);
      r.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (fmt.ul || fmt.ol) exec(e.shiftKey ? 'outdent' : 'indent');
      else if (!e.shiftKey) exec('insertText', '    ');
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const dt = e.clipboardData;
    if (!dt) return;
    e.preventDefault();
    const images = Array.from(dt.items)
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    const html = dt.getData('text/html');
    if (html) {
      const cleaned = cleanPastedHtml(html);
      if (cleaned.hasContent) {
        exec('insertHTML', cleaned.html);
        return;
      }
    }
    if (images.length) {
      void insertImages(images);
      return;
    }
    const text = dt.getData('text/plain');
    if (text) exec('insertText', text);
  };

  const onDragOver = (e: DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  };

  const onDrop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const r = rangeFromPoint(e.clientX, e.clientY);
    if (r && inEditor(r.startContainer)) savedRange.current = r;
    void insertImages(files);
  };

  const handleImageFile = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) void insertImages(files);
  };

  /* ---------------- file actions ---------------- */

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

  /* ---------------- render ---------------- */

  const saving = saveState === 'saving' || saveState === 'pending';
  const styleNames: Record<Block, string> = {
    div: t('Обычный текст'),
    h1: t('Заголовок 1'),
    h2: t('Заголовок 2'),
    h3: t('Заголовок 3'),
  };
  const alignItems: { a: Align; cmd: string; icon: string; label: string }[] = [
    { a: 'left', cmd: 'justifyLeft', icon: P.left, label: t('По левому краю') },
    { a: 'center', cmd: 'justifyCenter', icon: P.center, label: t('По центру') },
    { a: 'right', cmd: 'justifyRight', icon: P.right, label: t('По правому краю') },
    { a: 'justify', cmd: 'justifyFull', icon: P.justify, label: t('По ширине') },
  ];
  const currentAlign = alignItems.find((i) => i.a === fmt.align) ?? alignItems[0];

  const btn = (key: string, title: string, onClick: () => void, content: ReactNode, active = false) => (
    <button key={key} type="button" className={`gd-btn${active ? ' on' : ''}`} title={title} aria-label={title} onClick={onClick}>
      {content}
    </button>
  );
  const sep = (key: string) => <span key={key} className="gd-sep" />;

  const popup = (key: string, content: ReactNode) => {
    if (!pop || pop.key !== key) return null;
    const r = pop.el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - (key === 'color' || key === 'hi' ? 300 : 200)));
    return (
      <div className="gd-pop" style={{ left, top: r.bottom + 4 }} onMouseDown={keepSelection}>
        {content}
      </div>
    );
  };

  const palette = (onPick: (hex: string) => void, resetLabel: string, onReset: () => void) => (
    <div>
      <button type="button" className="gd-pop-item gd-reset" onClick={onReset}>
        {resetLabel}
      </button>
      {PALETTE.map((row, i) => (
        <div key={i} className="gd-swatch-row" style={i === 1 ? { margin: '6px 0' } : undefined}>
          {row.map((hex) => (
            <button key={hex} type="button" className="gd-swatch" style={{ background: hex }} title={hex} aria-label={hex} onClick={() => onPick(hex)} />
          ))}
        </div>
      ))}
    </div>
  );

  const toolbar = (
    <div className="gd-toolbar" onMouseDown={keepSelection}>
      {btn('undo', t('Отменить (Ctrl+Z)'), () => exec('undo'), <Svg d={P.undo} />)}
      {btn('redo', t('Повторить (Ctrl+Y)'), () => exec('redo'), <Svg d={P.redo} />)}
      {sep('s1')}
      <button type="button" className="gd-btn gd-dd" style={{ width: 66 }} title={t('Масштаб')} onClick={togglePop('zoom')}>
        {zoom}% <Svg d={P.caret} size={18} />
      </button>
      {sep('s2')}
      <button type="button" className="gd-btn gd-dd" style={{ width: 124 }} title={t('Стиль текста')} onClick={togglePop('style')}>
        <span className="gd-dd-label">{styleNames[fmt.block]}</span> <Svg d={P.caret} size={18} />
      </button>
      {sep('s3')}
      {btn('minus', t('Уменьшить размер шрифта'), () => stepFontSize(-1), <Svg d={P.minus} />)}
      <input
        className="gd-size"
        value={sizeText}
        title={t('Размер шрифта')}
        aria-label={t('Размер шрифта')}
        inputMode="decimal"
        onChange={(e) => setSizeText(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = parseFloat(sizeText.replace(',', '.'));
            if (v > 0) applyFontSize(v);
            else setSizeText(String(fmt.pt));
          }
        }}
        onBlur={() => setSizeText(String(fmt.pt))}
      />
      {btn('plus', t('Увеличить размер шрифта'), () => stepFontSize(1), <Svg d={P.plus} />)}
      {sep('s4')}
      {btn('b', t('Полужирный (Ctrl+B)'), () => exec('bold'), <Svg d={P.bold} />, fmt.bold)}
      {btn('i', t('Курсив (Ctrl+I)'), () => exec('italic'), <Svg d={P.italic} />, fmt.italic)}
      {btn('u', t('Подчёркнутый (Ctrl+U)'), () => exec('underline'), <Svg d={P.underline} />, fmt.underline)}
      <button type="button" className="gd-btn gd-colorbtn" title={t('Цвет текста')} aria-label={t('Цвет текста')} onClick={togglePop('color')}>
        <Svg d={P.textColor} size={18} />
        <span className="gd-colorbar" style={{ background: textColor }} />
      </button>
      <button type="button" className="gd-btn gd-colorbtn" title={t('Цвет выделения')} aria-label={t('Цвет выделения')} onClick={togglePop('hi')}>
        <Svg d={P.highlight} size={18} />
        <span className="gd-colorbar" style={{ background: hiColor }} />
      </button>
      {sep('s5')}
      {btn('img', t('Вставить изображение'), () => imageInputRef.current?.click(), <Svg d={P.image} />)}
      {sep('s6')}
      <button type="button" className="gd-btn gd-dd" style={{ width: 48 }} title={t('Выравнивание')} aria-label={t('Выравнивание')} onClick={togglePop('align')}>
        <Svg d={currentAlign.icon} /> <Svg d={P.caret} size={16} />
      </button>
      {btn('ul', t('Маркированный список'), () => exec('insertUnorderedList'), <Svg d={P.bullets} />, fmt.ul)}
      {btn('ol', t('Нумерованный список'), () => exec('insertOrderedList'), <Svg d={P.numbers} />, fmt.ol)}
      {sep('s7')}
      {btn('clear', t('Очистить форматирование'), () => exec('removeFormat'), <Svg d={P.clear} />)}

      {popup(
        'zoom',
        ZOOMS.map((z) => (
          <button key={z} type="button" className={`gd-pop-item${z === zoom ? ' on' : ''}`} onClick={() => setZoom(z)}>
            {z}%
          </button>
        ))
      )}
      {popup(
        'style',
        (['div', 'h1', 'h2', 'h3'] as Block[]).map((b) => (
          <button
            key={b}
            type="button"
            className={`gd-pop-item gd-style-${b}${b === fmt.block ? ' on' : ''}`}
            onClick={() => {
              setPop(null);
              exec('formatBlock', b);
            }}
          >
            {styleNames[b]}
          </button>
        ))
      )}
      {popup(
        'color',
        palette(
          (hex) => {
            setPop(null);
            setTextColor(hex);
            exec('foreColor', hex);
          },
          t('Сбросить'),
          () => {
            setPop(null);
            setTextColor('#000000');
            exec('foreColor', '#000000');
          }
        )
      )}
      {popup(
        'hi',
        palette(
          (hex) => {
            setPop(null);
            setHiColor(hex);
            exec('hiliteColor', hex);
          },
          t('Нет'),
          () => {
            setPop(null);
            exec('hiliteColor', 'transparent');
          }
        )
      )}
      {popup(
        'align',
        <div className="gd-align-row">
          {alignItems.map((i) => (
            <button
              key={i.a}
              type="button"
              className={`gd-btn${i.a === fmt.align ? ' on' : ''}`}
              title={i.label}
              aria-label={i.label}
              onClick={() => {
                setPop(null);
                exec(i.cmd);
              }}
            >
              <Svg d={i.icon} />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={`gd-root${isPhone ? ' gd-phone' : ''}${dragging ? ' gd-dragging' : ''}`}>
      <div className="gd-head">
        <button type="button" className="gd-round" onClick={() => void handleClose()} aria-label={t('Назад')} title={t('Назад')}>
          <IconBack size={24} />
        </button>
        <DocGlyph />
        <div className="gd-titlebox">
          <button type="button" className="gd-title" onClick={() => setRenameOpen(true)} title={t('Переименовать')}>
            {displayName(currentFile.name)}
          </button>
          <div className="gd-status">
            {saveState !== 'idle' ? (
              <>
                <Svg d={saving ? P.sync : P.cloud} size={16} />
                {saving ? t('Сохраняем…') : t('Сохранено')}
              </>
            ) : null}
          </div>
        </div>
        <button type="button" className="gd-share" onClick={() => setShareOpen(true)} title={t('Настройки доступа')} aria-label={t('Настройки доступа')}>
          <Svg d={P.lock} size={18} />
          {isPhone ? null : <span>{t('Настройки доступа')}</span>}
        </button>
        <button type="button" className="gd-round" aria-label={t('Действия')} title={t('Действия')} onClick={(e) => menu.openFromButton(e, menuItems)}>
          <IconMore size={24} />
        </button>
      </div>

      {movedTo ? (
        <div className="gd-moved">
          <IconCheck size={20} /> {t('Файл теперь в папке «{name}»', { name: movedTo })}
        </div>
      ) : null}

      <div className="gd-toolbar-wrap">{toolbar}</div>

      <div className="gd-scroll" ref={scrollRef}>
        {isPhone ? null : (
          <div className="gd-ruler">
            <Ruler scale={scale} />
          </div>
        )}
        <div className="gd-sizer" style={{ width: pageW * scale, height: Math.max(pageH, pageMinH) * scale }}>
          <div
            ref={editorRef}
            className="gd-page"
            style={{ width: pageW, minHeight: pageMinH, padding: pagePad, transform: `scale(${scale})` }}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            lang="ru"
            onInput={onInput}
            onPaste={handlePaste}
            onKeyDown={onKeyDown}
            onPointerDown={onEditorPointerDown}
            onMouseDown={onEditorMouseDown}
            onDragStart={(e) => {
              if ((e.target as HTMLElement).nodeName === 'IMG') e.preventDefault();
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
        </div>

        {selImg && box ? (
          <>
            <div
              className="gd-imgsel"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              onPointerDown={(e) => startDrag(e, selImg)}
              onMouseDown={(e) => e.preventDefault()}
            >
              {['nw', 'ne', 'sw', 'se'].map((c) => (
                <div key={c} className={`gd-handle gd-${c}`} onPointerDown={(e) => startResize(e, c)} />
              ))}
            </div>
            <div ref={imgBarRef} className="gd-imgbar" style={{ top: box.y + box.h + 10 }} onMouseDown={(e) => e.preventDefault()}>
              <span className="gd-imgbar-hint">{t('Тяните картинку, чтобы переместить')}</span>
              {alignItems.slice(0, 3).map((i) => btn(`img-${i.a}`, i.label, () => alignImage(i.a), <Svg d={i.icon} />))}
              {btn('img-del', t('Удалить картинку'), deleteImage, <Svg d={P.trash} />)}
            </div>
          </>
        ) : null}
      </div>

      <input ref={imageInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleImageFile} />

      {menu.menu}

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
