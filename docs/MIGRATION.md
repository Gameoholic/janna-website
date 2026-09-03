# Migrating off the Raspberry Pi to a VPS

Written 2026-09-03, after the Pi dropped off her Wi-Fi and would not come back.
Data was recovered off the SD card with DiskInternals Linux Reader and verified
intact (26/26 files, DB `integrity_check` ok).

## Why a VPS and not Vercel

Vercel/Netlify/Cloudflare Pages cannot run this app, and it is not a config
problem:

- `data/` + SQLite need a **persistent filesystem**. Serverless has none.
- ffmpeg edit jobs run for **minutes**; serverless functions time out first.
- `faster-whisper` is a **warm Python process** holding a model in RAM.
- `scheduler.ts` ticks every 5s and SSE holds long-lived connections — both
  need an **always-on process**.

A plain VPS runs the existing `docker-compose.yml` unchanged. The
[Dockerfile](../Dockerfile) already notes it targets "Raspberry Pi arm64 and
x86 rented servers".

## Sizing

`data/` is ~13 GB today (mostly `media/`, one 2.3 GB and one 1.9 GB video).
Add Docker images, the whisper model cache, and room to grow.

**Recommended: Hetzner CX32** — 4 vCPU / 8 GB / 80 GB, ~€6.80/mo. Comfortably
faster than the Pi 5 for both ffmpeg and whisper `small`.
Cheaper floor: CX22 (2 vCPU / 4 GB / 40 GB, ~€3.79) — workable but tight on disk.

Any provider is fine (DigitalOcean, Vultr, Contabo). Ubuntu 24.04 LTS.

## Step 1 — second copy of the data (do this first)

The recovered folder is currently the ONLY copy. Before anything else, copy
`C:\Users\Daniel\Downloads\janna-website-files` to an external drive or cloud.

## Step 2 — provision the server

Create the VPS with Ubuntu 24.04 and your SSH key. Then:

```bash
ssh root@<NEW_IP>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
```

## Step 3 — clone the repo

```bash
mkdir -p /opt && cd /opt
git clone <your repo URL> janna-website
cd /opt/janna-website
```

## Step 4 — upload the data

From the Windows laptop (PowerShell, in `C:\Users\Daniel\Downloads`):

```powershell
scp -r .\janna-website-files\data root@<NEW_IP>:/opt/janna-website/
```

13 GB — expect a while on home upload. If it drops, `rsync` resumes:

```bash
rsync -avP --partial ./janna-website-files/data/ root@<NEW_IP>:/opt/janna-website/data/
```

Then on the server, sanity-check:

```bash
du -sh /opt/janna-website/data          # ~13G
ls /opt/janna-website/data/media | wc -l # 26
```

## Step 5 — DNS (do this BEFORE bringing anything up)

Caddy proves domain ownership over HTTP, so the name must already point here
or certificate issuance fails and Let's Encrypt rate-limits the retries.

At your DNS provider, set:

```
A   app.jannawebsite.online   ->   <NEW_IP>
```

If the domain is on Cloudflare DNS, set the record to **DNS only (grey cloud)**,
not Proxied. Orange-cloud proxying reimposes the ~100 MB request cap that
chunked uploads existed to work around — the same limit you left the tunnel to
escape.

Confirm it has propagated before continuing:

```bash
dig +short app.jannawebsite.online     # must print the new IP
```

## Step 6 — recreate `.env`

`.env` was NOT in the recovered `data/` folder. Rebuild it:

```bash
cd /opt/janna-website
cat > .env <<'ENVEOF'
SITE_DOMAIN=app.jannawebsite.online
ACME_EMAIL=danielvideosmail@gmail.com
PUBLIC_ORIGIN=https://app.jannawebsite.online
TZ=<her actual timezone — Asia/Jerusalem if she is in Israel, NOT the Europe/Moscow default>
HOST_REPO_PATH=/opt/janna-website
UPDATER_TOKEN=<openssl rand -hex 24>
DEPLOY_BRANCH=main
ENVEOF
```

`TZ` matters: it formats the dates in her push notifications. Set it
deliberately rather than taking the default.

**What you do NOT need to recreate** (all inside the recovered SQLite DB):
`admin_secret` (your `/dev?key=` link), `vapid_public` / `vapid_private` (Web
Push identity — so her existing subscriptions keep working), `whisper_model`,
her devices, folders, files, and share tokens.

There is no longer a `CLOUDFLARE_TUNNEL_TOKEN`.

## Step 7 — firewall, then bring it up

The app container is bound to `127.0.0.1:8077`, so only Caddy can reach it.
Lock the host down to match:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Set the same rules in the Hetzner Cloud firewall as a second layer — a
misconfigured `ufw` then cannot silently expose the box.

Then:

```bash
cd /opt/janna-website
docker compose up -d --build
docker compose logs -f caddy    # watch the certificate get issued
docker compose logs -f app
```

First build is slow (it pip-installs faster-whisper).

### Verifying TLS

```bash
curl -sI https://app.jannawebsite.online | head -3
```

A 200 or 302 means Caddy has a valid certificate. If you see a TLS error, check
`docker compose logs caddy` — nearly always DNS not yet resolving to this host,
or port 80 blocked by the firewall.

HTTPS is not cosmetic here: PWA install, Web Push, and the clipboard button all
require a secure origin, and [auth.ts](../server/src/auth.ts) only marks her
device cookie `secure` when it sees `X-Forwarded-Proto: https` from Caddy.

Because the hostname is unchanged, her device cookies (10-year, domain-scoped)
remain valid — **no re-provisioning, no setup links, no login**. That is the
whole reason for keeping the same origin.

## Step 8 — verify end to end

1. `https://app.jannawebsite.online/dev?key=<admin_secret>` opens the panel.
2. Файлы lists her folders and all 26 files; thumbnails render.
3. Open one video and scrub it.
4. Dev panel -> **Test alarm in 5s**, once with an app open, once with the
   phone locked.
5. Record something in Голос and confirm transcription returns Russian text
   (first run downloads the model unless `data/whisper-cache` came across —
   it did, so it should be instant).
6. Open an existing share link and confirm it still resolves.

## Step 9 — set up the backup that never existed

This outage happened with zero backups. Do not rebuild that situation.

```bash
# on the VPS
apt install -y restic          # or borgbackup
```

Minimum viable: a nightly cron that tars `data/db/` (small, the irreplaceable
metadata) and rsyncs `data/media/` to another host or object storage.
Snapshots at the provider are a second layer, not a substitute — they die with
the account.

## Notes

- The `updater` sidecar and its "Deploy from GitHub" button work the same on a
  VPS; `HOST_REPO_PATH` must be the real host path (`/opt/janna-website`).
- Keep the old SD card untouched until the VPS is verified working. It is the
  only other copy.
- Docker-socket access is root-equivalent; same caveat as on the Pi.
