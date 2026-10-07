/*
 * Root-scoped service worker shared by all three apps (Section 5).
 * - Push: shows the strongest notification the platform allows (P9) and
 *   mirrors ring/stop events to any open app windows.
 * - "stop" pushes close the alarm notification on every device the moment
 *   she presses OK anywhere (cross-device dismiss).
 * - Fetch: content-hashed /assets/ are cache-first (an immutable name means
 *   a hit is always correct); everything else is network-first so a deploy
 *   reaches her, falling back to cache when the connection is flaky. API and
 *   media are never cached.
 * Written as plain conservative JS — it must run on Chrome 109 (Win7).
 */

// Bumped whenever the caching rules below change: the activate handler
// deletes every cache that isn't this one, which is how entries left over
// from the old network-first scheme get cleared off her phone.
var CACHE_NAME = 'janna-shell-v2';

// A page whose HTML came from an older deploy asks for asset filenames that
// no longer exist on the server. Nothing the worker can serve will fix that
// page — only fresh HTML will — so it reloads the open windows once.
var reloadedAt = 0;
function reloadWindowsOnce() {
  var now = Date.now();
  if (now - reloadedAt < 30000) return; // never loop
  reloadedAt = now;
  self.clients.matchAll({ type: 'window' }).then(function (clientList) {
    for (var i = 0; i < clientList.length; i++) {
      if (clientList[i].navigate) clientList[i].navigate(clientList[i].url);
    }
  });
}

function putInCache(request, response) {
  if (!response || response.status !== 200) return;
  if (response.type !== 'basic' && response.type !== 'default') return;
  var copy = response.clone();
  caches.open(CACHE_NAME).then(function (cache) {
    cache.put(request, copy);
  });
}

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
  // Never cache data, media, events or share pages. /sw.js is excluded too —
  // the browser must always see the real file to notice an update.
  if (
    url.pathname.indexOf('/api/') === 0 ||
    url.pathname.indexOf('/s/') === 0 ||
    url.pathname.indexOf('/setup/') === 0 ||
    url.pathname.indexOf('/dev') === 0 ||
    url.pathname === '/sw.js'
  ) {
    return;
  }

  /*
   * Build assets are content-hashed (assets/ui-Cfg9nh3P.js): the filename
   * changes whenever the bytes do, so a cached copy is correct by definition
   * and asking the network for one can only ever go wrong. It did: during a
   * redeploy the fetch either failed (server restarting) or 404'd (the HTML
   * she had cached named last build's hashes), and the page ended up with its
   * HTML but no CSS or JS — rendering as raw unstyled markup. Cache-first
   * means a hit is served instantly and the network is only the first fetch.
   */
  if (url.pathname.indexOf('/assets/') === 0) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request)
          .then(function (response) {
            if (response && response.status === 404) reloadWindowsOnce();
            putInCache(request, response);
            return response;
          })
          .catch(function () {
            return Response.error(); // offline and never cached — nothing to serve
          });
      })
    );
    return;
  }

  // Everything else (HTML, icons, manifests) stays network-first so a deploy
  // reaches her without a manual refresh, falling back to cache when offline.
  event.respondWith(
    fetch(request)
      .then(function (response) {
        putInCache(request, response);
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
