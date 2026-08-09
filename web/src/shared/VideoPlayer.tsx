import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { IconCheck, IconCompress, IconExpand, IconNote, IconPause, IconPlay } from './icons';
import { MenuItem, useMenu } from './ContextMenu';
import { fmtDuration } from './russian';
import { t } from './i18n';

/** Cross-browser fullscreen bits — Chrome109/Win7 and Android Chrome both
 * support the standard API, but feature-detect anyway and hide the button
 * rather than fail silently on an unexpected browser. */
type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void>;
};
type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

function isFullscreenSupported(): boolean {
  const doc = document as FullscreenDoc;
  return typeof document.exitFullscreen === 'function' || typeof doc.webkitExitFullscreen === 'function';
}

function currentFullscreenElement(): Element | null {
  const doc = document as FullscreenDoc;
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

// View-only playback speed (like VLC) — never touches the file itself, just
// how fast this one playback session plays it. Independent from the video
// editor's 0.6–0.9 pitch-preserved export speed (8A), which bakes a new file.
const PLAYBACK_SPEEDS = [0.5, 0.6, 0.7, 0.9, 1];

/**
 * Plain playback with our own always-visible controls (P12, shared): native
 * `<video controls>` fades its bar out during playback with no way to stop
 * that from the page, which would leave her without a visible «Пауза»
 * button. Instead the control bar sits overlaid on the media — like YouTube
 * / WhatsApp — but never fades or hides itself. Fullscreen makes the whole
 * player (media + our own controls) go fullscreen, not just the bare
 * element. One player for video AND audio (P12) — audio just shows artwork
 * instead of a video frame, everything else (play, seek, time, fullscreen)
 * behaves identically so she never has to learn a second set of controls.
 */
export function VideoPlayer(props: {
  src: string;
  poster?: string;
  style?: CSSProperties;
  kind?: 'video' | 'audio';
  /** Stretch to fill the parent's available space instead of intrinsic size. */
  fill?: boolean;
}) {
  const isAudio = props.kind === 'audio';
  const containerRef = useRef<HTMLDivElement>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const getMedia = (): HTMLMediaElement | null => (isAudio ? audioElRef.current : videoElRef.current);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsSupported] = useState(isFullscreenSupported);
  const [rate, setRate] = useState(1);
  const [scrubbing, setScrubbing] = useState(false);
  const speedMenu = useMenu();

  // A freshly opened file always starts at normal speed — she shouldn't have
  // to remember that the last file she watched was left at 1.5× (P2).
  useEffect(() => {
    setRate(1);
  }, [props.src]);

  useEffect(() => {
    const media = getMedia();
    if (!media) return;
    media.playbackRate = rate;
    // Keeps pitch normal at faster/slower speeds instead of chipmunk/slow-mo audio.
    const m = media as unknown as { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    m.preservesPitch = true;
    m.webkitPreservesPitch = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate, props.src]);

  const speedMenuItems: MenuItem[] = PLAYBACK_SPEEDS.map((s) => ({
    label: `${s.toFixed(1)}×`,
    icon: rate === s ? <IconCheck size={20} /> : undefined,
    onClick: () => setRate(s),
  }));

  useEffect(() => {
    const onChange = () => setFullscreen(currentFullscreenElement() === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current as FullscreenEl | null;
    const doc = document as FullscreenDoc;
    if (currentFullscreenElement()) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else if (doc.webkitExitFullscreen) void doc.webkitExitFullscreen();
    } else if (el) {
      if (el.requestFullscreen) void el.requestFullscreen();
      else if (el.webkitRequestFullscreen) void el.webkitRequestFullscreen();
    }
  };

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const media = getMedia();
      if (media && !draggingRef.current) setPositionMs(media.currentTime * 1000);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudio]);

  const togglePlay = () => {
    const media = getMedia();
    if (!media) return;
    if (media.paused) void media.play();
    else media.pause();
  };

  const seekFromEvent = (e: ReactPointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ms = fraction * durationMs;
    setPositionMs(ms);
    const media = getMedia();
    if (media) media.currentTime = ms / 1000;
  };

  const onTrackDown = (e: ReactPointerEvent) => {
    draggingRef.current = true;
    setScrubbing(true);
    trackRef.current!.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  };

  const onTrackMove = (e: ReactPointerEvent) => {
    if (draggingRef.current) seekFromEvent(e);
  };

  const onTrackUp = () => {
    draggingRef.current = false;
    setScrubbing(false);
  };

  const progress = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;
  const radius = (props.style?.borderRadius as CSSProperties['borderRadius']) ?? 0;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        lineHeight: 0,
        overflow: 'hidden',
        borderRadius: radius,
        width: props.fill ? '100%' : undefined,
        height: props.fill ? '100%' : undefined,
        background: fullscreen ? '#000' : undefined,
        display: fullscreen ? 'flex' : undefined,
        alignItems: fullscreen ? 'center' : undefined,
      }}
    >
      {isAudio ? (
        <>
          <div
            onClick={togglePlay}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              ...(fullscreen ? { width: '100%', maxHeight: '100%' } : props.style),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            <IconNote size={64} />
          </div>
          <audio
            ref={audioElRef}
            src={props.src}
            preload="metadata"
            onPlay={() => {
              setPlaying(true);
              setStarted(true);
            }}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
            style={{ display: 'none' }}
          />
        </>
      ) : (
        <video
          ref={videoElRef}
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
          style={
            fullscreen
              ? { width: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'pointer' }
              : { ...props.style, cursor: 'pointer' }
          }
        />
      )}

      {!playing ? (
        <button className="video-center-play" onClick={togglePlay} aria-label={playing ? t('Пауза') : t('Смотреть')}>
          <IconPlay size={30} />
        </button>
      ) : null}

      <div className="video-overlay-bar">
        <button
          className="video-overlay-btn"
          onClick={togglePlay}
          aria-label={playing ? t('Пауза') : t('Смотреть')}
        >
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
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
          {/* YouTube-style: current position shown right below the playback head while she's scrubbing. */}
          {scrubbing ? (
            <div className="seek-time-bubble num" style={{ left: `${progress}%` }}>
              {fmtDuration(positionMs)}
            </div>
          ) : null}
        </div>
        <div className="video-overlay-time num">
          {fmtDuration(started ? positionMs : 0)} / {fmtDuration(durationMs)}
        </div>
        <button
          className="video-overlay-speed num"
          onClick={(e) => speedMenu.openFromButton(e, speedMenuItems)}
          aria-label={t('Скорость просмотра')}
        >
          {rate.toFixed(1)}×
        </button>
        {fsSupported ? (
          <button
            className="video-overlay-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('Свернуть') : t('На весь экран')}
          >
            {fullscreen ? <IconCompress size={16} /> : <IconExpand size={16} />}
          </button>
        ) : null}
      </div>
      {speedMenu.menu}
    </div>
  );
}
