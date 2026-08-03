import { useEffect, useRef, useState } from 'react';
import {
  api,
  EditJobInfo,
  EditSessionInfo,
  FileInfo,
  LARGE_FILE_THRESHOLD,
  uploadLarge,
  uploadWithProgress,
} from '../shared/api';
import { ConfirmDialog, Dialog, ProgressBar, showToast, TopBar } from '../shared/ui';
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
} from '../shared/icons';
import { displayName, fmtDuration } from '../shared/russian';
import { t } from '../shared/i18n';
import { Seg, Timeline } from './Timeline';

type Stage =
  | { t: 'pick' }
  | { t: 'uploading'; progress: number }
  | { t: 'edit'; session: EditSessionInfo; startAtSummary?: boolean }
  | { t: 'processing'; session: EditSessionInfo; job: EditJobInfo }
  | { t: 'result'; session: EditSessionInfo; job: EditJobInfo };

const SPEEDS: { value: number; label: string }[] = [
  { value: 0.9, label: 'чуть медленнее' },
  { value: 0.8, label: 'медленнее' },
  { value: 0.7, label: 'ещё медленнее' },
  { value: 0.6, label: 'самое медленное' },
];

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
        key={stage.session.id}
        session={stage.session}
        segments={segments}
        speed={speed}
        startAtSummary={stage.startAtSummary === true}
        onSegments={setSegments}
        onSpeed={setSpeed}
        onExit={reset}
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
        onBack={() => setStage({ t: 'edit', session: stage.session, startAtSummary: true })}
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
    props.onUploading(0);
    const onProgress = (fraction: number) => props.onUploading(fraction);
    let handle;
    if (file.size >= LARGE_FILE_THRESHOLD) {
      handle = uploadLarge('/api/edit/sources/chunked', file, onProgress);
    } else {
      const form = new FormData();
      form.append('file', file, file.name);
      handle = uploadWithProgress('/api/edit/sources', form, onProgress);
    }
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

/* ----------------------------------------------------------------------
 * Edit: a guided wizard. The video preview is ALWAYS visible on top; below
 * it ONE question card at a time with 1–3 big buttons (8A, P2, P3). No
 * modes, no draggable handles, no fine-tuning grids — a wrong step is
 * always fixed the same one way: «Выбрать заново» / «Начать заново».
 * -------------------------------------------------------------------- */

type Step =
  | 'askCut' // что будем делать?
  | 'markStart' // найдите, где часть начинается
  | 'markEnd' // досмотрите до конца части
  | 'review' // вот что вы выбрали (часть играет сама)
  | 'askMore' // добавить ещё часть?
  | 'askSpeed' // замедлить?
  | 'pickSpeed' // насколько? (слышно сразу)
  | 'summary'; // все числа + итоговый просмотр + «Создать видео»

