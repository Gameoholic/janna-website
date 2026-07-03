import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db, getSetting, setSetting } from './db';
import { id, token, sha256, now } from './util';
import { log } from './log';

export interface DeviceRow {
  id: string;
  name: string;
  token_hash: string;
  created_at: number;
  last_seen: number | null;
  push_json: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: DeviceRow;
    }
  }
}

export const COOKIE_DEVICE = 'jd';
export const COOKIE_ADMIN = 'jadm';
const TEN_YEARS_MS = 10 * 365 * 24 * 3600 * 1000;

export function cookieOptions(req: Request) {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: proto === 'https',
    maxAge: TEN_YEARS_MS,
    path: '/',
  };
}

/** The admin secret is generated once and printed to the log on startup. */
export function ensureAdminSecret(): string {
  let secret = getSetting('admin_secret');
  if (!secret) {
    secret = token();
    setSetting('admin_secret', secret);
  }
  return secret;
}

function timingEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function isAdminRequest(req: Request): boolean {
  const cookie = req.cookies?.[COOKIE_ADMIN];
  if (!cookie) return false;
  const secret = getSetting('admin_secret');
  return !!secret && timingEqual(cookie, secret);
}

/** Create a device row and return the raw token to be set as a cookie. */
export function provisionDevice(name: string): { deviceId: string; rawToken: string } {
  const rawToken = token();
  const deviceId = id();
  db.prepare(
    'INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)'
  ).run(deviceId, name, sha256(rawToken), now(), now());
  log.info(`device provisioned: ${name} (${deviceId})`);
  return { deviceId, rawToken };
}

export function findDeviceByToken(rawToken: string): DeviceRow | undefined {
  return db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha256(rawToken)) as DeviceRow | undefined;
}

const lastSeenUpdated = new Map<string, number>();

/** Requires a provisioned device. All of her data sits behind this. */
export function deviceAuth(req: Request, res: Response, next: NextFunction): void {
  const raw = req.cookies?.[COOKIE_DEVICE];
  if (raw) {
    const device = findDeviceByToken(raw);
    if (device) {
      req.device = device;
      const prev = lastSeenUpdated.get(device.id) || 0;
      if (now() - prev > 60_000) {
        lastSeenUpdated.set(device.id, now());
        db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), device.id);
      }
      next();
      return;
    }
  }
  res.status(401).json({ error: 'no_device', message: 'Это устройство ещё не настроено.' });
}

/** Developer-only surface. Never linked from her UI. */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAdminRequest(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'no_admin' });
}

export function createSetupCode(note: string): string {
  const code = token();
  db.prepare('INSERT INTO setup_codes (code, note, created_at) VALUES (?, ?, ?)').run(code, note, now());
  return code;
}

/** Consumes the code if valid; returns the raw device token or null. */
export function useSetupCode(code: string): { rawToken: string } | null {
  const row = db.prepare('SELECT * FROM setup_codes WHERE code = ? AND used_at IS NULL').get(code) as
    | { code: string; note: string }
    | undefined;
  if (!row) return null;
  db.prepare('UPDATE setup_codes SET used_at = ? WHERE code = ?').run(now(), code);
  const { rawToken } = provisionDevice(row.note || 'Устройство');
  return { rawToken };
}
