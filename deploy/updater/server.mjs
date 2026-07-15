import http from 'node:http';
import { execFile, spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 8090);
const TOKEN = process.env.UPDATER_TOKEN || '';
const REPO_DIR = process.env.REPO_DIR;
const BRANCH = process.env.DEPLOY_BRANCH || 'main';
const COMPOSE_FILE = process.env.COMPOSE_FILE || `${REPO_DIR}/docker-compose.yml`;

if (!REPO_DIR) {
  console.error('REPO_DIR env var is required (absolute path of the repo on the HOST).');
  process.exit(1);
}

/** In-memory record of the most recent (or in-flight) deploy job. Single job at a time is enough here. */
let job = { status: 'idle', log: '', startedAt: null, finishedAt: null };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: REPO_DIR, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function getStatus() {
  await run('git', ['fetch', '--quiet', 'origin', BRANCH]);
  const dirty = (await run('git', ['status', '--porcelain'])).length > 0;
  const behind = Number(await run('git', ['rev-list', '--count', `HEAD..origin/${BRANCH}`])) || 0;
  const [localShort, localMessage, localDate] = (
    await run('git', ['log', '-1', '--format=%h|%s|%ci', 'HEAD'])
  ).split('|');
  let commits = [];
  if (behind > 0) {
    const log = await run('git', ['log', `HEAD..origin/${BRANCH}`, '--format=%h|%s|%ci']);
    commits = log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, message, date] = line.split('|');
        return { sha, message, date };
      });
  }
  return { branch: BRANCH, localShort, localMessage, localDate, behind, commits, dirty };
}

function startUpdate() {
  job = { status: 'running', log: '', startedAt: Date.now(), finishedAt: null };
  const append = (s) => {
    job.log += s;
  };
  const steps = [
    ['git', ['pull', '--ff-only', 'origin', BRANCH]],
    ['docker', ['compose', '-f', COMPOSE_FILE, '--project-directory', REPO_DIR, 'up', '-d', '--build', 'app']],
  ];
  (async () => {
    try {
      for (const [cmd, args] of steps) {
        append(`$ ${cmd} ${args.join(' ')}\n`);
        await new Promise((resolve, reject) => {
          const child = spawn(cmd, args, { cwd: REPO_DIR });
          child.stdout.on('data', (d) => append(d.toString()));
          child.stderr.on('data', (d) => append(d.toString()));
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
          });
        });
      }
      append('\nDone.\n');
      job.status = 'done';
    } catch (e) {
      append(`\nERROR: ${e.message}\n`);
      job.status = 'error';
    } finally {
      job.finishedAt = Date.now();
    }
  })();
}

const server = http.createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (TOKEN && req.headers['x-updater-token'] !== TOKEN) {
    send(401, { error: 'unauthorized' });
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/status') {
      send(200, await getStatus());
      return;
    }
    if (req.method === 'POST' && req.url === '/update') {
      if (job.status === 'running') {
        send(409, { error: 'running', message: 'A deploy is already in progress.' });
        return;
      }
      const st = await getStatus();
      if (st.dirty) {
        send(409, { error: 'dirty', message: "The Pi's checkout has local changes — resolve over SSH first." });
        return;
      }
      if (st.behind === 0) {
        send(409, { error: 'up-to-date', message: 'Already up to date.' });
        return;
      }
      startUpdate();
      send(202, { started: true });
      return;
    }
    if (req.method === 'GET' && req.url === '/update/current') {
      send(200, job);
      return;
    }
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: 'failed', message: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, () => console.log(`updater listening on :${PORT}, repo=${REPO_DIR}, branch=${BRANCH}`));
