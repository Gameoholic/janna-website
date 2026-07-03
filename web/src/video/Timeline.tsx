import { PointerEvent as ReactPointerEvent, useRef } from 'react';

export interface Seg {
  start: number; // ms
  end: number; // ms
}

interface TimelineProps {
  durationMs: number;
  positionMs: number;
  segments: Seg[];
  pendingStart: number | null;
  selected: number | null;
  editable: boolean;
  onSeek: (ms: number) => void;
  onSelect: (index: number | null) => void;
  onChangeSegment: (index: number, seg: Seg) => void;
}

const MIN_SEG_MS = 200;

/**
 * The timeline: kept parts appear as highlighted bands (8A). Dragging the
 * bar scrubs; the selected band gets big edge handles. Touch-friendly at
 * 412px — handles are 26px wide and fine-tuning also exists as ±1s buttons.
 */
export function Timeline(props: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: 'seek' | 'start' | 'end'; index: number } | null>(null);

  const msFromEvent = (e: ReactPointerEvent): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(fraction * props.durationMs);
  };

  const pct = (ms: number) => `${(ms / Math.max(1, props.durationMs)) * 100}%`;

  const onTrackDown = (e: ReactPointerEvent) => {
    dragRef.current = { kind: 'seek', index: -1 };
    trackRef.current!.setPointerCapture(e.pointerId);
    props.onSeek(msFromEvent(e));
  };

  const onHandleDown = (e: ReactPointerEvent, kind: 'start' | 'end', index: number) => {
    e.stopPropagation();
    dragRef.current = { kind, index };
    trackRef.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const ms = msFromEvent(e);
    if (drag.kind === 'seek') {
      props.onSeek(ms);
      return;
    }
    const seg = props.segments[drag.index];
    if (!seg) return;
    if (drag.kind === 'start') {
      const start = Math.min(ms, seg.end - MIN_SEG_MS);
      props.onChangeSegment(drag.index, { start: Math.max(0, start), end: seg.end });
      props.onSeek(Math.max(0, start));
    } else {
      const end = Math.max(ms, seg.start + MIN_SEG_MS);
      props.onChangeSegment(drag.index, { start: seg.start, end: Math.min(props.durationMs, end) });
      props.onSeek(Math.min(props.durationMs, end));
    }
  };

  const onUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={trackRef}
      className="timeline"
      onPointerDown={onTrackDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {props.segments.map((seg, i) => (
        <div
          key={i}
          className="timeline-band"
          style={{ left: pct(seg.start), width: pct(seg.end - seg.start) }}
          onPointerDown={(e) => {
            if (props.editable) {
              e.stopPropagation();
              dragRef.current = { kind: 'seek', index: -1 };
              trackRef.current!.setPointerCapture(e.pointerId);
              props.onSelect(i);
              props.onSeek(msFromEvent(e));
            }
          }}
        />
      ))}
      {props.pendingStart !== null ? (
        <div
          className="timeline-band pending"
          style={{
            left: pct(Math.min(props.pendingStart, props.positionMs)),
            width: pct(Math.abs(props.positionMs - props.pendingStart)),
          }}
        />
      ) : null}
      {props.editable && props.selected !== null && props.segments[props.selected] ? (
        <>
          <div
            className="timeline-handle"
            style={{ left: `calc(${pct(props.segments[props.selected].start)} - 13px)` }}
            onPointerDown={(e) => onHandleDown(e, 'start', props.selected!)}
          >
            ‹
          </div>
          <div
            className="timeline-handle"
            style={{ left: `calc(${pct(props.segments[props.selected].end)} - 13px)` }}
            onPointerDown={(e) => onHandleDown(e, 'end', props.selected!)}
          >
            ›
          </div>
        </>
      ) : null}
      <div className="timeline-playhead" style={{ left: `calc(${pct(props.positionMs)} - 2px)` }} />
    </div>
  );
}
