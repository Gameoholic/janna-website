import {
  CSSProperties,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { IconCheck, IconCompress, IconExpand, IconNote, IconPause, IconPlay } from './icons';
import { MenuItem, useMenu } from './ContextMenu';
import { fmtDuration } from './russian';
import { t } from './i18n';
import { noteClosed, notePlayed } from './mediaCache';

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
 * Keeping the screen awake while something is playing. She props the phone
 * up and dances across the room to her own videos — the screen timing out
 * would both stop the picture and (now that we pause on hidden) cut the
 * sound. Chrome 109 has this; anything older simply doesn't get it.
 */
type WakeLockSentinel = { release: () => Promise<void>; released: boolean };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
};

/** Playback actions the surrounding screen (or, later, the remote) can fire. */
export interface PlayerControls {
  rewind: (seconds: number) => void;
}

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
  /**
   * Lets the screen around the player drive playback — today the big
   * «−10 секунд» button under the video, later the Bluetooth remote, which
   * fires exactly the same actions.
   */
  controls?: MutableRefObject<PlayerControls | null>;
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

  /*
   * Surviving a bad connection. She dances to these videos in the ממד, where
   * the concrete walls make the phone hop between home Wi-Fi and mobile data
   * every couple of minutes. Each hop kills the video's download mid-stream,
   * and a bare <video> just stops for good on that — no message, no retry —
   * so to her the video "randomly paused" or "didn't play at all".
   *
   * So the player keeps the intent («she wants this playing») separately
   * from the element's own state, and when the connection dies — an error,
   * or a stall that never ends — it quietly reloads the file and carries on
   * from the same second, retrying for as long as she stays on the screen.
   * A short note tells her it will continue by itself, so she isn't left
   * tapping buttons on a frozen picture.
   */
  const wantPlayRef = useRef(false);
  const lastTimeRef = useRef(0);
  const recoveringRef = useRef(false);
  const attemptRef = useRef(0);
  const reachableFailsRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const pendingMetaRef = useRef<(() => void) | null>(null);
  const unmountedRef = useRef(false);
  const stallSinceRef = useRef(0);
  const stallPosRef = useRef(-1);
  const [weakNetwork, setWeakNetwork] = useState(false);

  const clearRetry = () => {
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };

  const endRecovery = () => {
    clearRetry();
    recoveringRef.current = false;
    attemptRef.current = 0;
    reachableFailsRef.current = 0;
    stallSinceRef.current = 0;
    setWeakNetwork(false);
  };

  /** Reload the file and pick up exactly where it was. */
  const reloadAtLastPosition = () => {
    clearRetry();
    const media = getMedia();
    if (!media || unmountedRef.current) return;
    // Hidden: we paused it anyway; try again the moment she's back.
    if (document.visibilityState === 'hidden') return;
    // Phone knows it has no network at all — the 'online' event will retry.
    if (navigator.onLine === false) {
      scheduleRetry();
      return;
    }
    if (pendingMetaRef.current) media.removeEventListener('loadedmetadata', pendingMetaRef.current);
    const onMeta = () => {
      pendingMetaRef.current = null;
      if (unmountedRef.current) return;
      const at = lastTimeRef.current;
      if (at > 0 && Number.isFinite(media.duration)) media.currentTime = Math.min(at, media.duration);
      if (wantPlayRef.current) void media.play().catch(() => { /* error event handles it */ });
      // Paused: the file is reachable again and sits where she left it — done.
      // (Playing ends recovery on the 'playing' event instead.)
      else endRecovery();
    };
    pendingMetaRef.current = onMeta;
    media.addEventListener('loadedmetadata', onMeta);
    stallSinceRef.current = 0;
    media.load(); // re-requests the same src from scratch, on whatever network is up now
  };

  const scheduleRetry = () => {
    clearRetry();
    // 1s, 2s, 4s, 8s, then every 10s — for as long as she stays on this screen.
    const delay = Math.min(10000, 1000 * 2 ** attemptRef.current);
    attemptRef.current += 1;
    retryTimerRef.current = window.setTimeout(reloadAtLastPosition, delay);
  };

  const beginRecovery = (immediately: boolean) => {
    if (unmountedRef.current) return;
    if (!recoveringRef.current) {
      recoveringRef.current = true;
      attemptRef.current = 0;
      setWeakNetwork(true);
    }
    if (immediately) reloadAtLastPosition();
    else scheduleRetry();
  };

  const onMediaError = (media: HTMLMediaElement) => {
    if (unmountedRef.current || !media.getAttribute('src')) return;
    const code = media.error?.code;
    // 1 = aborted by us (load() during a retry) — not a failure.
    if (code === 1) return;
    if (code === 2) {
      beginRecovery(false);
      return;
    }
    /*
     * 3/4 (decode / «format» error): Chrome reports a connection that died
     * before any data arrived as a format error, which is exactly tonight's
     * "didn't play at all". Ask the server directly: unreachable means it
     * was the network, so keep retrying. If the server answers fine three
     * times running, the file itself is the problem and retrying is pointless.
     */
    fetch(props.src, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' })
      .then((r) => r.ok)
      .catch(() => false)
      .then((reachable) => {
        if (unmountedRef.current) return;
        if (reachable) reachableFailsRef.current += 1;
        if (reachable && reachableFailsRef.current >= 3) {
          endRecovery();
          return;
        }
        beginRecovery(false);
      });
  };

  // A freshly opened file always starts at normal speed — she shouldn't have
  // to remember that the last file she watched was left at 1.5× (P2).
  useEffect(() => {
    setRate(1);
    wantPlayRef.current = false;
    lastTimeRef.current = 0;
    endRecovery();
    const src = props.src;
    return () => noteClosed(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.src]);

  /*
   * Stall watchdog. When the phone switches network the old connection
   * often doesn't error — it just hangs, and the video sits on «loading»
   * forever. Meant to be playing, not moving, no data for 15s → reload.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      const media = getMedia();
      if (!media || !wantPlayRef.current || recoveringRef.current || media.paused || media.ended) {
        stallSinceRef.current = 0;
        return;
      }
      const starved = media.readyState < 3; // < HAVE_FUTURE_DATA: waiting on the network
      if (!starved || media.currentTime !== stallPosRef.current) {
        stallPosRef.current = media.currentTime;
        stallSinceRef.current = 0;
        return;
      }
      const now = Date.now();
      if (!stallSinceRef.current) stallSinceRef.current = now;
      const stalledFor = now - stallSinceRef.current;
      if (stalledFor > 15000) beginRecovery(true);
      else if (stalledFor > 4000) setWeakNetwork(true);
    }, 1000);
    const onOnline = () => {
      if (recoveringRef.current) {
        attemptRef.current = 0;
        reloadAtLastPosition();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && recoveringRef.current) reloadAtLastPosition();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudio]);

  /** Shared event wiring for <video> and <audio>. */
  const mediaEvents = {
    onPlay: () => {
      wantPlayRef.current = true;
      setPlaying(true);
      setStarted(true);
      // Whatever she plays is kept on the phone for next time (mediaCache.ts),
      // fetched ahead of where she is in it.
      notePlayed(props.src, () => {
        const media = getMedia();
        return media && media.duration > 0 ? media.currentTime / media.duration : 0;
      });
    },
    onPause: () => {
      // A reload during recovery is not her pausing — keep the intent and the
      // Pause button as they were, so the screen doesn't flicker to «Смотреть».
      if (recoveringRef.current) return;
      wantPlayRef.current = false;
      setPlaying(false);
    },
    onEnded: () => {
      wantPlayRef.current = false;
    },
    onPlaying: () => endRecovery(),
    onTimeUpdate: (e: { currentTarget: HTMLMediaElement }) => {
      // A reload resets the element to 0:00 — don't let that overwrite where she was.
      if (!recoveringRef.current) lastTimeRef.current = e.currentTarget.currentTime;
      if (stallSinceRef.current === 0 && !recoveringRef.current) setWeakNetwork(false);
    },
    onError: (e: { currentTarget: HTMLMediaElement }) => onMediaError(e.currentTarget),
  };

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

  /*
   * Two ways her audio used to outlive the screen she started it on, both
   * reported after she left a dance video running and pressed Home:
   *
   * 1. Taking a media element out of the DOM does NOT stop it — Chrome keeps
   *    playing the detached element. Closing the viewer unmounted the node
   *    and the sound carried on with nothing left on screen to stop it.
   * 2. Chrome on Android deliberately keeps a page's audio going in the
   *    background, so pressing Home left it playing from a tab she had no
   *    idea was still open (she keeps dozens).
   *
   * So: hard-stop on unmount, and pause whenever the page goes away. She is
   * always in front of the phone when she wants the sound — the moment she
   * isn't looking at it, silence is what she expects.
   */
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return; // older browser: screen may sleep, nothing we can do
    let cancelled = false;
    const release = () => {
      const held = wakeLockRef.current;
      wakeLockRef.current = null;
      if (held && !held.released) void held.release().catch(() => { /* already gone */ });
    };
    if (playing && document.visibilityState === 'visible') {
      nav.wakeLock
        .request('screen')
        .then((lock) => {
          // Unmounted or paused while the request was in flight.
          if (cancelled || !playing) void lock.release().catch(() => { /* ignore */ });
          else wakeLockRef.current = lock;
        })
        .catch(() => { /* refused (battery saver, backgrounded) — not worth telling her */ });
    } else {
      release();
    }
    return () => {
      cancelled = true;
      release();
    };
  }, [playing]);

  useEffect(() => {
    unmountedRef.current = false;
    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      wantPlayRef.current = false;
      setPlaying(false); // onPause ignores pauses mid-recovery, so say it here
      getMedia()?.pause();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
      unmountedRef.current = true;
      clearRetry();
      const media = getMedia();
      if (!media) return;
      media.pause();
      // Dropping the source as well: a paused element that still holds the
      // file can be resumed by the OS media controls, which would start the
      // sound again with nothing on screen.
      media.removeAttribute('src');
      media.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // While reloading, the element sits at 0:00 — keep showing where she was.
      if (media && !draggingRef.current) {
        setPositionMs((recoveringRef.current ? lastTimeRef.current : media.currentTime) * 1000);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudio]);

  const togglePlay = () => {
    const media = getMedia();
    if (!media) return;
    if (recoveringRef.current) {
      // Mid-reconnect the element's own paused flag means nothing — go by intent.
      if (wantPlayRef.current) {
        wantPlayRef.current = false;
        setPlaying(false);
        media.pause();
      } else {
        wantPlayRef.current = true;
        setPlaying(true);
        attemptRef.current = 0;
        reloadAtLastPosition(); // she asked for it — try right now, not on the backoff
      }
      return;
    }
    if (media.paused) {
      wantPlayRef.current = true;
      void media.play().catch(() => { /* a network failure arrives as an error event */ });
    } else {
      wantPlayRef.current = false;
      media.pause();
    }
  };

  /*
   * Rewinding a finished video leaves it paused at the new position, which
   * looks broken — she pressed a button and nothing moved. Only in that
   * case do we resume; mid-playback a rewind must not change play state.
   */
  const rewind = (seconds: number) => {
    const media = getMedia();
    if (!media) return;
    const ended = media.ended;
    const from = recoveringRef.current ? lastTimeRef.current : media.currentTime;
    const next = Math.max(0, from - seconds);
    lastTimeRef.current = next;
    if (!recoveringRef.current) media.currentTime = next;
    setPositionMs(next * 1000);
    if (ended) void media.play().catch(() => { /* nothing useful to tell her */ });
  };

  const controlsProp = props.controls;
  useEffect(() => {
    if (!controlsProp) return;
    controlsProp.current = { rewind };
    return () => {
      controlsProp.current = null;
    };
  });

  const seekFromEvent = (e: ReactPointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ms = fraction * durationMs;
    setPositionMs(ms);
    lastTimeRef.current = ms / 1000;
    const media = getMedia();
    if (media && !recoveringRef.current) media.currentTime = ms / 1000;
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
            {...mediaEvents}
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
          {...mediaEvents}
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

      {weakNetwork ? (
        <div className="video-weak-hint" role="status">
          {t('Плохая связь — видео продолжится само')}
        </div>
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
          {fmtDuration(started ? positionMs : 0)}
          {/* The total is dropped on a narrow phone, where the whole bar does
              not fit on one line — the file's length is already in the header
              right above the video. */}
          <span className="video-overlay-total"> / {fmtDuration(durationMs)}</span>
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
            className="video-overlay-btn video-overlay-btn-fs"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('Свернуть') : t('На весь экран')}
          >
            {fullscreen ? <IconCompress size={20} /> : <IconExpand size={20} />}
          </button>
        ) : null}
      </div>
      {speedMenu.menu}
    </div>
  );
}
