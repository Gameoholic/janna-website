# HANDOFF — Pi is dead, migrating to a Hetzner VPS

Written 2026-09-03. Read this top to bottom before doing anything.

---

## 0. DO THIS FIRST — SSH keys, then nuke password auth

The server currently accepts **root login with an emailed password**. That is
the worst thing about the current state: `65.108.91.184` is a public IP being
scanned continuously, and password auth on root is how boxes get owned. Fix
this before the data upload, not after.

Daniel's laptop is **Windows 10**. Run these in PowerShell.

**Step 1 — make a key (laptop):**

```powershell
ssh-keygen -t ed25519 -C "daniel-laptop"
# Accept the default path (C:\Users\Daniel\.ssh\id_ed25519).
# A passphrase is optional; without one, logins are unattended.
```

**Step 2 — install the public key on the server (laptop):**

There is no `ssh-copy-id` on Windows, so pipe it:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@65.108.91.184 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**Step 3 — prove key login works BEFORE disabling anything:**

```powershell
ssh root@65.108.91.184
```

It must let you in with **no password prompt**. If it still asks, stop and fix
that — do not proceed to step 4.

**Step 4 — disable password auth. Keep your working session open.**

Open a SECOND terminal for this. If you break sshd while logged in, the
already-open session is your way back.

Ubuntu on Hetzner ships a drop-in file that re-enables passwords and silently
overrides `/etc/ssh/sshd_config`. You must handle both:

```bash
# main config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# the drop-ins that override it — this is the step people miss
grep -rn "PasswordAuthentication" /etc/ssh/sshd_config.d/ 2>/dev/null
sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config.d/*.conf 2>/dev/null

# validate syntax BEFORE restarting, then apply
sshd -t && systemctl restart ssh
```

**Step 5 — verify from a THIRD terminal, others still open:**

```bash
ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@65.108.91.184
```

This must be **refused** (`Permission denied (publickey)`). If it prompts for a
password, a drop-in is still winning — recheck `/etc/ssh/sshd_config.d/`.

Then confirm a normal `ssh root@65.108.91.184` still works. Only now close the
other terminals.

**If you lock yourself out:** Hetzner Cloud console, the server, **Rescue** —
console access works without SSH. Nothing is lost.

**Optional hardening once the above works:** `apt install -y fail2ban`.

---

## 1. What happened

Her Pi (`10.0.0.5`, `/opt/janna-website`) fell off the Wi-Fi and never came
back. `app.jannawebsite.online` served Cloudflare **error 1033** — tunnel
registered, no connector attached.

Diagnosed on-site: a full ping sweep of `10.0.0.0/24` found only 3 hosts plus
the router; no Raspberry Pi MAC OUI in ARP; SSH and 8077 closed everywhere;
`raspberrypi.local` did not resolve. The Pi's green ACT LED was blinking, so it
**booted fine** — it simply never joined the Wi-Fi (`Kativ`, 5 GHz, channel 48).
Never diagnosed further, because Daniel chose to abandon the Pi entirely.

## 2. Data recovery — DONE and VERIFIED

SD card pulled and read on Windows with **DiskInternals Linux Reader** (Reader
mode, the `rootfs` partition, not `bootfs`), exported to:

```
C:\Users\Daniel\Downloads\janna-website-files\data
```

100 files, ~13 GB. Verified programmatically, all clean:

- SQLite `integrity_check` **ok**, `quick_check` **ok**, `foreign_key_check` empty.
- The 4 MB `-wal` was copied too, so the newest transactions are included.
- **26/26** rows in `files` present on disk with exactly matching byte sizes.
- **25/25** thumbnails present.
- 62 media containers deep-checked: MP4/MOV box chains and RIFF chunk chains
  walked end to end, all landing exactly on EOF. No truncation.
- Two false alarms, both benign and pre-existing: `elmkBekZ0zpj.jpg` has a
  Samsung `SEFT` trailer after its EOI marker, and `PiNr4MTnMba5.avi` has a
  92-byte trailing JUNK chunk the RIFF header does not count.

Not done: full frame-level decode (no ffmpeg on the laptop). Container
structure plus exact size match against the DB makes corruption very unlikely.

**This export is still the only copy.** Chase Daniel about a second copy.

## 3. Why a VPS and not Vercel

Daniel asked for Vercel first. It cannot run this app, and it is not a config
problem: no persistent filesystem for `data/` + SQLite; ffmpeg edit jobs run for
minutes past any function timeout; `faster-whisper` needs a warm process holding
a model in RAM; and `scheduler.ts` ticks every 5s with SSE holding long-lived
connections. It needs an always-on box.

