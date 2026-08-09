# MASTER PROMPT — Grandma's Platform — v1

> **Status:** living document. We will refine this over many passes. Keep sections modular so individual parts can be edited without disturbing the rest.
>
> **Language of this document:** English (so the developer can edit it easily). **Language of everything the end user sees:** Russian, always. See P5.

---

## 0. HOW TO READ THIS DOCUMENT (instructions to the builder)

You are building a personal platform for one specific elderly user. This document has two kinds of content, and you must treat them differently:

- **Intent (immutable):** the *why*. This is the source of truth. You may never optimize it away, trade it off for elegance, or quietly degrade it. If you cannot honor an intent because of a real technical limit, **say so explicitly** — do not silently ship a lesser version.
- **Suggested implementation (changeable):** the *how*. These are concrete suggestions from one engineer. If you find an approach that serves the **intent** better, use it. Do not copy suggestions blindly. They encode intent; when a suggestion and an intent ever conflict, **the intent wins**.

Section 1 is the constitution. Sections 2–12 elaborate. Section 13 is scratch space for ongoing refinement.

---

## 1. IMMUTABLE CORE PRINCIPLES (the WHY — never remove or weaken these)

**P1 — One real person.** This is built for a single elderly Russian-speaking woman ("бабушка") in her golden years who finds technology hard. Every design decision is judged by one test: *can she do this by herself, without getting stuck, without asking for help, and without writing steps down on paper?* If the answer isn't clearly yes, it's wrong.

**P2 — She must never have to remember "what to do next," and results must appear where she is.** The hardest-won lesson of this project: a past app failed not because buttons were small (they were huge) but because **state lived in different places** — she recorded herself on one screen, then had to *remember* to go to a different button on a different screen to view it, and a third to change the music. She could do each step but couldn't hold the *flow* in her head. Therefore: after any action, the **result and its obvious next step appear right in front of her**. Never send her to a separate page/button to find what she just made.

**P3 — Simplicity beats power, and flow beats size.** Fewer choices, one clear path. Big, well-spaced targets matter — but a clear *flow* matters more. Big buttons alone already failed once.

**P4 — Familiar patterns over novel ones.** She navigates WhatsApp and mail.ru comfortably. Reuse layouts her hands already know. For storage specifically: **folders in a left sidebar, contents on the right — the WhatsApp model.** Don't invent new navigation metaphors when a familiar one exists.

**P5 — Everything she sees is in Russian.** All UI text, buttons, labels, placeholders, errors, empty states, confirmations, notifications. Russian date format (e.g., «понедельник, 5 января»), Russian day and month names, **24-hour time**. No English is ever visible to her, anywhere, in any state — including error and edge-case screens.

**P6 — Flawless on her phone, functional on her PC.** Her phone is a **Samsung Galaxy A31** (~412px logical width) and it is the primary device. Nothing may overflow horizontally. Interactive targets must never sit so close together that she mis-taps or taps the wrong one — a specific, real failure of past apps. Generous spacing, comfortable sizes. It must **also** work on her **Windows 7 PC in an old version of Chrome** (Chrome dropped Win7 support in early 2023, so assume ~Chrome 109). Keep the web platform conservative there.

**P7 — Private by default, but no login friction for her.** Only she — and the developer acting *as her* — can reach her data. She should **authenticate once per device and never see a login screen again**. There is no account system, no username/password UI for her. The only public surface is individual shared files (P8-adjacent), and each shared link exposes **exactly one file and nothing else** — never the rest of the site.

**P8 — Four separate, focused tools — not one hub of menus.** The tools are **separate things**, each with its **own app icon** on her phone: **Видео** (video editor), **Файлы** (storage), **Напоминания** (reminders), **Голос** (voice-to-text). She opens the one she wants and it does one job. Do **not** build a single app with a tree of menus she has to navigate — that's the confusion we're avoiding.