function EditStage(props: {
  session: EditSessionInfo;
  segments: Seg[];
  speed: number;
  startAtSummary: boolean;
  onSegments: (segments: Seg[]) => void;
  onSpeed: (speed: number) => void;
  onExit: () => void;
  onStarted: (job: EditJobInfo) => void;
}) {
  const { session, segments, speed } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState<Step>(props.startAtSummary ? 'summary' : 'askCut');
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Where «Назад» from the speed question returns, and the speed to restore.
  const speedBackRef = useRef<{ from: Step; speed: number }>({ from: 'askSpeed', speed: 1 });

  const durationMs = session.durationMs;
  const hasEdits = segments.length > 0 || speed !== 1;

  // On review / pickSpeed / summary, playback is confined to the kept parts:
  // she always hears exactly what the result will sound like (8A preview).
  const reviewSeg = reviewIndex !== null ? segments[reviewIndex] : null;
  let previewSegs: Seg[] | null = null;
  if (step === 'review' && reviewSeg) previewSegs = [reviewSeg];
  else if ((step === 'pickSpeed' || step === 'summary') && segments.length > 0) previewSegs = segments;
  const previewSegsRef = useRef(previewSegs);
  previewSegsRef.current = previewSegs;

  // Live position + jump-cut preview loop.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const cur = video.currentTime * 1000;
        setPositionMs(cur);
        const segs = previewSegsRef.current;
        if (segs && !video.paused) {
          const inside = segs.find((s) => cur >= s.start - 60 && cur <= s.end + 60);
          if (!inside) {
            const next = segs.find((s) => s.start > cur - 60);
            if (next) video.currentTime = next.start / 1000;
            else {
              video.pause();
              video.currentTime = segs[0].start / 1000;
            }
          } else if (cur > inside.end - 40) {
            const next = segs[segs.indexOf(inside) + 1];
            if (next) video.currentTime = next.start / 1000;
            else {
              video.pause();
              video.currentTime = segs[0].start / 1000;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
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

  // The app shows her what she chose without asking: entering the review or
  // the summary starts the preview by itself (P2 — the result is right there).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (step === 'review' || step === 'summary') {
      const segs = previewSegsRef.current;
      video.currentTime = (segs ? segs[0].start : 0) / 1000;
      void video.play()?.catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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

  const pause = () => videoRef.current?.pause();

  const flashHint = (text: string) => {
    setHint(text);
    window.setTimeout(() => setHint(null), 4000);
  };

  const go = (next: Step) => {
    setHint(null);
    setStep(next);
  };

  /* ---- step actions ---- */

  const markStart = () => {
    setPendingStart(positionMs);
    go('markEnd');
  };

  const markEnd = () => {
    if (pendingStart === null) return;
    const start = Math.min(pendingStart, positionMs);
    const end = Math.max(pendingStart, positionMs);
    if (end - start < 500) {
      flashHint(t('Получилось слишком коротко. Дайте видео поиграть ещё чуть-чуть и нажмите кнопку.'));
      return;
    }
    const next = [...segments, { start, end }].sort((a, b) => a.start - b.start);
    props.onSegments(next);
    setReviewIndex(next.findIndex((s) => s.start === start && s.end === end));
    setPendingStart(null);
    go('review');
  };

  const keepReviewed = () => {
    pause();
    setReviewIndex(null);
    go('askMore');
  };

  const redoReviewed = () => {
    pause();
    if (reviewIndex !== null) props.onSegments(segments.filter((_, i) => i !== reviewIndex));
    setReviewIndex(null);
    go('markStart');
  };

  const enterPickSpeed = (from: Step) => {
    speedBackRef.current = { from, speed };
    go('pickSpeed');
  };

  const chooseSpeed = (value: number) => {
    props.onSpeed(value);
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (segments.length > 0) video.currentTime = segments[0].start / 1000;
      else if (video.currentTime * 1000 > durationMs - 500) video.currentTime = 0;
      void video.play();
    }
  };

  const startOver = () => {
    setResetConfirm(false);
    pause();
    props.onSegments([]);
    props.onSpeed(1);
    setPendingStart(null);
    setReviewIndex(null);
    seek(0);
    go('askCut');
  };

  const createVideo = async () => {
    setBusy(true);
    pause();
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

  const keptMs = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const totalMs = segments.length > 0 ? keptMs : durationMs;
  const resultMs = Math.round(totalMs / speed);

  /* ---- the ONE question card for the current step ---- */

  const question = (text: string) => (
    <p style={{ margin: '2px 2px 4px', fontSize: 20 }}>{text}</p>
  );

  let card: JSX.Element;
  if (step === 'askCut') {
    card = (
      <>
        {question(t('Что будем делать с видео?'))}
        <button className="btn btn-primary btn-big btn-block" onClick={() => go('markStart')}>
          <IconScissors size={26} /> {t('Оставить только нужную часть')}
        </button>
        <button className="btn btn-soft btn-big btn-block" onClick={() => enterPickSpeed('askCut')}>
          <IconSpeed size={26} /> {t('Просто замедлить видео')}
        </button>
      </>
    );
  } else if (step === 'markStart') {
    card = (
      <>
        {question(
          segments.length === 0
            ? t('Включите видео. Когда начнётся нужная часть — нажмите кнопку.')
            : t('Найдите следующую часть. Когда она начнётся — нажмите кнопку.'),
        )}
        <button className="btn btn-primary btn-big btn-block" onClick={markStart}>
          <IconScissors size={26} /> {t('Часть начинается здесь')}
        </button>
        <button
          className="btn btn-ghost btn-block"
          onClick={() => go(segments.length === 0 ? 'askCut' : 'askMore')}
        >
          {t('Назад')}
        </button>
      </>
    );
  } else if (step === 'markEnd') {
    card = (
      <>
        {question(
          t('Начало отмечено: {t}. Досмотрите до конца части и нажмите кнопку.', {
            t: fmtDuration(pendingStart ?? 0),
          }),
        )}
        <button className="btn btn-primary btn-big btn-block" onClick={markEnd}>
          <IconScissors size={26} /> {t('Часть заканчивается здесь')}
        </button>
        <button
          className="btn btn-ghost btn-block"
          onClick={() => {
            setPendingStart(null);
            go('markStart');
          }}
        >
          {t('Отменить начало')}
        </button>
      </>
    );
  } else if (step === 'review') {
    card = (
      <>
        {question(t('Посмотрите, что вы выбрали:'))}
        {reviewSeg ? (
          <div className="num" style={{ margin: '0 2px', fontSize: 20 }}>
            <b>
              {fmtDuration(reviewSeg.start)} – {fmtDuration(reviewSeg.end)}
            </b>{' '}
            <span className="muted">({fmtDuration(reviewSeg.end - reviewSeg.start)})</span>
          </div>
        ) : null}
        <button className="btn btn-primary btn-big btn-block" onClick={keepReviewed}>
          <IconCheck size={26} /> {t('Да, оставить эту часть')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={redoReviewed}>
          {t('Выбрать заново')}
        </button>
      </>
    );
  } else if (step === 'askMore') {
    card = (
      <>
        {question(t('Часть сохранена. Добавить ещё одну?'))}
        <div className="muted" style={{ margin: '0 2px' }}>
          {t('Выбрано частей: {n}, вместе: {d}', { n: segments.length, d: fmtDuration(keptMs) })}
        </div>
        <button className="btn btn-soft btn-big btn-block" onClick={() => go('markStart')}>
          <IconScissors size={26} /> {t('Да, добавить ещё часть')}
        </button>
        <button className="btn btn-primary btn-big btn-block" onClick={() => go('askSpeed')}>
          {t('Нет, дальше')}
        </button>
      </>
    );
  } else if (step === 'askSpeed') {
    card = (
      <>
        {question(t('Замедлить видео?'))}
        <button className="btn btn-primary btn-big btn-block" onClick={() => enterPickSpeed('askSpeed')}>
          <IconSpeed size={26} /> {t('Да, замедлить')}
        </button>
        <button className="btn btn-soft btn-big btn-block" onClick={() => go('summary')}>
          {t('Нет, оставить как есть')}
        </button>
      </>
    );
  } else if (step === 'pickSpeed') {
    card = (
      <>
        {question(t('Насколько замедлить? Нажмите на кнопку — видео сразу покажет.'))}
        <div className="row-wrap">
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              className={`btn btn-big ${speed === s.value ? 'btn-primary' : 'btn-soft'}`}
              style={{ flex: '1 1 40%', flexDirection: 'column', gap: 2, padding: '10px 8px' }}
              onClick={() => chooseSpeed(s.value)}
            >
              <span className="num" style={{ fontSize: 24 }}>
                {s.value.toFixed(1)} {speed === s.value ? <IconCheck size={20} /> : null}
              </span>
              <span className="small" style={{ fontWeight: 400 }}>{t(s.label)}</span>
            </button>
          ))}
        </div>
        <button
          className="btn btn-primary btn-big btn-block"
          disabled={speed === 1}
          onClick={() => {
            pause();
            go('summary');
          }}
        >
          {t('Готово')}
        </button>
        <button
          className="btn btn-ghost btn-block"
          onClick={() => {
            props.onSpeed(speedBackRef.current.speed);
            pause();
            go(speedBackRef.current.from);
          }}
        >
          {t('Назад')}
        </button>
      </>
    );
  } else {
    card = (
      <>
        {question(t('Всё готово. Видео сверху показывает, что получится.'))}
        <div className="stack" style={{ gap: 6, margin: '0 2px' }}>
          {segments.length > 0 ? (
            segments.map((seg, i) => (
              <div key={i}>
                {t('Часть {i}:', { i: i + 1 })}{' '}
                <b className="num">
                  {fmtDuration(seg.start)} – {fmtDuration(seg.end)}
                </b>{' '}
                <span className="muted num">({fmtDuration(seg.end - seg.start)})</span>
              </div>
            ))
          ) : (
            <div>{t('Видео целиком')}</div>
          )}
          {speed !== 1 ? (
            <div>
              {t('Скорость:')} <b className="num">{t('{s} — медленнее', { s: speed.toFixed(1) })}</b>
            </div>
          ) : null}
          <div style={{ fontSize: 21 }}>
            {t('Новое видео получится: {d}', { d: fmtDuration(resultMs) })}
          </div>
        </div>
        <button className="btn btn-primary btn-big btn-block" onClick={() => void createVideo()} disabled={busy}>
          {busy ? t('Начинаем…') : t('Создать видео')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => enterPickSpeed('summary')} disabled={busy}>
          <IconSpeed size={22} /> {t('Изменить скорость')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => setResetConfirm(true)} disabled={busy}>
          {t('Начать заново')}
        </button>
      </>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <TopBar
        title={displayName(session.name)}
        onBack={() => {
          if (hasEdits || step !== 'askCut') setExitConfirm(true);
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
          style={{ width: '100%', maxHeight: '40vh', background: '#000', display: 'block', cursor: 'pointer' }}
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
        {speed !== 1 ? <span className="badge num">{t('медленнее: {s}', { s: speed.toFixed(1) })}</span> : null}
      </div>

      <Timeline
        durationMs={durationMs}
        positionMs={positionMs}
        segments={segments}
        pendingStart={pendingStart}
        onSeek={seek}
      />

      {hint ? (
        <div className="card swap-enter" style={{ marginTop: 12, background: '#FFF7DE', boxShadow: 'none' }}>
          {hint}
        </div>
      ) : null}

      {/* ONE question at a time — swapped in place, never a separate page. */}
      <div className="card stack swap-enter" style={{ marginTop: 14 }} key={step}>
        {card}
      </div>

      <ConfirmDialog
        open={exitConfirm}
        title={t('Выйти из монтажа?')}
        body={t('Отмеченные части и скорость не сохранятся.')}
        confirmLabel={t('Выйти')}
        danger
        onConfirm={props.onExit}
        onCancel={() => setExitConfirm(false)}
      />
      <ConfirmDialog
        open={resetConfirm}
        title={t('Начать заново?')}
        body={t('Все отмеченные части и скорость будут убраны.')}
        confirmLabel={t('Начать заново')}
        danger
        onConfirm={startOver}
        onCancel={() => setResetConfirm(false)}
      />
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
  const [nameOpen, setNameOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  const openNaming = () => {
    setFileName(displayName(job.outputName));
    setNameOpen(true);
  };

  const confirmName = () => {
    if (!fileName.trim()) return;
    setNameOpen(false);
    setPickerOpen(true);
  };

  const save = async (folderId: string | null, folderName: string) => {
    setSaving(true);
    try {
      await api.post(`/api/edit/jobs/${job.id}/save`, { folderId, name: fileName.trim() });
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
        <div style={{ fontWeight: 600 }}>{displayName(job.outputName)}</div>
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
          <button className="btn btn-primary btn-big btn-block" onClick={openNaming}>
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

      <Dialog open={nameOpen} title={t('Как назвать файл?')} onClose={() => setNameOpen(false)}>
        <input
          className="input"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          maxLength={200}
          autoFocus
        />
        <div className="stack" style={{ marginTop: 16 }}>
          <button className="btn btn-primary btn-big btn-block" onClick={confirmName} disabled={!fileName.trim()}>
            {t('Далее')}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setNameOpen(false)}>
            {t('Отмена')}
          </button>
        </div>
      </Dialog>

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
