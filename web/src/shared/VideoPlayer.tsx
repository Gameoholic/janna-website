import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { IconPause, IconPlay } from './icons';
import { fmtDuration } from './russian';
import { t } from './i18n';

/**
 * Plain playback with our own always-visible controls (P12, shared): native
 * `<video controls>` fades its bar out during playback with no way to stop
 * that from the page, which would leave her without a visible «Пауза»
 * button. Instead the control bar sits overlaid on the video — like YouTube
 * / WhatsApp — but never fades or hides itself.
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
  const [started, setStarted] = useState(false);
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

  const progress = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;
  const radius = (props.style?.borderRadius as CSSProperties['borderRadius']) ?? 0;

  return (
    <div style={{ position: 'relative', lineHeight: 0, overflow: 'hidden', borderRadius: radius }}>
      <video
        ref={videoRef}
        src={props.src}
        poster={props.poster}
        playsInline
        preload="metadata"
        onContextMenu={(e) => e.preventDefault()}
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
        style={{ ...props.style, cursor: 'pointer' }}
      />

      {!playing ? (
        <button className="video-center-play" onClick={togglePlay} aria-label={playing ? t('Пауза') : t('Смотреть')}>
          <IconPlay size={34} />
        </button>
      ) : null}

      <div className="video-overlay-bar">
        <button
          className="video-overlay-btn"
          onClick={togglePlay}
          aria-label={playing ? t('Пауза') : t('Смотреть')}
        >
          {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
        </button>
        <div
          ref={trackRef}
          className="seek-track grow"
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
        >
          <div className="seek-fill" style={{ width: `${progress}%` }} />
          <div className="seek-thumb" style={{ left: `${progress}%` }} />
        </div>
        <div className="video-overlay-time num">
          {fmtDuration(started ? positionMs : 0)} / {fmtDuration(durationMs)}
        </div>
      </div>
    </div>
  );
}