## 4. Decisions already made

| Decision | Value | Why |
|---|---|---|
| Provider | Hetzner, `65.108.91.184` | ~6-7x cheaper than DO/Vultr for equal specs |
| Whisper model | **medium**, not large | Daniel's explicit call; already in `ALLOWED_MODELS` |
| Instance | shared vCPU, not dedicated | She transcribes a couple of times a day — bursts, not sustained load. A dedicated CCX was over-specced and reversed |
| Ingress | **Caddy + Let's Encrypt**, tunnel dropped | Daniel's call to stop using Cloudflare Tunnel |
| DNS | Namecheap BasicDNS | Daniel preferred it to the Cloudflare dashboard; the zone had only one record, so the move was cheap |
| Hostname | `app.jannawebsite.online`, unchanged | Keeps her 10-year device cookies valid — no re-provisioning |

## 5. Repo changes already made

- `docker-compose.yml` — `cloudflared` removed; **Caddy** added (ports 80/443,
  persistent `caddy_data` volume for certs); app rebound to `127.0.0.1:8077`
  so it is unreachable except through TLS.
- `deploy/Caddyfile` — new. `reverse_proxy app:8077` with `flush_interval -1`
  so SSE alarm events are not buffered (a buffered `stop` is a wrong alarm).
  Deliberately no request-body cap.
- `.env.example` — `SITE_DOMAIN` / `ACME_EMAIL` replace `CLOUDFLARE_TUNNEL_TOKEN`.
- `server/src/index.ts:33` — stale "behind the Cloudflare Tunnel" comment fixed.
  `trust proxy` stays correct with Caddy in front.
- `docs/MIGRATION.md` — the 9-step runbook. **Follow that for the actual steps.**

Not verified by typecheck: `node_modules` is not installed on the laptop, so
`npm run check` could not run. The only TS edit was a comment.

## 6. State as of this handoff

- [x] Data recovered and verified
- [x] Server bought, Ubuntu, `65.108.91.184`
- [x] Repo changes made
- [ ] **SSH keys + password auth disabled** — section 0, do this first
- [ ] DNS propagation. NS switched to Namecheap BasicDNS, `app` A record →
      `65.108.91.184`. As of writing it had **not** propagated: 8.8.8.8 and
      1.1.1.1 still returned Cloudflare's nameservers and proxy IPs
      (`104.21.85.143`, `172.67.206.168`). Verify with
      `dig +short app.jannawebsite.online` — it must print `65.108.91.184` alone
- [ ] `apt upgrade`, Docker install, `ufw` (22/80/443 only)
- [ ] Clone repo to `/opt/janna-website`
- [ ] Upload the 13 GB `data/`
- [ ] Write `.env` (MIGRATION.md step 6)
- [ ] `docker compose up -d --build`
- [ ] Verify (MIGRATION.md step 8)
- [ ] Set up backups — **there have never been any**
- [ ] Delete the old Cloudflare tunnel once verified

## 7. Gotchas

- **Do not `docker compose up` before DNS resolves to the new IP.** Caddy proves
  ownership over HTTP; failed issuance counts against Let's Encrypt rate limits.
- **`TZ` is unknown.** The old `.env` died with the Pi. The repo default is
  `Europe/Moscow`, but her router is Israeli (`10.0.0.138` gateway, Hebrew in
  the README) — likely `Asia/Jerusalem`. It formats push-notification dates.
  **Ask Daniel, do not guess.**
- **Nothing secret was lost.** `admin_secret`, `vapid_public`, `vapid_private`
  and `whisper_model` all live in the SQLite `settings` table, which was
  recovered. Her push subscriptions and the dev-panel key survive unchanged.
- **The 13 GB upload from a home connection may drop.** Prefer a resumable
  transfer; plain `scp -r` restarts from zero.
- `whisper_service.py:35` does not set `cpu_threads`, so faster-whisper takes
  every core and will fight ffmpeg during a simultaneous video render. Worth
  capping. Not done — deprioritised, not rejected.
- **`README.md` may contain live secrets in a GitHub repo.** It holds `/setup/`
  provisioning links and, until this commit, a plaintext SSH password. If
  `github.com/Gameoholic/janna-website` is public, treat those as exposed:
  make it private, and revoke the setup links from the dev panel.

## 8. Useful commands

```bash
ssh root@65.108.91.184
cd /opt/janna-website
docker compose ps
docker compose logs -f caddy      # certificate issuance
docker compose logs -f app
docker compose logs app | grep "developer entry"    # admin key
docker compose up -d --build
```