**P9 — Reminders are an alarm, not a notification.** She ignores ordinary notifications (she has dozens). A reminder must be **as loud and screen-covering as the platform technically allows**, and coordinated across her phone and PC so she cannot miss it and so dismissing it once stops it everywhere.

**P10 — Never destroy her originals.** Editing always produces a **new** file; the source is untouched. Deletions are always deliberate and confirmed. Nothing auto-deletes.

**P11 — The developer can help "as her" and maintain the system invisibly.** There is a hidden entry point (a secret URL or gesture) for the developer to act on her behalf and to maintain/inspect/fix the system. It is invisible during her normal use.

**P12 — Consistency across the four tools.** Shared visual language and shared interaction patterns (the folder picker, the back/«Готово» controls, transitions, confirmation dialogs) so that learning one tool helps with the others. Learning should transfer.

---

## 2. WHO SHE IS (persona — read this before making judgment calls)

- Elderly, Russian-speaking, finds technology difficult; **reads comfortably** (text is fine; it doesn't all need to be icons or audio).
- **Likes seeing numbers** — timestamps, clip lengths, exact times, speed values like `0.8`, `0.9`. Show her the numbers; she finds them reassuring, not intimidating.
- Comfortable with: **WhatsApp** (chat list + content, scrubbing media), **mail.ru**.
- Past failure to internalize: a recorder app with only 2–3 **huge** buttons still confused her, because the flow spanned multiple screens (record here → view there → music elsewhere). She had to be reminded what to tap and how to switch between recordings, and resorted to written notes she'd then lose. **This is the anti-pattern the whole platform exists to avoid.**
- Devices: **Galaxy A31** (primary), **Windows 7 + Chrome** (secondary; likely on when she's home).

---

## 3. IMPLEMENTATION FREEDOM (the prime directive, restated)

This is the single most important instruction for you as the builder:

- You may deviate from **any** suggested implementation in this document if you find something that serves the **intent (Section 1 + the "Intent" notes below)** better.
- Do **not** reproduce the specific mechanisms here just because they're written down. They exist to communicate *why*, not to pin down *how*.
- When a suggested mechanism conflicts with a principle, **drop the mechanism, keep the principle**.
- If a genuine technical limitation prevents you from fully honoring a principle (e.g., a browser restriction), **surface it clearly to the developer** and implement the closest honest approximation — never a silent downgrade dressed up as success.

---

## 4. GLOBAL TECHNICAL CONSTRAINTS

**Intent:** run easily on a Raspberry Pi at home, be reachable from the internet for share-links and reminders, keep the database dead-simple (no remote DB to connect to), and keep binaries safe on disk.

**Suggested implementation (changeable):**
- **Backend:** Node + Express + **TypeScript**.
- **Frontend:** **React + TypeScript**. (Auxiliary tooling/scripts in Node or Python are fine; the UI is React.)
- **Database:** **SQLite** — a single local file, no remote connection setup. Store **metadata** (files, folders, reminders, devices, share tokens) in SQLite; store **binaries on the filesystem**, not as DB blobs. Suggest `better-sqlite3` + a small migration setup.
- **Files on disk:** a structured data directory (e.g. `/data/media/...`) with metadata rows pointing to paths.
- **Containerization:** **Docker + docker-compose**, ARM-compatible images (runs on the Pi; also runnable on a rented server). **FFmpeg installed in the container** (ARM build).
- **Public reachability:** **Cloudflare Tunnel** → gives HTTPS + a stable public hostname with no port-forwarding. HTTPS is *required* anyway for PWA install, Web Push, and share links.
- **PWA:** installable; a service worker for the app shell + push. **Four manifests → four home-screen icons** (Видео / Файлы / Напоминания / Голос), same origin.
- **Conservative browser support:** transpile/polyfill down for old Chrome (Win7). Avoid bleeding-edge web APIs, or feature-detect and degrade. Test explicitly on **A31 Chrome** and **Win7 Chrome**.

---

## 5. ARCHITECTURE OVERVIEW (suggested — change if better serves the intent)

- A **single backend** serves: the API, the four installable frontends, and the public per-file share pages.
- **Single origin.** A **root-scoped service worker** handles push and broadcasts alarm ring/stop events to all open app windows (via the SW clients API / BroadcastChannel), so *whichever* of the four apps is open can show the alarm. **Four manifests** (different name/icon/start_url, same scope) produce four distinct home-screen icons per P8.
- A **real-time channel** (SSE or WebSocket) carries alarm ring state and **cross-device dismiss sync**.
- **Media delivery:** authenticated routes for her own browsing (with HTTP range requests for video/audio); **separate public routes** for single-file shares that never list or expose anything else.
- **Reminders scheduler** runs server-side so firing does not depend on any client being open.

---

## 6. AUTH & ACCESS — passwordless, once per device

**Intent (P7):** she authenticates once per device and never sees a login screen again; everything is private; the developer can enroll his own device to act as her; there's a hidden maintenance entry.

**Suggested implementation (changeable):**
- **First-run provisioning:** the developer generates a **one-time secret setup link/code**. Opening it on a device provisions that device — issues a **long-lived signed token** stored on the device (httpOnly cookie + persisted where appropriate). After that, the device is trusted; **no login prompt ever again**.
- All app routes and all of *her* media require a valid device token.
- The developer **acts as her** by provisioning his own device the same way — it's the same single identity (her "account").
- **Hidden maintenance entry:** a secret URL (and/or a long-press gesture on a logo) reveals developer tools — status, logs, data inspection/fix, device re-provisioning, share-link management, and the global notification settings (see 8C). Invisible in her normal use.
- She never sees passwords, tokens, or login UI in any state.

---

## 7. SHARING — permanent, per-file, isolated links

**Intent:** she frequently sends media to others. She wants a way to create a **permanent** link to one item that **opens just that piece of media** for the recipient, **without exposing the rest of the site** — as an alternative to downloading and re-sending through WhatsApp herself.

**Suggested implementation (changeable):**
- Any file can generate a **permanent public link**: an unguessable random token mapping to **exactly one file**.
- The link opens a **clean, minimal viewer/player** showing only that one item — no folders, no other files, no app chrome, no traversal, no way to reach anything else.
- **Embed/preview:** set OpenGraph / Twitter meta tags + generate a **thumbnail**, so pasting the link in WhatsApp shows a **thumbnail + title**, and tapping opens the clean player page.
  - **Honest limitation to encode:** true in-bubble playback isn't possible for a custom domain (only natively-supported sources like YouTube get that). The realistic target is **thumbnail preview + one-tap open into a clean player**. Don't pretend otherwise.
- Links persist until she deletes the file or revokes the link. **Deleting the file kills its link.**
- **Her UI:** from a file's full-screen view, a big **«Поделиться»** offering **«Создать постоянную ссылку»** (creates + copies to clipboard) and **«Скачать»** (to send via WhatsApp herself).

---

## 8. THE FOUR TOOLS

### 8A. ВИДЕО — video editor (desktop-first, fully works on phone)

**Purpose:** she dances and practices to specific parts of videos. She needs two things only: **keep certain parts** (cut) and **change playback speed** (slower, for practice), with audio that doesn't sound sped-up/slowed-down.

**Intent (immutable):**
- She thinks **"keep THIS part,"** not "cut out that part." The interaction must match that mental model.
- One **guided flow** that ends with the **result in front of her** and its next actions attached (direct application of P2 — the fix for the recorder failure).
- **Show her the numbers** she likes: timestamps while editing, and the **final clip length + kept segments + chosen speed** at the confirmation step.
- **Immediate preview** at every stage — she can always play the whole thing and see the effect right away.
- **Original file is never modified**; output is a **new** file (P10).
- Speed values presented as **0.6 / 0.7 / 0.8 / 0.9** (her preferred representation; no faster-than-normal option needed). Audio **pitch preserved**.
- Optimized for **desktop** (bigger editing surface) but must be genuinely usable and responsive on the phone.

**Suggested implementation (changeable):**
- **Source:** she uploads a video (from phone or PC) **or** picks one from Файлы. Show upload progress; never a frozen-looking screen.
- **Base view:** a clean player with **normal playback + scrubbing** (she knows scrubbing) and two primary choices: **«Обрезать видео»** (cut) and **«Изменить скорость»** (change speed).
  - These are **not separate pages.** React swaps the controls **in place** with a short, smooth, non-fancy transition, each mode having a clear **back / «Готово»** control that returns to the two choices.
- **Cut mode:** play/scrub; tap **«Начало»** to mark the start of the part to keep at the playhead, **«Конец»** to mark its end. The kept segment appears as a **highlighted band on the timeline**, with adjustable handles. **«Добавить ещё»** adds another kept segment; repeat for as many as she wants. Timestamps are **always visible**. She can preview the assembled result immediately.
- **Speed mode:** preset buttons **0.6 / 0.7 / 0.8 / 0.9**. An optional slider **may** be added **only if** it can coexist without ever hijacking a preset tap (e.g., she taps 0.8 and a slow tap/drag accidentally triggers the slider). **If both can't cleanly coexist, ship presets only** — presets are the priority.
- **Multiple kept parts are joined in order into one continuous video (a jumpcut).**
- **Confirmation step:** show the **exact resulting length**, the kept segments/timestamps, and the chosen speed — all the numbers — then process.
- **Result step (critical):** the finished video appears **right there** with three actions:
  - **«Смотреть»** (play it here),
  - **«Сохранить в Файлы»** (save to storage — opens the shared folder picker, see 8B),
  - **«Скачать»** (download).
- **Processing (server-side FFmpeg):**
  - Multi-segment keep + jumpcut: `trim`/`atrim` + `concat` (single `filter_complex` pass preferred to avoid temp files/artifacts) into one output.
  - Speed change with **pitch preserved**: video `setpts=PTS/{speed}`, audio `atempo={speed}` (0.6–0.9 is within a single `atempo` instance). Optionally `rubberband` for higher audio quality if available in the build.
  - **Output MP4 (H.264 + AAC)** for reliable WhatsApp re-sharing.
  - Cut and speed are **independent and each optional** (she may do only one).
  - Run as a job with progress feedback. Keep the original; write a new file.

---

### 8B. ФАЙЛЫ — storage (WhatsApp model)

**Purpose:** a simple, reliable place for her files, replacing the mess of keeping everything across WhatsApp chats (which desyncs between phone and PC, and where finding things is hard). Files are photos, videos, audio, occasionally other types.

**Intent (immutable):**
- **WhatsApp mental model:** **folders in a left sidebar, contents on the right.** Folders are a **single flat level** — no folders within folders. This keeps «Куда переместить?» a one-step pick from a plain list, on both the phone and the video editor's save/pick flows.
- She must be able to **find things easily** — including **forgiving, typo-tolerant fuzzy search by filename**.
- Actions are **simple and forgiving**; nothing destructive happens by a single stray tap.
- **Move** is explicit and understandable: a **button → choose the destination folder from a clear picker → confirm.** **Never** drag-and-drop, **never** manual path entry, **never** a single tap that commits the move — always a confirm step.
- Edited videos can land here (via 8A's «Сохранить в Файлы»).

**Suggested implementation (changeable):**
- **Desktop layout:** left = folder sidebar (like the WhatsApp chat list); right = contents of the selected folder as a clean grid/list with thumbnails.
- **Phone layout:** the sidebar won't fit — swap between a **folders view** and a **contents view** (tap a folder → its contents; back arrow → folders), preserving the same conceptual model. Big spacing, no overflow, comfortable targets. Clear breadcrumb or back navigation for nesting.
- **Upload:** a big obvious **«Загрузить» / «Добавить»**; destination is the current folder or chosen via the shared folder picker. Show progress.
- **Opening a file:** full-screen view with **normal playback + scrubbing** for video/audio. Buttons here can be **smaller** (she wants to watch), but still comfortable. A big **«Поделиться»** (see Section 7) and a back arrow.
- **File/folder actions:** **delete** (confirmed), **rename** (simple field), **move** (button → folder picker → confirm, as above).
- **Search:** **fuzzy, lenient, typo-tolerant** match on filename (e.g., Fuse.js or similar; a % match threshold so misspellings still surface the intended file). **No date search needed.**
- **Under the hood:** metadata in SQLite (files, folders, parent refs, share tokens); binaries on disk; generate **thumbnails** (FFmpeg poster frames for video); stream with range requests.
- **The folder picker is a single shared component** reused for move, for saving edited videos, and for choosing upload destinations (P12).

---

### 8C. НАПОМИНАНИЯ — reminders (alarm-clock behavior)

**Purpose:** reminders she **cannot miss** — for dance class and everything else. She ignores ordinary notifications.

**Intent (immutable):**
- **Alarm, not notification** (P9): as loud and screen-covering as the platform allows; coordinated across phone + PC.
- **Dead-simple to create.** She sets **exact date + time**, and before confirming she sees a summary with the **exact date, time, day of the week**, plus a **static "in X from now"** line (see below). She likes exact times and these numbers.
- **Result-in-front-of-her home view:** on opening, a clear **«Сегодня»** and **«Завтра»** with what's coming — the important things immediately visible.
- **Cross-device dismiss sync:** it rings on every reachable device; the **first «OK» anywhere stops it everywhere** (and snooze syncs across devices).
- **Snooze once, then not again:** snooze is **«Показать через 5 минут»**; after one snooze, the next ring shows **only «OK»**.
- **Notification lead-time settings are dev-only**, tucked away, and **global to all reminders.**

**Honest technical limitation to encode (do not paper over):**
A website — even an installed PWA — **cannot force-launch itself when it is closed or the phone is locked**; the OS forbids it. Therefore:
- **When any of the four apps is open (phone or PC):** do the **full-screen alarm takeover** — cover the whole screen, big Russian reminder text, **loud sound + vibrate (phone)**, buttons **«OK»** and **«Показать через 5 минут»**.
- **When everything is closed / phone locked:** fire the **strongest available push** — high-priority, sound + vibrate, as prominent/full-screen-style as the platform permits. It will not literally auto-open, but it will ring hard and open on tap.
- **Required one-time setup step (document it):** on the A31, allowlist the app against Samsung's battery optimization ("never sleeping apps" / disable "put app to sleep") so closed-phone delivery is reliable and on time. Ship this as a written setup step.
- The **PC being on is the reliable fallback** for the closed-phone case — lean into it: if the PC app is open, it does the full takeover regardless of the phone.

**Suggested implementation (changeable):**
- **Home view:** **«Сегодня»** and **«Завтра»** sections up top, plus a **month calendar view** to see everything.
  - **Calendar styling intent:** readable but not screen-hogging. Suggestion: on phone, a **compact month grid** with a **dot/marker on days that have reminders**; tapping a day lists that day's reminders below (keeps cells tap-friendly, neither tiny nor huge). On desktop, a roomier grid. Exact styling is yours; the intent is **readable, tap-friendly, not cramped, not dominating**.
- **Creating a reminder:** a big **«Добавить напоминание»**; large, forgiving **date + time pickers** (avoid tiny native controls if they behave badly on old Chrome — provide comfortable custom pickers if needed); a text field for the content.
  - **Confirmation summary line:** exact date, **day of the week**, and time (24h), **plus** a **static** "через N …" line computed at creation. **If the lead is ≥ 1 hour, omit minutes** (e.g., «через 5 дней, 2 часа»); otherwise show minutes (e.g., «через 43 минуты»).
- **When it fires:** create an **active-alarm** record; push to all devices; open apps receive ring/stop over the real-time channel and show the takeover; **re-sync on app open** as a safety net for anything pending/missed.
- **Snooze** = re-arm +5 minutes and flag snooze-used so the next ring is **OK-only**.
- **Dev-only global settings** (behind the hidden maintenance entry): notification **lead times**, default **5 minutes / 1 hour / 24 hours before**, applied globally.

---

### 8D. ГОЛОС — voice-to-text (record → editable Russian text)

**Purpose:** she records her voice and gets back editable Russian text she can copy or send — without typing.

**Intent (immutable):**
- One **start/stop toggle button** (same button, swaps state). Stopping or starting a recording **never deletes existing transcribed text** — a new recording's result is **added to** what's already there, not a replacement (the text-equivalent of P10's "never destroy her originals").
- While a recording is transcribing, she is **blocked from starting another recording**, but she is not shown or asked to manage that state herself — the button simply reflects it (an application of P2: no extra thing for her to track).
- The **result appears in place** as editable text (P2) — she can revise it before copying/sharing.
- Big **«Копировать»** (clipboard), **«Поделиться»** (native share sheet to WhatsApp etc.), **«Сброс»** (clears the text, **confirmed** first via the shared confirm dialog — P12).
- **Local, self-hosted transcription only — no cloud speech-to-text API.** Consistent with keeping her data off third-party services (the spirit of P7).
- The **recorded audio itself is never kept** — it exists only long enough to produce the text, then is discarded server-side. Only the text persists, and only in her hands (copy/share) — it is **not** saved into Файлы. This is a deliberate scope decision, distinct from 8B's file-storage model.
- Everything she sees is Russian (P5), same as every other tool.

**Honest technical limitation to encode:** running Whisper-family models locally on a Raspberry Pi is far slower than a cloud API, especially for the larger/more-accurate model sizes. The realistic target is **batch transcription shortly after she stops recording** (seconds to tens of seconds depending on recording length and model size), not live captions while she talks. Don't pretend otherwise, and don't silently degrade to a cloud service to hide the wait.

**Suggested implementation (changeable):**
- Browser `MediaRecorder` captures audio; on stop, upload to the server, which converts it (FFmpeg) to the format the transcription model wants and runs it through a **locally-hosted `faster-whisper`** model.
- Default model: **`small`** (int8-quantized) — meaningfully better Russian accuracy than `tiny`/`base` while still tractable on a Raspberry Pi 5 (8GB) for realistic 1–5 minute recordings processed in batch, not real-time.
- **Model choice (`tiny`/`base`/`small`/`medium`) is admin-only**, changeable from the hidden maintenance panel (Section 6) — **never shown to her.**
- Keep the transcription process **warm** (loaded once, not reloaded per recording) so her wait time doesn't include model-load cost on every single use.

---

## 9. DESIGN SYSTEM & RESPONSIVENESS (cross-cutting)

**Intent:** one consistent, comfortable, Russian-language feel across all four tools; flawless on the A31; usable on Win7 Chrome; she can never get stranded.

**Suggested implementation (changeable):**
- A **shared component library + design tokens** used by all four apps (P12): the folder picker, confirmation dialogs, back/«Готово» controls, alarm takeover, buttons, transitions.
- **Targets & spacing:** large, well-spaced interactive elements; enforce comfortable minimum sizes and minimum spacing; **never** allow adjacent targets close enough to cause mis-taps; **never** allow horizontal overflow on the A31.
- **Transitions:** short, smooth, non-fancy when swapping in-place controls (video modes, folder navigation).
- **Russian typography**, readable sizes, high contrast.
- **Always a way back / done** on every screen; she can never reach a dead end.
- **Progress/loading states** for anything slow (uploads, video processing) — never a frozen-looking screen.
- **Test matrix:** A31 Chrome (primary phone), Win7 Chrome (primary desktop), developer's own browser.

---

## 10. NON-FUNCTIONAL / OPS

- **docker-compose** brings up the whole stack on the Pi (ARM images; FFmpeg in the container). Also runnable on a rented server.
- **Cloudflare Tunnel** config for HTTPS + a stable hostname.
- **Hidden maintenance access** (Section 6): status, logs, data inspection/fix, device re-provisioning, share-link management, global notification settings.
- **Logging** that's useful to the developer; **friendly Russian** messages for her — never a raw error or English string in her view.
- **Simple update path:** rebuild container, redeploy; migrations run cleanly.
- **Setup docs** (for the developer): provisioning her devices, installing the four PWA icons on phone + PC, and the **Samsung battery-optimization allowlisting** step.

---

## 11. ACCEPTANCE CRITERIA (phrased as "she can…")

- She taps **Видео**, picks a video, keeps two parts (e.g. 00:05–00:50 then 01:02–01:07), sets **0.8×**, sees the **final length + timestamps + speed**, and gets a **new** video with **«Смотреть» / «Сохранить в Файлы» / «Скачать»** right there. The original is untouched. The audio isn't chipmunked.
- She taps **Файлы**, finds a video by typing its name **with a typo**, opens it full-screen, creates a **permanent link**, pastes it in WhatsApp where it shows a **thumbnail + title** and opens a clean player on tap — and that link exposes **only** that one file.
- She **moves** a file to another folder via **button → pick folder → confirm** (no drag-drop, no paths, no accidental one-tap move).
- She **creates a reminder** for an exact date/time, sees **day-of-week + "in X"**, and when it fires it **covers her screen with sound**; **«OK» dismisses it on both phone and PC.**
- Nothing overflows on her A31; no mis-taps from cramped controls.
- She **never sees a login screen** after first setup; nobody else can reach her files.
- **Everything she sees is in Russian.**
- She is never stranded on a screen without an obvious way back, and never has to remember a multi-screen flow.

---

## 12. EXPLICIT NON-GOALS (do NOT build these)

- No user-account / login system for her; no multi-user.
- **No backups** (explicitly out of scope for now — but see P10: never auto-delete, keep originals safe).
- **No native Android app / APK / wrapper** — pure PWA.
- No bulk import of her existing WhatsApp media.
- No video features beyond **keep-cuts + pitch-preserved speed** (0.6–0.9).
- No date-based file search.
- No public browsing of storage — only isolated single-file share links.
- Notification lead-time settings are **not** exposed to her (dev-only, tucked away).

---

## 13. OPEN / TO REFINE TOGETHER (living scratch space)

*(We'll keep adding here as we iterate.)*

- Exact calendar styling for phone vs desktop — settle on the compact-grid-with-dots approach or something better.
- Whether the optional speed slider makes the cut or presets-only wins on the A31.
- Folder-picker exact interaction (list vs. expandable tree) for deep nesting on a small screen.
- Alarm sound choice(s) and volume behavior.
- Any additional file types beyond photo/video/audio that need special handling.

---

### Changelog
- **v1** — initial full draft.
- **v1.1** — folders are flat (no nesting) everywhere, including the shared
  Picker used for move/save/pick-video; each app got a «На главную» button
  back to the app chooser; reminder creation moved into a modal with a
  separate confirm step; a dismissed reminder is deleted, not kept marked
  "done"; the alarm tune and the shared video player controls were reworked
  for clarity.
- **v1.2** — added a fourth tool, **Голос** (voice-to-text, Section 8D): P8
  now describes four separate tools instead of three. Local/self-hosted
  Whisper transcription (`faster-whisper`, admin-selectable model size,
  default `small`), text-only — recorded audio is discarded after
  transcription and never saved to Файлы. New recordings append to existing
  transcribed text rather than replacing it.