import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  EditJobInfo,
  EditSessionInfo,
  FileInfo,
  uploadWithProgress,
} from '../shared/api';
import { ConfirmDialog, ProgressBar, showToast, TopBar } from '../shared/ui';
import { Picker } from '../shared/Picker';
import { VideoPlayer } from '../shared/VideoPlayer';
import {
  IconCamera,
  IconCheck,
  IconDownload,
  IconFolder,
  IconPause,
  IconPlay,
  IconScissors,
  IconSpeed,
  IconX,
} from '../shared/icons';
import { fmtDuration } from '../shared/russian';
import { t } from '../shared/i18n';
import { Seg, Timeline } from './Timeline';

type Stage =
  | { t: 'pick' }
  | { t: 'uploading'; progress: number }
  | { t: 'edit'; session: EditSessionInfo }
  | { t: 'confirm'; session: EditSessionInfo }
  | { t: 'processing'; session: EditSessionInfo; job: EditJobInfo }
  | { t: 'result'; session: EditSessionInfo; job: EditJobInfo };

type Mode = 'base' | 'cut' | 'speed';

const SPEEDS = [0.6, 0.7, 0.8, 0.9] as const;

export function VideoApp() {
  const [stage, setStage] = useState<Stage>({ t: 'pick' });
  const [segments, setSegments] = useState<Seg[]>([]);
  const [speed, setSpeed] = useState(1);

  const reset = () => {
    setStage({ t: 'pick' });
    setSegments([]);
    setSpeed(1);
  };

  if (stage.t === 'pick' || stage.t === 'uploading') {
    return (
      <PickStage
        uploading={stage.t === 'uploading' ? stage.progress : null}
        onUploading={(progress) => setStage({ t: 'uploading', progress })}
        onCancelUpload={() => setStage({ t: 'pick' })}
        onSession={(session) => {
          setSegments([]);
          setSpeed(1);
          setStage({ t: 'edit', session });
        }}
      />
    );
  }

  if (stage.t === 'edit') {
    return (
      <EditStage
        session={stage.session}
        segments={segments}
        speed={speed}
        onSegments={setSegments}
        onSpeed={setSpeed}
        onExit={reset}
        onContinue={() => setStage({ t: 'confirm', session: stage.session })}
      />
    );
  }

  if (stage.t === 'confirm') {
    return (
      <ConfirmStage
        session={stage.session}
        segments={segments}
        speed={speed}
        onBack={() => setStage({ t: 'edit', session: stage.session })}
        onStarted={(job) => setStage({ t: 'processing', session: stage.session, job })}
      />
    );
  }

  if (stage.t === 'processing') {
    return (
      <ProcessingStage
        session={stage.session}
        job={stage.job}
        onDone={(job) => setStage({ t: 'result', session: stage.session, job })}
        onBack={() => setStage({ t: 'confirm', session: stage.session })}
      />
    );
  }

  return <ResultStage session={stage.session} job={stage.job} onRestart={reset} />;
}

/* ---------------- Pick: upload or choose from Файлы ---------------- */

