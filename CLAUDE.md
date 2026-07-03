# CLAUDE.md

Guidance for Claude Code working in this repo. Read this, then read
`master-prompt.md` before making UX decisions.

## What this is

A personal platform for **one specific elderly Russian-speaking user**. Three
separate installable PWAs — **Видео** (video editor), **Файлы** (storage),
**Напоминания** (reminders) — served by one Node backend.

## Prime directive

`master-prompt.md` is the constitution. It separates **intent** (P1–P12,
immutable — the *why*) from **suggested implementation** (changeable — the
*how*). When a suggested mechanism conflicts with an intent, keep the intent
and drop the mechanism. If a real platform limit blocks an intent, **say so
explicitly** — never ship a silent downgrade dressed up as success.

## Non-negotiable constraints (check every change against these)

- **Everything she sees is Russian.** All UI, errors, empty states, edge
  cases. 24-hour time, Russian dates («понедельник, 5 января»), Monday-first
  weeks. No English anywhere in her view. (The `/dev` panel is English-only and
  she never sees it — that's fine.)
- **Two target devices:** Samsung Galaxy A31 (~412px, primary) and Windows 7
  Chrome ~109. The web build targets `chrome109` — no bleeding-edge APIs; if
  unsure, feature-detect and degrade. **Nothing may overflow 412px.**
- **Big, well-spaced targets.** Adjacent tap targets must never sit close
  enough to mis-tap (a real past failure). Use the sizing/spacing tokens.
- **Flow beats size (P2).** After any action, the result and its next step
  appear *in place* — never send her to another screen/button to find what she
  just made. This is the whole reason the project exists.
- **No login UI, ever (P7).** Auth is a long-lived device cookie set by a
  one-time setup link. Don't add username/password anywhere.
- **Never modify originals (P10).** Editing produces a new file; deletes are
  confirmed and go to `trash/`; nothing auto-purges.
- **Familiar patterns (P4).** Файлы is the WhatsApp model: folders in a
  sidebar, contents on the right. Don't invent new navigation metaphors.
- **Shared components (P12).** The folder picker, confirm dialogs, back/«Готово»
  controls, alarm takeover live in `web/src/shared/` and are reused across all
  three apps. Change them there, not per-app.

## Commands

```bash
npm run build      # server (tsc) + web (vite build, target chrome109)
npm run check      # typecheck both workspaces, no emit — run before finishing
npm start          # serve built app on :8077 (admin URL printed in log)
npm run dev:server # tsx watch; npm run dev:web = vite :5173 proxying to :8077
```

npm workspaces: `-w server` / `-w web` to target one. ffmpeg + ffprobe must be
on PATH. Verify behaviour by building, `npm start`, and driving the HTTP API
end-to-end (provision a device via the `/dev?key=` admin cookie, then exercise
the flow) — not just typecheck. PWA/push only behave correctly in the built app.

## Architecture

- **Single origin.** One backend serves the API, the three frontends, the
  public per-file share pages, and the hidden dev panel.
- **`server/src/`** — Express + TypeScript. `db.ts` (better-sqlite3, single
  migrations array, `user_version`), `auth.ts` (device + admin cookies),
  `ffmpeg.ts` + `jobs.ts` (edit jobs: keep-segments jumpcut + pitch-preserved
  `atempo` speed, single `filter_complex` pass), `scheduler.ts` (5s tick fires
  reminders, sends lead pushes), `push.ts` (Web Push/VAPID), `sse.ts` (ring/stop
  channel), `routes/`.
- **`web/src/`** — React + Vite. `shared/` (tokens.css design system,
  AppShell device gate, Picker, alarm client + takeover, russian.ts formatting,
  api.ts). One app each in `video/ files/ reminders/ devpanel/`. Multi-page
  Vite build, one HTML entry per app.
- **`web/public/sw.js`** — root-scoped service worker shared by all three apps:
  receives pushes, mirrors ring/stop to open windows, shells cache. Plain ES5-ish
  JS (must run on Chrome 109). Three `.webmanifest` files → three home icons.
- **SQLite metadata, binaries on disk** under `data/` (`DATA_DIR`). Never store
  media as DB blobs.

## Reminders = alarm, not notification (P9)

Open app on any device → full-screen takeover (loud sound + vibrate). Closed /
locked device → strongest available push (can't self-launch — OS limit,
documented, not a bug). First «OK» anywhere dismisses everywhere (server pushes
`stop`). Snooze is allowed **once** («Показать через 5 минут»), then OK-only.
Lead-time settings are dev-only and global.

## Sharing (Section 7)

Per-file permanent link → unguessable token → one file only. The public page
exposes nothing else (no folders, no app, no traversal). OG tags + thumbnail so
WhatsApp shows thumbnail + title; true in-bubble playback is impossible for a
custom domain — don't pretend otherwise. Deleting the file kills the link.

## Conventions & gotchas

- **User-facing UI text goes through `t('<Russian>')`** from
  `web/src/shared/i18n.ts` and needs a matching entry in `web/src/shared/dict.ts`
  (keyed by the exact Russian string). This powers a **developer-only** EN/RU
  switch (dev panel, or `?lang=en`) for testing — she always sees Russian; the
  default is 'ru' and a missing dict entry falls back to Russian. When you add a
  new string, wrap it in `t()` and add its English to `dict.ts`. Interpolate with
  `t('… {x} …', { x })`.
- Russian plural/date helpers exist in both `server/src/util.ts` and
  `web/src/shared/russian.ts` — reuse them; don't hand-format dates. The
  `web` ones are locale-aware (follow the language switch); the server always
  emits Russian.
- Every user-facing error/empty/edge state needs a friendly Russian string.
  Server fallbacks already return Russian; keep it that way.
- **Control characters in source** (e.g. a regex range for control bytes):
  write them as backslash-u escape sequences, never literal bytes — the Write
  tool can otherwise embed raw control bytes that render invisibly and make
  later Edits fail to match. If an Edit mysteriously won't match, check `od -c`.
- Filenames may be Cyrillic; multipart uploads are re-decoded latin1→utf8 in
  `routes/files.ts` (`fixUploadName`). Keep that when touching upload code.

## Explicit non-goals (don't build — Section 12)

No account/login system, no multi-user, no backups, no native app/APK (pure
PWA), no bulk WhatsApp import, no video features beyond keep-cuts +
pitch-preserved 0.6–0.9× speed, no date-based file search, no public browsing
of storage, and lead-time settings are never shown to her.
