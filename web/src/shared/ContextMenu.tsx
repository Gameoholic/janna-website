import { ReactNode, useEffect, useLayoutEffect, useRef, useState, MouseEvent as ReactMouseEvent } from 'react';

/**
 * Small anchored popup menu, opened either by a right-click (desktop
 * convenience) or by tapping a 3-dots button (works on her phone). Big,
 * well-spaced rows so a tap can't miss (P6). One `useMenu()` per screen;
 * render its `.menu` once and call `.open*` with the items for the target.
 */

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: ReactNode;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function useMenu() {
  const [state, setState] = useState<MenuState | null>(null);

  const openFromEvent = (e: ReactMouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  };

  const openFromButton = (e: ReactMouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setState({ x: r.left, y: r.bottom + 4, items });
  };

  const close = () => setState(null);
  const menu = state ? <MenuPopup state={state} onClose={close} /> : null;
  return { openFromEvent, openFromButton, close, menu };
}

function MenuPopup({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  /*
   * Anchoring the popup to the ⋯ it was tapped from needs room to the right
   * of that button. On her phone there is about 50px of it, and a shrink-to-
   * fit popup in 50px breaks every label into one letter per line («От / кр /
   * ыть»). Below the phone breakpoint it becomes a full-width sheet pinned to
   * the bottom instead — readable, within thumb reach, and the shape Android's
   * own menus already use. Measured once per open; the menu closes on resize.
   */
  const sheet = typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;

  useLayoutEffect(() => {
    if (sheet) return; // pinned by CSS, nothing to measure
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = state.x;
    let top = state.y;
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    setPos({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [state.x, state.y, sheet]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // The page scrolling away under the menu should close it — the menu
    // scrolling inside itself (the phone sheet, when its items don't fit)
    // must not, or she can never reach the last item.
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('contextmenu', outside, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', outside, true);
      window.removeEventListener('contextmenu', outside, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`ctx-menu swap-enter${sheet ? ' ctx-sheet' : ''}`}
      style={sheet ? undefined : { left: pos.left, top: pos.top }}
      role="menu"
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          className={`ctx-item${item.danger ? ' danger' : ''}`}
          role="menuitem"
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.icon ? <span className="ctx-icon">{item.icon}</span> : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}
