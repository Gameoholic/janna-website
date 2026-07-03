import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { IconPause, IconPlay } from './icons';
import { fmtDuration } from './russian';
import { t } from './i18n';

/**
 * Plain playback with our own always-visible controls (P12, shared): native
 * `<video controls>` fades its bar out during playback with no way to stop
 * that from the page, which would leave her without a visible «Пауза»
 * button. Play/pause + scrub live below the video instead and never hide.
 */
export function VideoPlayer(props: {
  src: string;
  poster?: string;
  style?: CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const video = videoRef.current;
      if (video && !draggingRef.current) setPositionMs(video.currentTime * 1000);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const seekFromEvent = (e: ReactPointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ms = fraction * durationMs;
    setPositionMs(ms);
    const video = videoRef.current;
    if (video) video.currentTime = ms / 1000;
  };

  const onTrackDown = (e: ReactPointerEvent) => {
    draggingRef.current = true;
    trackRef.current!.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  };

  const onTrackMove = (e: ReactPointerEvent) => {
    if (draggingRef.current) seekFromEvent(e);
  };

  const onTrackUp = () => {
    draggingRef.current = false;
  };

  return (
    <div>
      <video
        ref={videoRef}
        src={props.src}
        poster={props.poster}
        playsInline
        preload="metadata"
        onContextMenu={(e) => e.preventDefault()}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
        style={props.style}
      />
      <div className="row" style={{ gap: 12, marginTop: 10 }}>
        <button
          className="btn btn-primary"
          style={{ minWidth: 56 }}
          onClick={togglePlay}
          aria-label={playing ? t('Пауза') : t('Смотреть')}
        >
          {playing ? <IconPause size={26} /> : <IconPlay size={26} />}
        </button>
        <div
          ref={trackRef}
          className="seek-track grow"
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
        >
          <div className="seek-fill" style={{ width: `${(positionMs / Math.max(1, durationMs)) * 100}%` }} />
          <div className="seek-playhead" style={{ left: `${(positionMs / Math.max(1, durationMs)) * 100}%` }} />
        </div>
        <div className="num small" style={{ minWidth: 96, textAlign: 'right', flex: '0 0 auto' }}>
          {fmtDuration(positionMs)} / {fmtDuration(durationMs)}
        </div>
      </div>
    </div>
  );
}
