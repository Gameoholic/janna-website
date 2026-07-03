# janna-website

Three apps for my grandma — **Видео** (video editor), **Файлы** (storage),
**Напоминания** (reminders) — on one Node backend. The design rules are in
[master-prompt.md](master-prompt.md); deep ops detail in
[docs/SETUP.md](docs/SETUP.md). This file covers just two things:

1. [Run it locally to test](#1-run-it-locally)
2. [Deploy it and connect our devices](#2-deploy-on-a-server)

Needs **Node 22+** and **ffmpeg + ffprobe on PATH**.

---

## 1. Run it locally

**Step 1 — build and start**

```bash
npm install        # first time only
npm run build
npm start
```

The server is now at **http://localhost:8077**. Leave this terminal running.

**Step 2 — get your dev-page link**

When the server starts it prints a line in the terminal like:

```
developer entry: http://localhost:8077/dev?key=Pb0Sl6...
```

That full URL (with the `key=...`) is how you open the **dev page** — the
hidden admin panel. The key is secret and stays the same unless you delete the
`data/` folder. Copy the whole line from your terminal.

**Step 3 — connect this browser**

Paste that dev URL into your browser. A plain admin page opens. Click
**“Provision THIS browser as her device.”** Done — this browser is now
connected and won't ask again.

**Step 4 — open the apps**

```
http://localhost:8077/video/         Видео
http://localhost:8077/files/         Файлы
http://localhost:8077/reminders/     Напоминания
```

**Testing in English:** add `?lang=en` to any app URL
(e.g. `http://localhost:8077/files/?lang=en`), or use the language buttons on
the dev page. `?lang=ru` switches back. (She always sees Russian.)

**Reset everything:** stop the server, delete the `data/` folder, start again.

---

## 2. Deploy on a server

This runs it on a real machine (e.g. a Raspberry Pi) with HTTPS, so it works
on her phone and yours. Needs **Docker**.

**Step 1 — set up a Cloudflare Tunnel** (free HTTPS, no port-forwarding)

1. In Cloudflare **Zero Trust → Networks → Tunnels**, create a tunnel (Docker).
2. Copy its **token**.
3. In its **Public Hostname** tab, add your hostname (e.g.
   `babushka.example.com`) pointing to service `http://app:8077`.

**Step 2 — configure and launch**

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `CLOUDFLARE_TUNNEL_TOKEN=` the token from step 1
- `PUBLIC_ORIGIN=https://babushka.example.com` your hostname
- `TZ=Europe/Moscow` her timezone

Then:

```bash
docker compose up -d --build
```

The site is now live at your hostname. Data lives in `./data` on the host.
To update later: `git pull && docker compose up -d --build`.

**Step 3 — open the dev page**

Find your admin key (printed in the container log):

```bash
docker compose logs app | grep "developer entry"
```

Open that URL but on your live domain, i.e.
`https://babushka.example.com/dev?key=THEKEY`. That's the dev page on the
server.

**Step 4 — connect your own device**

On the dev page, click **“Provision THIS browser as her device.”** You now see
exactly what she sees, on your own phone/PC.

**Step 5 — connect her devices** (phone + PC)

For each of her devices:
1. On the dev page → **Devices** → type a note (e.g. `Phone`) →
   **New setup link** (it copies to your clipboard).
2. Open that link **once, in Chrome, on her device.**
   ⚠️ If you send it via WhatsApp and she taps it, it opens in WhatsApp's
   browser and connects the wrong thing. Open Chrome and paste it yourself, or
   use WhatsApp's ⋮ → “Open in Chrome”.
3. The device is now connected for good — no login, ever.

**Step 6 — install the three app icons**

On each of her devices, visit each app URL and install it:
- Phone (Chrome): open `/video/`, menu ⋮ → **«Установить приложение»**. Repeat
  for `/files/` and `/reminders/`.
- PC (Chrome): the install icon appears at the right of the address bar.

Three separate Russian-named icons appear, each opening straight into its tool.

**Step 7 — make her reminders reliable** (Samsung phone, one time)

A closed phone can't be force-woken by a website, so reminders arrive as a
strong push — but Samsung must be told not to sleep Chrome:
1. In **Напоминания**, tap **«Разрешить»** on the notifications prompt once.
2. Android Settings → Apps → **Chrome** → Battery → **Unrestricted**.
3. Settings → Battery → Background usage limits → **Never sleeping apps** → add
   **Chrome**.
4. Test from the dev page: **“Test alarm in 5s”** — once with an app open, once
   with the phone locked.

(Full detail and the honest platform limits are in
[docs/SETUP.md](docs/SETUP.md) §6.)
