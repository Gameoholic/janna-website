import { useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import { ConfirmDialog, showToast, TopBar, copyText } from '../shared/ui';
import { IconCopy, IconMic, IconShare, IconStop } from '../shared/icons';
import { t } from '../shared/i18n';

interface VoiceJob {
  id: string;
  state: 'running' | 'done' | 'error';
  progress: number;
  text: string | null;
  error: string | null;
}

type Stage = 'idle' | 'recording' | 'transcribing';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VoiceApp() {
  const [stage, setStage] = useState<Stage>('idle');
  const [text, setText] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [canShare, setCanShare] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCanShare(typeof navigator.share === 'function');
    return () => {
      if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    const mimeType = pickMimeType();
    if (!mimeType) {
      showToast(t('Запись голоса не поддерживается на этом устройстве.'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast(t('Нет доступа к микрофону. Разрешите доступ и попробуйте снова.'));
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stopStream();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      void uploadAndTranscribe(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setElapsedSec(0);
    elapsedTimerRef.current = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    setStage('recording');
  };

  const stopRecording = () => {
    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    setStage('transcribing');
    recorderRef.current?.stop();
  };

  const pollJob = (jobId: string) => {
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const { job } = await api.get<{ job: VoiceJob }>(`/api/voice/jobs/${jobId}`);
        if (job.state === 'running') return;
        if (pollTimerRef.current) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        if (job.state === 'done') {
          // Never replaces existing text — a new take is added to what's already there.
          setText((prev) => (prev.trim() ? `${prev}\n${job.text ?? ''}` : job.text ?? ''));
        } else {
          showToast(t('Не получилось распознать речь. Попробуйте ещё раз.'));
        }
        setStage('idle');
      } catch {
        // keep polling through a transient network blip
      }
    }, 700);
  };

  const uploadAndTranscribe = async (blob: Blob) => {
    try {
      const form = new FormData();
      form.append('file', blob, 'recording.webm');
      const res = await fetch('/api/voice/jobs', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'failed');
      pollJob(data.job.id as string);
    } catch {
      showToast(t('Не получилось распознать речь. Попробуйте ещё раз.'));
      setStage('idle');
    }
  };

  const toggleRecord = () => {
    if (stage === 'recording') stopRecording();
    else if (stage === 'idle') void startRecording();
  };

  const doReset = () => {
    setText('');
    setResetConfirm(false);
  };

  return (
    <div className="page" style={{ maxWidth: 560, paddingBottom: 24 }}>
      <TopBar title={t('Голос')} />
      <div className="stack swap-enter">
        <div className="card center" style={{ padding: '18px 20px' }}>
          <button
            className={`btn btn-big ${stage === 'recording' ? 'btn-danger' : 'btn-primary'}`}
            style={{ width: 80, height: 80, borderRadius: '50%', margin: '0 auto' }}
            onClick={toggleRecord}
            disabled={stage === 'transcribing'}
            aria-label={stage === 'recording' ? t('Остановить запись') : t('Начать запись')}
          >
            {stage === 'recording' ? <IconStop size={30} /> : <IconMic size={30} />}
          </button>
          <p style={{ marginTop: 10, fontSize: 18 }}>
            {stage === 'recording'
              ? t('Идёт запись… {t}', { t: fmtElapsed(elapsedSec) })
              : stage === 'transcribing'
                ? t('Распознаём речь…')
                : t('Нажмите и говорите')}
          </p>
          {stage === 'transcribing' ? <div className="spinner" style={{ margin: '10px auto 0' }} /> : null}
        </div>

        <textarea
          className="input"
          style={{ minHeight: 130, fontSize: 17, lineHeight: 1.5, resize: 'vertical' }}
          placeholder={t('Здесь появится распознанный текст. Его можно редактировать.')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="row-wrap">
          <button
            className="btn btn-primary btn-big"
            style={{ flex: '1 1 auto' }}
            disabled={!text.trim()}
            onClick={() => void copyText(text).then((ok) => showToast(ok ? t('Скопировано.') : t('Не получилось скопировать.')))}
          >
            <IconCopy size={22} /> {t('Копировать')}
          </button>
          {canShare ? (
            <button
              className="btn btn-soft btn-big"
              style={{ flex: '1 1 auto' }}
              disabled={!text.trim()}
              onClick={() => void navigator.share({ text }).catch(() => {})}
            >
              <IconShare size={22} /> {t('Поделиться')}
            </button>
          ) : null}
        </div>
        <button className="btn btn-ghost btn-block" disabled={!text.trim()} onClick={() => setResetConfirm(true)}>
          {t('Очистить')}
        </button>
      </div>

      <ConfirmDialog
        open={resetConfirm}
        title={t('Очистить текст?')}
        body={<p className="muted">{t('Весь распознанный текст будет удалён. Это нельзя отменить.')}</p>}
        confirmLabel={t('Очистить')}
        danger
        onConfirm={doReset}
        onCancel={() => setResetConfirm(false)}
      />
    </div>
  );
}