function PickStage(props: {
  uploading: number | null;
  onUploading: (progress: number) => void;
  onCancelUpload: () => void;
  onSession: (session: EditSessionInfo) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  const startUpload = (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    props.onUploading(0);
    const handle = uploadWithProgress('/api/edit/sources', form, (fraction) => props.onUploading(fraction));
    abortRef.current = handle.abort;
    handle.promise
      .then((data) => {
        const { session } = data as { session: EditSessionInfo };
        props.onSession(session);
      })
      .catch((e) => {
        showToast(e instanceof Error ? t(e.message) : t('Не получилось загрузить видео.'));
        props.onCancelUpload();
      });
  };

  const openFromFiles = async (file: FileInfo) => {
    setOpeningFile(true);
    try {
      const { session } = await api.post<{ session: EditSessionInfo }>('/api/edit/from-file', {
        fileId: file.id,
      });
      setPickerOpen(false);
      props.onSession(session);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось открыть видео.'));
    } finally {
      setOpeningFile(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <TopBar title={t('Видео')} />
      {props.uploading !== null ? (
        <div className="card stack swap-enter">
          <h2>{t('Загружаем видео…')}</h2>
          <ProgressBar value={props.uploading} />
          <div className="muted num center">{Math.round(props.uploading * 100)}%</div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              abortRef.current?.();
              props.onCancelUpload();
            }}
          >
            {t('Отменить')}
          </button>
        </div>
      ) : (
        <div className="stack swap-enter">
          <p style={{ fontSize: 21, margin: '4px 2px 8px' }}>{t('Какое видео будем менять?')}</p>
          <button className="btn btn-primary btn-big btn-block" onClick={() => inputRef.current?.click()}>
            <IconCamera size={26} /> {t('Выбрать видео с устройства')}
          </button>
          <button className="btn btn-soft btn-big btn-block" onClick={() => setPickerOpen(true)}>
            <IconFolder size={26} /> {t('Выбрать из Файлов')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) startUpload(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
      <Picker
        mode="video"
        open={pickerOpen}
        title={t('Выберите видео')}
        busy={openingFile}
        onClose={() => setPickerOpen(false)}
        onPickFile={(file) => void openFromFiles(file)}
      />
    </div>
  );
}

/* ---------------- Edit: player + in-place mode swap ---------------- */

function EditStage(props: {
  session: EditSessionInfo;
  segments: Seg[];
  speed: number;
  onSegments: (segments: Seg[]) => void;
  onSpeed: (speed: number) => void;
  onExit: () => void;
  onContinue: () => void;
}) {
  const { session, segments, speed } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>('base');
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const previewRef = useRef(previewing);
  previewRef.current = previewing;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const durationMs = session.durationMs;
  const hasEdits = segments.length > 0 || speed !== 1;

  // Live position + jump-cut preview loop.
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const video = videoRef.current;
      if (video) {
        const cur = video.currentTime * 1000;
        setPositionMs(cur);
        if (previewRef.current && !video.paused && segmentsRef.current.length > 0) {
          const segs = segmentsRef.current;
          const inside = segs.some((s) => cur >= s.start - 60 && cur <= s.end + 60);
          if (!inside) {
            const next = segs.find((s) => s.start > cur - 60);
            if (next) {
              video.currentTime = next.start / 1000;
            } else {
              video.pause();
              video.currentTime = segs[0].start / 1000;
              setPreviewing(false);
            }
          } else {
            const current = segs.find((s) => cur >= s.start - 60 && cur <= s.end + 60)!;
            if (cur > current.end - 40) {
              const idx = segs.indexOf(current);
              const next = segs[idx + 1];
              if (next) video.currentTime = next.start / 1000;
              else {
                video.pause();
                video.currentTime = segs[0].start / 1000;
                setPreviewing(false);
              }
            }
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Her chosen speed is always audible in the editor — immediate preview (8A).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    const v = video as unknown as { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    v.preservesPitch = true;
    v.webkitPreservesPitch = true;
  }, [speed]);

  const seek = (ms: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(durationMs, ms)) / 1000;
    setPositionMs(ms);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const flashHint = (text: string) => {
    setHint(text);
    window.setTimeout(() => setHint(null), 3500);
  };

  const markStart = () => {
    setPendingStart(positionMs);
    setSelected(null);
    flashHint(t('Начало отмечено. Теперь доиграйте до конца нужной части и нажмите «Конец».'));
  };

  const markEnd = () => {
    if (pendingStart === null) {
      flashHint(t('Сначала нажмите «Начало».'));
      return;
    }
    const start = Math.min(pendingStart, positionMs);
    const end = Math.max(pendingStart, positionMs);
    if (end - start < 200) {
      flashHint(t('Часть получилась слишком короткой. Передвиньте видео вперёд и нажмите «Конец».'));
      return;
    }
    const next = [...segments, { start, end }].sort((a, b) => a.start - b.start);
    props.onSegments(next);
    setPendingStart(null);
    setSelected(next.findIndex((s) => s.start === start && s.end === end));
  };

  const removeSegment = (index: number) => {
    const next = segments.filter((_, i) => i !== index);
    props.onSegments(next);
    setSelected(null);
  };

  const nudge = (index: number, edge: 'start' | 'end', deltaMs: number) => {
    const seg = segments[index];
    if (!seg) return;
    let { start, end } = seg;
    if (edge === 'start') start = Math.max(0, Math.min(seg.end - 200, start + deltaMs));
    else end = Math.min(durationMs, Math.max(seg.start + 200, end + deltaMs));
    const next = segments.map((s, i) => (i === index ? { start, end } : s));
    props.onSegments(next);
    seek(edge === 'start' ? start : end);
  };

  const startPreview = () => {
    const video = videoRef.current;
    if (!video) return;
    if (segments.length > 0) video.currentTime = segments[0].start / 1000;
    setPreviewing(segments.length > 0);
    void video.play();
  };

  const stopPreview = () => {
    videoRef.current?.pause();
    setPreviewing(false);
  };

  const keptMs = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const totalMs = segments.length > 0 ? keptMs : durationMs;
  const resultMs = Math.round(totalMs / speed);

  const sortedForDisplay = useMemo(() => segments.map((s, i) => ({ ...s, i })), [segments]);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <TopBar
        title={session.name}
        onBack={() => {
          if (hasEdits) setExitConfirm(true);
          else props.onExit();
        }}
      />

      <div style={{ position: 'relative', lineHeight: 0, overflow: 'hidden', borderRadius: 14 }}>
        <video
          ref={videoRef}
          src={`/api/edit/sessions/${session.id}/media`}
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onContextMenu={(e) => e.preventDefault()}
          onClick={togglePlay}
          style={{ width: '100%', maxHeight: '44vh', background: '#000', display: 'block', cursor: 'pointer' }}
        />
        {!playing ? (
          <button className="video-center-play" onClick={togglePlay} aria-label={t('Смотреть')}>
            <IconPlay size={30} />
          </button>
        ) : null}
      </div>

      <div className="row" style={{ margin: '12px 0' }}>
        <button className="btn btn-primary" style={{ minWidth: 76 }} onClick={togglePlay} aria-label={playing ? t('Пауза') : t('Смотреть')}>
          {playing ? <IconPause size={28} /> : <IconPlay size={28} />}
        </button>
        <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>
          {fmtDuration(positionMs)} <span className="muted" style={{ fontWeight: 400 }}>{t('из {d}', { d: fmtDuration(durationMs) })}</span>
        </div>
        {speed !== 1 ? <span className="badge num">{t('скорость {s}×', { s: speed.toFixed(1) })}</span> : null}
      </div>

      <Timeline
        durationMs={durationMs}
        positionMs={positionMs}
        segments={segments}
        pendingStart={pendingStart}
        selected={mode === 'cut' ? selected : null}
        editable={mode === 'cut'}
        onSeek={seek}
        onSelect={setSelected}
        onChangeSegment={(i, seg) => props.onSegments(segments.map((s, idx) => (idx === i ? seg : s)))}
      />

      {hint ? (
        <div className="card" style={{ marginTop: 12, background: '#FFF7DE', boxShadow: 'none' }}>
          {hint}
        </div>
      ) : null}

      {/* Mode area — swapped in place, never a separate page (8A). */}
      {mode === 'base' ? (
        <div className="stack swap-enter" style={{ marginTop: 16 }} key="base">
          <button className="btn btn-soft btn-big btn-block" onClick={() => { setMode('cut'); stopPreview(); }}>
            <IconScissors size={26} /> {t('Обрезать видео')}
          </button>
          <button className="btn btn-soft btn-big btn-block" onClick={() => { setMode('speed'); stopPreview(); }}>
            <IconSpeed size={26} /> {t('Изменить скорость')}
          </button>

          {hasEdits ? (
            <div className="card stack" style={{ gap: 8 }}>
              {segments.length > 0 ? (
                <div>
                  {t('Оставлено частей:')} <b className="num">{segments.length}</b> — {t('вместе')}{' '}
                  <b className="num">{fmtDuration(keptMs)}</b>
                </div>
              ) : (
                <div>{t('Видео целиком:')} <b className="num">{fmtDuration(durationMs)}</b></div>
              )}
              {speed !== 1 ? (
                <div>
                  {t('Скорость:')} <b className="num">{speed.toFixed(1)}×</b> {t('(медленнее)')}
                </div>
              ) : null}
              <div>
                {t('Итоговая длина:')} <b className="num">{fmtDuration(resultMs)}</b>
              </div>
              <button
                className="btn btn-ghost"
                onClick={previewing ? stopPreview : startPreview}
              >
                {previewing ? t('Остановить просмотр') : t('Посмотреть, что получится')}
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: '2px 4px' }}>
              {t('Выберите, что сделать с видео. Можно и обрезать, и замедлить.')}
            </p>
          )}

          <button className="btn btn-primary btn-big btn-block" disabled={!hasEdits} onClick={props.onContinue}>
            {t('Продолжить')}
          </button>
        </div>
      ) : null}

      {mode === 'cut' ? (
        <div className="stack swap-enter" style={{ marginTop: 16 }} key="cut">
          <p style={{ margin: '2px 4px', fontSize: 18 }}>
            {pendingStart === null
              ? t('Найдите нужную часть. Нажмите «Начало» там, где она начинается.')
              : t('Начало: {t}. Теперь нажмите «Конец» там, где часть заканчивается.', { t: fmtDuration(pendingStart) })}
          </p>
          <div className="row">
            <button className="btn btn-primary btn-big grow" onClick={markStart}>
              {t('Начало')}
            </button>
            <button className="btn btn-primary btn-big grow" onClick={markEnd} disabled={pendingStart === null}>
              {t('Конец')}
            </button>
          </div>
          {pendingStart !== null ? (
            <button className="btn btn-ghost" onClick={() => setPendingStart(null)}>
              {t('Отменить отметку')}
            </button>
          ) : null}

          {sortedForDisplay.length > 0 ? (
            <div className="list-wrap">
              {sortedForDisplay.map((seg, i) => (
                <div
                  key={seg.i}
                  className="list-row"
                  style={selected === seg.i ? { background: 'var(--accent-soft)' } : undefined}
                  onClick={() => setSelected(selected === seg.i ? null : seg.i)}
                  role="button"
                >
                  <div className="grow">
                    <b>{t('Часть {i}:', { i: i + 1 })}</b>{' '}
                    <span className="num">
                      {fmtDuration(seg.start)} – {fmtDuration(seg.end)}
                    </span>{' '}
                    <span className="muted num">({fmtDuration(seg.end - seg.start)})</span>
                  </div>
                  <button
                    className="btn btn-ghost btn-compact"
                    aria-label={t('Убрать часть {i}', { i: i + 1 })}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSegment(seg.i);
                    }}
                  >
                    <IconX size={22} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {selected !== null && segments[selected] ? (
            <div className="card stack" style={{ gap: 10 }}>
              <div className="row">
                <span className="grow">
                  {t('Начало:')} <b className="num">{fmtDuration(segments[selected].start)}</b>
                </span>
                <button className="btn btn-ghost btn-compact num" onClick={() => nudge(selected, 'start', -1000)}>{t('−1 сек')}</button>
                <button className="btn btn-ghost btn-compact num" onClick={() => nudge(selected, 'start', 1000)}>{t('+1 сек')}</button>
              </div>
              <div className="row">
                <span className="grow">
                  {t('Конец:')} <b className="num">{fmtDuration(segments[selected].end)}</b>
                </span>
                <button className="btn btn-ghost btn-compact num" onClick={() => nudge(selected, 'end', -1000)}>{t('−1 сек')}</button>
                <button className="btn btn-ghost btn-compact num" onClick={() => nudge(selected, 'end', 1000)}>{t('+1 сек')}</button>
              </div>
            </div>
          ) : null}

          {segments.length > 0 ? (
            <button className="btn btn-ghost" onClick={previewing ? stopPreview : startPreview}>
              {previewing ? t('Остановить просмотр') : t('Посмотреть, что получится')}
            </button>
          ) : null}

          <button className="btn btn-primary btn-big btn-block" onClick={() => { setMode('base'); setPendingStart(null); }}>
            {t('Готово')}
          </button>
        </div>
      ) : null}

      {mode === 'speed' ? (
        <div className="stack swap-enter" style={{ marginTop: 16 }} key="speed">
          <p style={{ margin: '2px 4px', fontSize: 18 }}>
            {t('Выберите скорость. Звук останется обычным, не «писклявым».')}
          </p>
          <div className="row-wrap">
            {SPEEDS.map((value) => (
              <button
                key={value}
                className={`btn btn-big num ${speed === value ? 'btn-primary' : 'btn-soft'}`}
                style={{ flex: '1 1 40%' }}
                onClick={() => props.onSpeed(value)}
              >
                {value.toFixed(1)} {speed === value ? <IconCheck size={22} /> : null}
              </button>
            ))}
            <button
              className={`btn btn-big ${speed === 1 ? 'btn-primary' : 'btn-soft'}`}
              style={{ flex: '1 1 100%' }}
              onClick={() => props.onSpeed(1)}
            >
              {t('Обычная скорость')} {speed === 1 ? <IconCheck size={22} /> : null}
            </button>
          </div>
          <p className="muted small" style={{ margin: '0 4px' }}>
            {t('Нажмите «Смотреть», чтобы сразу услышать разницу.')}
          </p>
          <button className="btn btn-primary btn-big btn-block" onClick={() => setMode('base')}>
            {t('Готово')}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={exitConfirm}
        title={t('Выйти из монтажа?')}
        body={t('Отмеченные части и скорость не сохранятся.')}
        confirmLabel={t('Выйти')}
        danger
        onConfirm={props.onExit}
        onCancel={() => setExitConfirm(false)}
      />
    </div>
  );
}

/* ---------------- Confirm: all the numbers, then process ---------------- */

function ConfirmStage(props: {
  session: EditSessionInfo;
  segments: Seg[];
  speed: number;
  onBack: () => void;
  onStarted: (job: EditJobInfo) => void;
}) {
  const { session, segments, speed } = props;
  const [busy, setBusy] = useState(false);
  const keptMs = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const totalMs = segments.length > 0 ? keptMs : session.durationMs;
  const resultMs = Math.round(totalMs / speed);

  const start = async () => {
    setBusy(true);
    try {
      const { job } = await api.post<{ job: EditJobInfo }>('/api/edit/jobs', {
        sessionId: session.id,
        segments: segments.map((s) => ({ startMs: Math.round(s.start), endMs: Math.round(s.end) })),
        speed,
      });
      props.onStarted(job);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось начать. Попробуйте ещё раз.'));
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <TopBar title={t('Проверьте и подтвердите')} onBack={props.onBack} />
      <div className="card stack swap-enter" style={{ gap: 10 }}>
        <div className="muted">{session.name}</div>
        {segments.length > 0 ? (
          <>
            <div>
              {t('Оставляем частей: {n}', { n: segments.length })}
            </div>
            {segments.map((seg, i) => (
              <div key={i} style={{ paddingLeft: 10 }}>
                {t('Часть {i}:', { i: i + 1 })}{' '}
                <b className="num">
                  {fmtDuration(seg.start)} – {fmtDuration(seg.end)}
                </b>{' '}
                <span className="muted num">({fmtDuration(seg.end - seg.start)})</span>
              </div>
            ))}
          </>
        ) : (
          <div>{t('Видео целиком, без обрезки.')}</div>
        )}
        <div>
          {t('Скорость:')}{' '}
          <b className="num">{speed === 1 ? t('обычная (1.0×)') : t('{s}× — медленнее', { s: speed.toFixed(1) })}</b>
        </div>
        <div style={{ fontSize: 22 }}>
          {t('Итоговая длина:')} <b className="num">{fmtDuration(resultMs)}</b>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn btn-primary btn-big btn-block" onClick={() => void start()} disabled={busy}>
          {busy ? t('Начинаем…') : t('Создать видео')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={props.onBack} disabled={busy}>
          {t('Назад')}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Processing: honest progress, never frozen ---------------- */

function ProcessingStage(props: {
  session: EditSessionInfo;
  job: EditJobInfo;
  onDone: (job: EditJobInfo) => void;
  onBack: () => void;
}) {
  const [job, setJob] = useState(props.job);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const { job: fresh } = await api.get<{ job: EditJobInfo }>(`/api/edit/jobs/${props.job.id}`);
        if (cancelled) return;
        setJob(fresh);
        if (fresh.state === 'done') {
          window.clearInterval(timer);
          props.onDone(fresh);
        }
        if (fresh.state === 'error') window.clearInterval(timer);
      } catch { /* keep polling */ }
    }, 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.job.id]);

  if (job.state === 'error') {
    return (
      <div className="page" style={{ maxWidth: 560 }}>
        <TopBar title={t('Видео')} />
        <div className="card stack center swap-enter">
          <h2>{t('Не получилось создать видео')}</h2>
          <p className="muted">{t('Попробуйте ещё раз. Если не выходит — позвоните Даниилу.')}</p>
          <button className="btn btn-primary btn-big btn-block" onClick={props.onBack}>
            {t('Попробовать ещё раз')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <TopBar title={t('Видео')} />
      <div className="card stack swap-enter">
        <h2>{t('Готовим видео…')}</h2>
        <ProgressBar value={job.progress} />
        <div className="num center" style={{ fontSize: 26, fontWeight: 700 }}>
          {Math.round(job.progress * 100)}%
        </div>
        <p className="muted center small">{t('Это может занять пару минут. Можно просто подождать здесь.')}</p>
      </div>
    </div>
  );
}

/* ---------------- Result: the video is RIGHT HERE with its actions (P2) ---------------- */

function ResultStage(props: { session: EditSessionInfo; job: EditJobInfo; onRestart: () => void }) {
  const { job } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  const save = async (folderId: string | null, folderName: string) => {
    setSaving(true);
    try {
      await api.post(`/api/edit/jobs/${job.id}/save`, { folderId });
      setSavedTo(folderName);
      setPickerOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? t(e.message) : t('Не получилось сохранить.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <TopBar title={t('Видео готово!')} />
      <VideoPlayer
        src={`/api/edit/jobs/${job.id}/media`}
        style={{ width: '100%', maxHeight: '46vh', background: '#000', borderRadius: 14, display: 'block' }}
      />
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600 }}>{job.outputName}</div>
        <div className="muted num">{t('Длина: {d}', { d: fmtDuration(job.durationMs) })}</div>
      </div>
      <div className="stack swap-enter" style={{ marginTop: 16 }}>
        {savedTo ? (
          <div className="card row" style={{ background: '#EAF6EE', boxShadow: 'none' }}>
            <IconCheck size={26} />
            <div className="grow">
              {t('Сохранено в папке «{name}»', { name: savedTo })}
            </div>
          </div>
        ) : (
          <button className="btn btn-primary btn-big btn-block" onClick={() => setPickerOpen(true)}>
            <IconFolder size={24} /> {t('Сохранить в Файлы')}
          </button>
        )}
        <a className="btn btn-soft btn-big btn-block" href={`/api/edit/jobs/${job.id}/download`}>
          <IconDownload size={24} /> {t('Скачать')}
        </a>
        <button className="btn btn-ghost btn-block" onClick={props.onRestart}>
          {t('Сделать ещё одно видео')}
        </button>
      </div>
      <Picker
        mode="folder"
        open={pickerOpen}
        title={t('Куда сохранить видео?')}
        busy={saving}
        confirmLabel={(name) => t('Сохранить в «{name}»', { name })}
        onClose={() => setPickerOpen(false)}
        onPickFolder={(folderId, folderName) => void save(folderId, folderName)}
      />
    </div>
  );
}
