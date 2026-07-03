import webpush from 'web-push';
import { db, getSetting, setSetting } from './db';
import { log } from './log';

/**
 * Web Push is the strongest channel a web platform has for the closed-app /
 * locked-phone case. It cannot force-open the site (OS restriction — an
 * honest limit, see master prompt 8C), but a high-priority push with sound
 * and vibration is delivered, and tapping it opens the alarm.
 */
export function initPush(): void {
  let publicKey = getSetting('vapid_public');
  let privateKey = getSetting('vapid_private');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting('vapid_public', publicKey);
    setSetting('vapid_private', privateKey);
    log.info('generated new VAPID keys');
  }
  const subject = process.env.VAPID_SUBJECT || 'mailto:danielvideosmail@gmail.com';
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export function vapidPublicKey(): string {
  return getSetting('vapid_public') || '';
}

export function saveSubscription(deviceId: string, subscription: unknown): void {
  db.prepare('UPDATE devices SET push_json = ? WHERE id = ?').run(JSON.stringify(subscription), deviceId);
}

export interface PushPayload {
  kind: 'alarm' | 'lead' | 'stop' | 'test';
  reminderId?: string;
  title?: string;
  body?: string;
  snoozeUsed?: boolean;
}

export async function pushToAll(payload: PushPayload, ttlSeconds = 3600): Promise<void> {
  const rows = db
    .prepare('SELECT id, push_json FROM devices WHERE push_json IS NOT NULL')
    .all() as { id: string; push_json: string }[];
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(JSON.parse(row.push_json), JSON.stringify(payload), {
          TTL: ttlSeconds,
          urgency: 'high',
        });
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Subscription expired — drop it; the app re-subscribes on next open.
          db.prepare('UPDATE devices SET push_json = NULL WHERE id = ?').run(row.id);
          log.warn(`push subscription expired for device ${row.id}`);
        } else {
          log.warn(`push failed for device ${row.id}`, e);
        }
      }
    })
  );
}
