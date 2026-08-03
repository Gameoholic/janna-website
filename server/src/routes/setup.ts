import { Router } from 'express';
import { getSetting } from '../db';
import {
  COOKIE_ADMIN,
  COOKIE_DEVICE,
  cookieOptions,
  isAdminRequest,
  useSetupCode,
} from '../auth';
import { log } from '../log';

/**
 * Public entry points: one-time device provisioning links (P7) and the
 * hidden developer entry (P11). Nothing here leaks whether a code/key is
 * valid beyond a generic friendly page.
 */
export const setupRouter = Router();

const INVALID_BODY = `<div><h1>Эта ссылка не работает</h1><p>Она уже была использована или устарела.</p></div>`;

const INVALID_PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ссылка не работает</title>
<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#faf7f2;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-size:26px}p{font-size:19px}</style>
</head><body>${INVALID_BODY}</body></html>`;

// crypto.randomBytes(32).toString('base64url') — always this charset/length.
const CODE_RE = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * The GET here is deliberately inert — it never consumes the code. Some
 * links get silently followed once before a real tap ever happens (a
 * browser's own preload/prefetch of a typed-or-pasted URL, an antivirus or
 * chat-app link scanner, etc.), and a plain GET-consumes-it design makes
 * that first, invisible fetch the one that "wins" the one-time code —
 * exactly the "already used" bug reported. Consuming the code only happens
 * in response to a same-origin POST fired by this page's own script, which
 * those non-JS-executing prefetchers/scanners never trigger. For her, it's
 * still a single tap: the script runs immediately and invisibly.
 */
function openingPage(code: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Открываем…</title>
<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#faf7f2;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-size:22px;font-weight:600}</style>
</head><body>
<div id="msg"><h1>Открываем…</h1></div>
<script>
fetch('/setup/${code}/confirm', { method: 'POST', credentials: 'same-origin' })
  .then(function (r) { if (!r.ok) throw new Error('invalid'); location.replace('/'); })
  .catch(function () { document.getElementById('msg').outerHTML = ${JSON.stringify(INVALID_BODY)}; });
</script>
</body></html>`;
}

setupRouter.get('/setup/:code', (req, res) => {
  if (!CODE_RE.test(req.params.code)) {
    res.status(404).type('html').send(INVALID_PAGE);
    return;
  }
  res.type('html').send(openingPage(req.params.code));
});

/** The actual one-time consumption — only ever reached via the script above. */
setupRouter.post('/setup/:code/confirm', (req, res) => {
  const result = useSetupCode(req.params.code);
  if (!result) {
    res.status(404).json({ ok: false });
    return;
  }
  res.cookie(COOKIE_DEVICE, result.rawToken, cookieOptions(req));
  res.json({ ok: true });
});

/** Hidden maintenance entry: /dev?key=SECRET sets the admin cookie. */
setupRouter.get('/dev', (req, res, next) => {
  // Express's non-strict routing matches "/dev/" to this same route, and
  // the static dev panel lives at "/dev/" — without this guard, redirecting
  // to "/dev/" re-enters this handler and (once the cookie is set) loops
  // forever (ERR_TOO_MANY_REDIRECTS). Only the exact "/dev" path runs the
  // provisioning logic; "/dev/" always falls through to the static app.
  if (req.path !== '/dev') {
    next();
    return;
  }
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  const secret = getSetting('admin_secret');
  if (key && secret && key === secret) {
    res.cookie(COOKIE_ADMIN, key, cookieOptions(req));
    log.info('admin cookie issued');
    res.redirect('/dev/');
    return;
  }
  if (isAdminRequest(req)) {
    res.redirect('/dev/');
    return;
  }
  next(); // falls through to static /dev/ page, whose API calls will 401
});
