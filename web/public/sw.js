/*
 * Root-scoped service worker shared by all three apps (Section 5).
 * - Push: shows the strongest notification the platform allows (P9) and
 *   mirrors ring/stop events to any open app windows.
 * - "stop" pushes close the alarm notification on every device the moment
 *   she presses OK anywhere (cross-device dismiss).
 * - Fetch: network-first shell cache so the apps open even with a flaky
 *   connection. API and media are never cached.
 * Written as plain conservative JS — it must run on Chrome 109 (Win7).
 */

var CACHE_NAME = 'janna-shell-v1';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache data, media, events or share pages.
  if (
    url.pathname.indexOf('/api/') === 0 ||
    url.pathname.indexOf('/s/') === 0 ||
    url.pathname.indexOf('/setup/') === 0 ||
    url.pathname.indexOf('/dev') === 0
  ) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then(function (response) {
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'default')) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match(url.pathname.indexOf('/video') === 0 ? '/video/' : url.pathname.indexOf('/files') === 0 ? '/files/' : url.pathname.indexOf('/reminders') === 0 ? '/reminders/' : '/');
          }
          return Response.error();
        });
      })
  );
});

function broadcastToWindows(message) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
    clientList.forEach(function (client) {
      client.postMessage(message);
    });
  });
}

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  if (data.kind === 'stop') {
    event.waitUntil(
      Promise.all([
        self.registration.getNotifications({ tag: 'rem-' + data.reminderId }).then(function (notifications) {
          notifications.forEach(function (n) {
            n.close();
          });
        }),
        broadcastToWindows({ type: 'alarm-stop', id: data.reminderId }),
      ])
    );
    return;
  }

  if (data.kind === 'alarm') {
    var actions = [{ action: 'ok', title: 'OK' }];
    if (!data.snoozeUsed) actions.push({ action: 'snooze', title: 'Через 5 минут' });
    event.waitUntil(
      Promise.all([
        self.registration.showNotification(data.title || '⏰ Напоминание', {
          body: data.body || '',
          tag: 'rem-' + data.reminderId,
          renotify: true,
          requireInteraction: true,
          vibrate: [600, 200, 600, 200, 600],
          actions: actions,
          data: { reminderId: data.reminderId, kind: 'alarm' },
        }),
        broadcastToWindows({ type: 'push-alarm', reminderId: data.reminderId }),
      ])
    );
    return;
  }

  if (data.kind === 'lead' || data.kind === 'test') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'Напоминание', {
        body: data.body || '',
        tag: 'lead-' + (data.reminderId || Date.now()),
        vibrate: [300, 150, 300],
        data: { reminderId: data.reminderId, kind: data.kind },
      })
    );
  }
});

self.addEventListener('notificationclick', function (event) {
  var reminderId = event.notification.data && event.notification.data.reminderId;
  event.notification.close();

  if (event.action === 'ok' && reminderId) {
    event.waitUntil(fetch('/api/reminders/' + reminderId + '/dismiss', { method: 'POST' }));
    return;
  }
  if (event.action === 'snooze' && reminderId) {
    event.waitUntil(fetch('/api/reminders/' + reminderId + '/snooze', { method: 'POST' }));
    return;
  }

  // Plain tap: focus an open app window or open Напоминания.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if ('focus' in clientList[i]) return clientList[i].focus();
      }
      return self.clients.openWindow('/reminders/');
    })
  );
});
