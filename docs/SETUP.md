# Setup & Operations Guide (for the developer)

Everything **she** sees is Russian. Everything here is for you.

The platform is three installable PWAs served by one Node backend:

| App | URL | Home-screen icon |
|---|---|---|
| Видео (video editor) | `/video/` | blue, play triangle |
| Файлы (storage) | `/files/` | orange, folder |
| Напоминания (reminders) | `/reminders/` | red, bell |

One origin, one root service worker (`/sw.js`), three manifests → three separate
icons (P8). SQLite metadata + binaries on disk under `data/`. FFmpeg does video
work server-side.

---

## 1. Local development

Prereqs: Node 22+, ffmpeg + ffprobe on PATH.

```bash
npm install
npm run gen:icons     # regenerates web/public/icons/*
npm run gen:alarm     # regenerates web/public/alarm.mp3 (needs ffmpeg)
npm run build         # server (tsc) + web (vite)
npm start             # serves everything on http://localhost:8077
```

Watch-mode development (two terminals):

```bash
npm run dev:server    # tsx watch, port 8077
npm run dev:web       # vite on 5173, proxies /api,/s,/setup to 8077
```

Note: the PWA/service-worker/manifest behavior is only fully realistic in the
production build (`npm run build && npm start`).

## 2. First run — the hidden developer entry (P11)

On startup the server log prints:

```
developer entry: http://localhost:8077/dev?key=<SECRET>
```

Opening that URL sets a long-lived admin cookie and opens the maintenance
panel: status/storage, devices, setup links, share links, global reminder
lead-times, logs, test alarm, editor cleanup, trash. The secret persists in
the DB (`settings.admin_secret`); the same key works after restarts.

The panel is invisible from her apps — nothing links to it.

## 3. Deploying on the Raspberry Pi (or any server)

```bash
cp .env.example .env    # fill in token + origin + TZ
docker compose up -d --build
```

- Data lives in `./data` on the host (DB, media, thumbnails, logs, trash).
- Set `TZ` to her timezone — push-notification dates are formatted with it.
- Updating: `git pull && docker compose up -d --build`. SQLite migrations run
  automatically on boot.

### "Deploy from GitHub" button (optional, one-time setup)

The dev panel (§2) can show how many commits behind `origin/main` the Pi is
and pull + rebuild + restart with one click, instead of SSHing in for every
change. It works via a small **updater sidecar** (`deploy/updater/`) — a
separate container holding only `git` + the Docker CLI, kept apart from the
main app on purpose: it's the one thing with access to the Docker socket and
your repo checkout, so a bug or compromise in the (much larger) app container
doesn't hand that access over too.

**Be aware:** Docker-socket access is root-equivalent on the host — anything
with that socket can run arbitrary containers with arbitrary mounts. This is
reasonable for a personal Pi with a single trusted operator (you), same as
SSH access already implies. Skip this whole section if you'd rather not grant
it; every other feature works fine without it, the panel just won't show the
deploy card.

One-time setup, over SSH on the Pi:

```bash
# In .env, alongside the other values:
echo "HOST_REPO_PATH=$(pwd)" >> .env       # must be the repo's real path on THIS host
echo "UPDATER_TOKEN=$(openssl rand -hex 24)" >> .env
docker compose up -d --build               # brings up the new `updater` service too
```

After that, the panel's **Deploy from GitHub** card lists pending commits and
has a **Pull & redeploy** button — it runs `git pull --ff-only` then
`docker compose up -d --build app` on the Pi and streams the log back live.
It refuses to run if the checkout has local modifications or is already
current. Only the `app` container restarts; `updater` and `cloudflared` are
untouched, so the job survives the app's own restart.

### Cloudflare Tunnel (HTTPS + stable hostname, no port forwarding)

1. Cloudflare Zero Trust → Networks → Tunnels → **Create a tunnel** (Docker).
2. Put the token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. In the tunnel's **Public Hostname** tab: hostname e.g.
   `babushka.example.com` → service `http://app:8077`.
4. Set `PUBLIC_ORIGIN=https://babushka.example.com` in `.env` and
   `docker compose up -d` again.

HTTPS is required for PWA install, Web Push and the clipboard button.

## 4. Provisioning her devices (P7 — no logins, ever)

