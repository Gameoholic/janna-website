import { useCallback, useEffect, useRef, useState } from 'react';
import '../shared/tokens.css';
import { api, ApiError } from '../shared/api';
import { copyText, ProgressBar } from '../shared/ui';
import { getLang, setLang } from '../shared/i18n';

/**
 * Hidden maintenance panel (P11). Reached only via /dev?key=SECRET (printed
 * in the server log on startup). English is fine here — she never sees it.
 */

interface Overview {
  devices: { id: string; name: string; created_at: number; last_seen: number | null; has_push: number }[];
  counts: Record<string, number>;
  storage: Record<string, number>;
  disk: { total: number; free: number; used: number };
  sseClients: number;
  leadTimesMs: number[];
  uptimeSec: number;
  node: string;
}

interface DeployStatus {
  available: boolean;
  branch?: string;
  localShort?: string;
  localMessage?: string;
  localDate?: string;
  behind?: number;
  commits?: { sha: string; message: string; date: string }[];
  dirty?: boolean;
  error?: string;
  message?: string;
}

interface DeployJob {
  status: 'idle' | 'running' | 'done' | 'error';
  log: string;
  startedAt: number | null;
  finishedAt: number | null;
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function DevApp() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [codes, setCodes] = useState<{ code: string; note: string; usedAt: number | null; url: string }[]>([]);
  const [shares, setShares] = useState<{ token: string; fileName: string; url: string }[]>([]);
  const [logs, setLogs] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [leads, setLeads] = useState('');
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [deployJob, setDeployJob] = useState<DeployJob | null>(null);
  const pollRef = useRef<number | null>(null);

