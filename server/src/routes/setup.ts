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

const INVALID_PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ссылка не работает</title>
<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#faf7f2;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-size:26px}p{font-size:19px}</style>
</head><body><div><h1>Эта ссылка не работает</h1><p>Она уже была использована или устарела.</p></div></body></html>`;

setupRouter.get('/setup/:code', (req, res) => {
  const result = useSetupCode(req.params.code);
  if (!result) {
    res.status(404).type('html').send(INVALID_PAGE);
    return;
  }
  res.cookie(COOKIE_DEVICE, result.rawToken, cookieOptions(req));
  res.redirect('/');
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