1. Open the dev panel → **Devices** → type a note (e.g. `Phone A31`) →
   **New setup link** (it's copied to your clipboard).
2. Open that link **once, in Chrome, on her device**.
   - Careful: if you send it through WhatsApp and she taps it, it opens in
     WhatsApp's built-in browser and provisions *that*, not Chrome. Either
     open Chrome and paste the link yourself, or in WhatsApp use
     ⋮ → «Открыть в Chrome».
3. The device gets a 10-year cookie and never sees any login UI. Links are
   single-use; unused ones can be deleted in the panel.
4. Provision your own browser the same way, or press **“Provision THIS
   browser as her device”** in the panel — you then see exactly what she sees
   (same single identity).

Revoking a device (lost phone): panel → Devices → Revoke.

## 5. Installing the three icons

**Her phone (Galaxy A31, Chrome):** visit `/video/`, Chrome menu ⋮ →
«Установить приложение» (or «Добавить на главный экран»). Repeat for
`/files/` and `/reminders/`. Three icons, Russian names, each opens
full-screen straight into its tool.

**Her PC (Windows 7, Chrome ~109):** visit each URL → install icon at the
right of the address bar (or menu → «Сохранить и поделиться» → «Установить»).
Creates desktop/start-menu entries. Pin all three to the desktop/taskbar.

## 6. Making reminders reliable on the phone (required, one-time)

A web app cannot force-launch itself when closed or when the phone is locked —
OS restriction. Open apps get the full-screen takeover via the realtime
channel; closed devices get a **high-priority push** with sound/vibration that
opens the alarm on tap. For that push to be reliable and on time on a Samsung:

1. In **Напоминания**, tap **«Разрешить»** on the notifications card once
   (this registers Web Push for the device).
2. Android Settings → Apps → **Chrome** → Battery → **Unrestricted**
   (не ограничивать / неограниченно).
3. Settings → Battery and device care → Battery → Background usage limits →
   **Never sleeping apps** → add **Chrome**.
   Also turn off «Put unused apps to sleep» if present.
4. Settings → Apps → Chrome → Notifications: make sure they're allowed and
   set to alert (not silent).
5. Test from the dev panel: **Test alarm in 5s** — once with the app open
   (full red takeover + sound), once with the phone locked (loud
   notification; tapping it opens the alarm screen).

The PC being on is the designed fallback: if any app is open on the PC, it
does the full takeover regardless of the phone. Dismissing on either device
stops the other within seconds (server-pushed «stop»).

Lead-time heads-ups (default 24 h / 1 h / 5 min before) are ordinary quieter
notifications; configure them globally in the panel. She never sees these
settings (explicit non-goal).

## 7. Data layout & safety

```
data/
  db/janna.db        SQLite (metadata, devices, reminders, tokens, settings)
  media/             her files (named <id>.<ext>; display names live in DB)
  thumbs/            generated thumbnails
  editor/sources     videos uploaded straight into the editor
  editor/outputs     rendered results (kept so «Скачать» keeps working)
  trash/             everything she "deletes" lands here first (P10 safety)
  logs/app.log       rotating log (view from the panel)
```

- Editing never touches originals; results are new files (P10).
- Her «Удалить» moves binaries to `trash/` and removes them from the app.
  Actually reclaiming disk space is a developer act: panel → **Empty trash**.
- Editor leftovers: panel → **Clean editor (>7 days)** (files she picked from
  Файлы are never touched by this — only editor uploads/outputs).
- Backups are explicitly out of scope for now; if you ever want one anyway,
  `data/` is the entire state.

## 8. Honest platform limits (encoded on purpose — don't "fix" silently)

- **No self-launching alarms when everything is closed** — strongest push
  instead (see §6). The takeover only happens in open apps.
- **WhatsApp shows thumbnail + title for share links, not an inline player.**
  True in-bubble playback exists only for natively-supported hosts. The link
  opens a clean, isolated player page showing exactly one file.
- **Alarm sound in an open tab needs one prior user interaction** per browser
  session (autoplay policy). The apps unlock audio on her first tap; the
  takeover + vibration + push sound do not depend on it.

## 9. Test matrix

Before shipping changes: Galaxy A31 Chrome (primary), Windows 7 Chrome ~109
(the web build targets `chrome109`), your own browser. Check: nothing
overflows 412 px, targets stay comfortably apart, all text Russian, every
screen has a way back.
