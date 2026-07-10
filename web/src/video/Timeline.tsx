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
  onSeek: (ms: number) => void;
}

/**
 * The timeline strip: kept parts appear as highlighted bands, the part being
 * marked right now as a yellow band (8A). Tap or drag anywhere to scrub —
 * that is the ONLY interaction; there are no handles to grab. Precision
 * comes from watching and pressing the wizard button at the right moment.
 */
export function Timeline(props: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const msFromEvent = (e: ReactPointerEvent): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(fraction * props.durationMs);
  };

  const pct = (ms: number) => `${(ms / Math.max(1, props.durationMs)) * 100}%`;

  return (
    <div
      ref={trackRef}
      className="timeline"
      onPointerDown={(e) => {
        draggingRef.current = true;
        trackRef.current!.setPointerCapture(e.pointerId);
        props.onSeek(msFromEvent(e));
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) props.onSeek(msFromEvent(e));
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
    >
      {props.segments.map((seg, i) => (
        <div
          key={i}
          className="timeline-band"
          style={{ left: pct(seg.start), width: pct(seg.end - seg.start) }}
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
      <div className="timeline-playhead" style={{ left: `calc(${pct(props.positionMs)} - 2px)` }} />
    </div>
  );
}