  const say = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 4000);
  };

  const refreshDeployStatus = useCallback(async () => {
    try {
      setDeployStatus(await api.get<DeployStatus>('/api/admin/deploy/status'));
    } catch {
      setDeployStatus({ available: false });
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const data = await api.get<Overview>('/api/admin/overview');
      setOverview(data);
      setLeads(data.leadTimesMs.map((ms) => String(Math.round(ms / 60000))).join(', '));
      setAuthorized(true);
      const codesRes = await api.get<{ codes: typeof codes }>('/api/admin/setup-codes');
      setCodes(codesRes.codes);
      const sharesRes = await api.get<{ shares: typeof shares }>('/api/admin/shares');
      setShares(sharesRes.shares);
      await refreshDeployStatus();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthorized(false);
    }
  }, [refreshDeployStatus]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const pollDeployJob = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const job = await api.get<DeployJob>('/api/admin/deploy/update/current');
        setDeployJob(job);
        if (job.status !== 'running') {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          await refreshDeployStatus();
        }
      } catch {
        // App container is likely mid-restart from its own rebuild — keep
        // retrying silently until it comes back.
      }
    }, 1500);
  }, [refreshDeployStatus]);

  const startDeploy = async () => {
    if (!window.confirm('Pull the latest commits and rebuild? The app container restarts (a few seconds of downtime).')) return;
    try {
      await api.post('/api/admin/deploy/update');
      setDeployJob({ status: 'running', log: '', startedAt: Date.now(), finishedAt: null });
      pollDeployJob();
    } catch (e) {
      say(e instanceof Error ? e.message : 'Failed to start deploy.');
    }
  };

  if (authorized === null) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!authorized) {
    return (
      <div style={{ padding: 40, maxWidth: 640 }}>
        <h1>Not authorized</h1>
        <p>
          Open <code>/dev?key=SECRET</code> — the secret is printed in the server log on startup
          (<code>developer entry: …</code>).
        </p>
      </div>
    );
  }

  const post = async (url: string, body?: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api.post(url, body);
      say('Done.');
      await loadAll();
    } catch (e) {
      say(e instanceof Error ? e.message : 'Failed.');
    }
  };

  return (
    <div className="page" style={{ maxWidth: 860, fontSize: 16 }}>
      <h1 style={{ margin: '10px 0 20px' }}>Maintenance</h1>
      {message ? <div className="card" style={{ marginBottom: 14, background: '#FFF7DE' }}>{message}</div> : null}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>App language (testing)</h2>
        <p className="muted small">
          Her apps are always Russian. This switch is only for you — it flips Видео / Файлы /
          Напоминания to English so you can test more easily. Open apps reload automatically.
          Shortcut: add <code>?lang=en</code> or <code>?lang=ru</code> to any app URL.
        </p>
        <div className="row-wrap">
          <button
            className={`btn btn-compact ${getLang() === 'ru' ? 'btn-primary' : ''}`}
            onClick={() => setLang('ru')}
          >
            Русский (her mode){getLang() === 'ru' ? ' ✓' : ''}
          </button>
          <button
            className={`btn btn-compact ${getLang() === 'en' ? 'btn-primary' : ''}`}
            onClick={() => setLang('en')}
          >
            English (testing){getLang() === 'en' ? ' ✓' : ''}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Deploy from GitHub</h2>
        {!deployStatus ? (
          <p className="muted small">Loading…</p>
        ) : !deployStatus.available ? (
          <p className="muted small">
            Updater sidecar not configured — set <code>HOST_REPO_PATH</code> and <code>UPDATER_TOKEN</code> in{' '}
            <code>.env</code>, then <code>docker compose up -d --build</code> once over SSH to bring it up. See
            docs/SETUP.md.
          </p>
        ) : deployStatus.error ? (
          <p style={{ color: 'var(--danger)' }}>
            {deployStatus.message || deployStatus.error}
          </p>
        ) : (
          <>
            <p>
              Branch <b>{deployStatus.branch}</b> · running <code>{deployStatus.localShort}</code> «
              {deployStatus.localMessage}»
            </p>
            {deployStatus.dirty ? (
              <p style={{ color: 'var(--danger)' }}>⚠ The Pi's checkout has local changes — resolve over SSH before updating.</p>
            ) : deployStatus.behind === 0 ? (
              <p style={{ color: 'var(--ok)', fontWeight: 600 }}>✓ Up to date.</p>
            ) : (
              <>
                <p style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: 4 }}>
                  {deployStatus.behind} commit{deployStatus.behind === 1 ? '' : 's'} behind:
                </p>
                <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 14 }}>
                  {deployStatus.commits?.map((c) => (
                    <li key={c.sha}>
                      <code>{c.sha}</code> {c.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="row-wrap">
              <button className="btn btn-compact" onClick={() => void refreshDeployStatus()}>
                Check for updates
              </button>
              <button
                className="btn btn-compact btn-primary"
                disabled={!!deployStatus.dirty || deployStatus.behind === 0 || deployJob?.status === 'running'}
                onClick={() => void startDeploy()}
              >
                Pull &amp; redeploy
              </button>
            </div>
            {deployJob && deployJob.status !== 'idle' ? (
              <div style={{ marginTop: 14 }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  {deployJob.status === 'running' ? (
                    <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3, marginRight: 10 }} />
                  ) : null}
                  <b>
                    {deployJob.status === 'running' ? 'Deploying…' : deployJob.status === 'done' ? '✓ Deployed' : '✗ Failed'}
                  </b>
                </div>
                <pre
                  style={{
                    fontSize: 12,
                    maxHeight: 280,
                    overflowY: 'auto',
                    overflowX: 'auto',
                    background: '#101418',
                    color: '#D1E7DD',
                    padding: 12,
                    borderRadius: 8,
                  }}
                >
                  {deployJob.log || '…'}
                </pre>
              </div>
            ) : null}
          </>
        )}
      </div>

      {overview ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <h2>Status</h2>
          <p>
            Files: <b>{overview.counts.files}</b> in <b>{overview.counts.folders}</b> folders · Shares:{' '}
            <b>{overview.counts.shares}</b> · Reminders scheduled: <b>{overview.counts.remindersScheduled}</b>,
            ringing: <b>{overview.counts.remindersRinging}</b> · Edit jobs: <b>{overview.counts.editJobs}</b>
          </p>
          <p>
            Storage — media: <b>{fmtBytes(overview.storage.media)}</b>, thumbs: <b>{fmtBytes(overview.storage.thumbs)}</b>,
            editor: <b>{fmtBytes(overview.storage.editor)}</b>, trash: <b>{fmtBytes(overview.storage.trash)}</b>
          </p>
          <div style={{ margin: '10px 0' }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="grow">Disk (whole device)</span>
              <span>
                <b>{fmtBytes(overview.disk.used)}</b> / {fmtBytes(overview.disk.total)} used ·{' '}
                {fmtBytes(overview.disk.free)} free
              </span>
            </div>
            <ProgressBar value={overview.disk.total ? overview.disk.used / overview.disk.total : 0} />
          </div>
          <p>
            Open app windows (SSE): <b>{overview.sseClients}</b> · Uptime: <b>{Math.round(overview.uptimeSec / 60)} min</b> · Node{' '}
            {overview.node}
          </p>
          <div className="row-wrap">
            <button className="btn btn-compact" onClick={() => void post('/api/admin/test-alarm', { text: 'Проверка будильника', delaySec: 5 })}>
              Test alarm in 5s
            </button>
            <button className="btn btn-compact" onClick={() => void post('/api/admin/provision-self', { name: 'Developer browser' })}>
              Provision THIS browser as her device
            </button>
            <button
              className="btn btn-compact"
              onClick={() => void post('/api/admin/edits/cleanup', { olderThanDays: 7 }, 'Move editor files older than 7 days to trash?')}
            >
              Clean editor (&gt;7 days)
            </button>
            <button className="btn btn-compact" onClick={() => void post('/api/admin/trash/empty', {}, 'Permanently delete everything in trash?')}>
              Empty trash
            </button>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Devices</h2>
        {overview?.devices.length === 0 ? <p>No devices yet.</p> : null}
        {overview?.devices.map((d) => (
          <div key={d.id} className="row" style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
            <span className="grow">
              <b>{d.name}</b> — push: {d.has_push ? 'yes' : 'no'} · last seen:{' '}
              {d.last_seen ? new Date(d.last_seen).toLocaleString() : 'never'}
            </span>
            <button
              className="btn btn-compact"
              onClick={async () => {
                const name = window.prompt('New name', d.name);
                if (name) {
                  await api.patch(`/api/admin/devices/${d.id}`, { name }).catch(() => say('Failed.'));
                  await loadAll();
                }
              }}
            >
              Rename
            </button>
            <button
              className="btn btn-compact"
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                if (window.confirm(`Revoke device "${d.name}"? It will need a new setup link.`)) {
                  await api.del(`/api/admin/devices/${d.id}`).catch(() => say('Failed.'));
                  await loadAll();
                }
              }}
            >
              Revoke
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input grow" placeholder="Device note (e.g. Phone A31)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-compact btn-primary"
            onClick={async () => {
              try {
                const res = await api.post<{ url: string }>('/api/admin/setup-codes', { note });
                await copyText(res.url);
                say('Setup link created and copied to clipboard.');
                setNote('');
                await loadAll();
              } catch (e) {
                say(e instanceof Error ? e.message : 'Failed.');
              }
            }}
          >
            New setup link
          </button>
        </div>
        {codes.filter((c) => !c.usedAt).map((c) => (
          <div key={c.code} className="row" style={{ padding: '6px 0' }}>
            <span className="grow" style={{ fontSize: 13, wordBreak: 'break-all' }}>
              {c.note || '(no note)'}: {c.url}
            </span>
            <button className="btn btn-compact" onClick={() => void copyText(c.url).then(() => say('Copied.'))}>
              Copy
            </button>
            <button
              className="btn btn-compact"
              onClick={async () => {
                await api.del(`/api/admin/setup-codes/${c.code}`).catch(() => say('Failed.'));
                await loadAll();
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Share links</h2>
        {shares.length === 0 ? <p>None.</p> : null}
        {shares.map((s) => (
          <div key={s.token} className="row" style={{ padding: '6px 0' }}>
            <a className="grow" href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 14, wordBreak: 'break-all' }}>
              {s.fileName}
            </a>
            <button
              className="btn btn-compact"
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                if (window.confirm(`Revoke link for "${s.fileName}"?`)) {
                  await api.del(`/api/admin/shares/${s.token}`).catch(() => say('Failed.'));
                  await loadAll();
                }
              }}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Reminder lead notifications (global)</h2>
        <p className="muted small">Minutes before the alarm when a heads-up push is sent. Comma-separated.</p>
        <div className="row">
          <input className="input grow" value={leads} onChange={(e) => setLeads(e.target.value)} />
          <button
            className="btn btn-compact btn-primary"
            onClick={async () => {
              const values = leads
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0)
                .map((minutes) => minutes * 60000);
              try {
                await fetch('/api/admin/settings', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ leadTimesMs: values }),
                });
                say('Saved.');
                await loadAll();
              } catch {
                say('Failed.');
              }
            }}
          >
            Save
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Logs</h2>
        <button
          className="btn btn-compact"
          onClick={async () => {
            const res = await fetch('/api/admin/logs?lines=500');
            setLogs(await res.text());
          }}
        >
          Load last 500 lines
        </button>
        {logs ? (
          <pre style={{ fontSize: 12, overflowX: 'auto', background: '#101418', color: '#D1E7DD', padding: 12, borderRadius: 8 }}>
            {logs}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
