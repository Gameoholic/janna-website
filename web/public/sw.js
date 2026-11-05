/*
 * Root-scoped service worker shared by all three apps (Section 5).
 * - Push: shows the strongest notification the platform allows (P9) and
 *   mirrors ring/stop events to any open app windows.
 * - "stop" pushes close the alarm notification on every device the moment
 *   she presses OK anywhere (cross-device dismiss).
 * - Fetch: content-hashed /assets/ are cache-first (an immutable name means
 *   a hit is always correct); everything else is network-first so a deploy
 *   reaches her, falling back to cache when the connection is flaky.
 * - Offline videos ("smart cache", see shared/mediaCache.ts): videos she
 *   plays are kept on the device in 1 MB pieces and served from there, so a
 *   dance video keeps playing in the ממד where the signal comes and goes.
 * - Her listings (/api/me, /api/state, a folder's files, thumbnails) are
 *   network-first with a cached fallback, so Файлы still opens with no signal.
 * Written as plain conservative JS — it must run on Chrome 109 (Win7).
 */

// Bumped whenever the caching rules below change: the activate handler
// deletes every cache that isn't this one, which is how entries left over
// from the old network-first scheme get cleared off her phone.
var CACHE_NAME = 'janna-shell-v2';

// Offline-video caches, one per file: janna-media-<fileId>. Created by the
// page (shared/mediaCache.ts) when she plays something; the worker only ever
// fills caches that already exist, so the page alone decides what is kept
// and for how long. Keep these names in step with mediaCache.ts.
var MEDIA_PREFIX = 'janna-media-';
var MEDIA_CHUNK = 1048576; // 1 MB pieces: small enough to finish between signal drops
var MEDIA_META_KEY = '/__mc/meta';
// Her listings, for opening Файлы with no signal. Never deleted on update.
var API_CACHE = 'janna-api-v1';
var API_TIMEOUT_MS = 6000;

function noop() {}

function keepCache(name) {
  return name === CACHE_NAME || name === API_CACHE || name.indexOf(MEDIA_PREFIX) === 0;
}

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
              // Her offline videos and listings survive every deploy.
              return !keepCache(key);
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

  var mediaMatch = /^\/api\/media\/([^\/]+)$/.exec(url.pathname);
  if (mediaMatch) {
    event.respondWith(serveMedia(event, decodeURIComponent(mediaMatch[1])));
    return;
  }
  if (isOfflineReadableApi(url.pathname)) {
    event.respondWith(networkFirstApi(event));
    return;
  }

  // Never cache any other data, events or share pages. /sw.js is excluded
  // too — the browser must always see the real file to notice an update.
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

/* ------------------------------------------------------------------------
 * Listings with a fallback. In the ממד the connection either fails outright
 * or hangs; either way, after API_TIMEOUT_MS she gets the last copy instead
 * of «Нет связи», and a late network answer still refreshes the copy.
 * Only successful answers are kept, so a revoked device still sees 401.
 * ---------------------------------------------------------------------- */

function isOfflineReadableApi(pathname) {
  return (
    pathname === '/api/me' ||
    pathname === '/api/state' ||
    /^\/api\/folders\/[^\/]+\/files$/.test(pathname) ||
    /^\/api\/thumb\/[^\/]+$/.test(pathname)
  );
}

function networkFirstApi(event) {
  var request = event.request;
  var fromCache = function () {
    return caches.open(API_CACHE).then(function (cache) {
      return cache.match(request);
    });
  };
  var network = fetch(request).then(function (response) {
    if (!response || response.status !== 200) return response;
    var copy = response.clone();
    return caches
      .open(API_CACHE)
      .then(function (cache) {
        return cache.put(request, copy);
      })
      .catch(noop)
      .then(function () {
        return response;
      });
  });
  event.waitUntil(network.catch(noop));
  var slow = new Promise(function (resolve) {
    setTimeout(resolve, API_TIMEOUT_MS);
  }).then(function () {
    return fromCache().then(function (cached) {
      return cached || network;
    });
  });
  return Promise.race([network, slow]).catch(function () {
    return fromCache().then(function (cached) {
      return cached || Response.error();
    });
  });
}

/* ------------------------------------------------------------------------
 * Offline videos.
 *
 * A file in a janna-media-<id> cache is stored as numbered 1 MB pieces
 * (/__mc/c/<n>) plus a meta entry ({size, type, etag}). Every request the
 * <video> element makes for such a file is answered here, piece by piece:
 * a piece already on the phone is read from disk, a missing one is fetched
 * from the server with an exact Range request and — while it streams to the
 * player — saved, so whatever she watches once is there the next time.
 * The page's background filler (mediaCache.ts) asks for the remaining
 * pieces the same way, so the rest of the file arrives even if she only
 * watched the start.
 *
 * Responses always cover exactly the range the player asked for, with the
 * standard 206 headers — the player can't tell the difference. If the
 * network fails on a piece that isn't stored yet, the response errors and
 * the player's own reconnect logic (VideoPlayer.tsx) takes over.
 * ---------------------------------------------------------------------- */

// One network fetch per piece at a time: when the player and the background
// filler both want piece n, the second waits for the first instead of
// downloading the same megabyte twice over a weak signal.
var mediaInflight = {};

function mediaChunkKey(n) {
  return '/__mc/c/' + n;
}

function parseRangeHeader(header) {
  var m = /^bytes=(\d+)-(\d*)$/.exec(header || '');
  if (!m) return null;
  return { start: Number(m[1]), end: m[2] === '' ? null : Number(m[2]) };
}

function parseContentRange(header) {
  var m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header || '');
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), size: Number(m[3]) };
}

function readMediaMeta(cache) {
  return cache
    .match(MEDIA_META_KEY)
    .then(function (r) {
      return r ? r.json() : null;
    })
    .catch(function () {
      return null;
    });
}

function writeMediaMeta(cache, meta) {
  return cache.put(
    MEDIA_META_KEY,
    new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })
  );
}

function wipeMediaChunks(cache) {
  return cache.keys().then(function (requests) {
    return Promise.all(
      requests
        .filter(function (req) {
          return new URL(req.url).pathname.indexOf('/__mc/c/') === 0;
        })
        .map(function (req) {
          return cache.delete(req);
        })
    );
  });
}

/** Every piece is exactly 1 MB except the file's last one. */
function validChunkSize(bytes, n, size) {
  var expected = Math.min(MEDIA_CHUNK, size - n * MEDIA_CHUNK);
  return expected > 0 && bytes === expected;
}

/**
 * Keeps the worker alive until a response has finished streaming and the
 * pieces it fetched are saved — capped, so a video left paused for a long
 * time can't hold the worker forever (if the browser stops it anyway, the
 * player just reconnects and the saved pieces serve instantly).
 */
function mediaLifetime(event) {
  var release;
  var pending = [];
  var ended = false;
  var held = new Promise(function (resolve) {
    release = resolve;
  });
  try {
    event.waitUntil(held);
  } catch (e) {
    /* not extendable any more — the stores still run, just unguarded */
  }
  var timer = setTimeout(function () {
    release();
  }, 4 * 60 * 1000);
  return {
    add: function (promise) {
      pending.push(promise);
    },
    done: function () {
      if (ended) return;
      ended = true;
      Promise.all(pending).then(
        function () {
          clearTimeout(timer);
          release();
        },
        function () {
          clearTimeout(timer);
          release();
        }
      );
    },
  };
}

/**
 * Fetch piece n from the server, save it as it arrives, and hand back a
 * stream of its bytes. Resolves to {meta, stream}, or {passthrough} when the
 * server's answer isn't a usable piece (404 after a delete, a 416 past the
 * end, a server that ignored Range) — that answer then goes to the player as is.
 */
function fetchMediaChunk(ctx, n) {
  var key = ctx.id + ':' + n;
  if (mediaInflight[key]) {
    return mediaInflight[key].then(function (done) {
      if (!done) throw new Error('piece failed');
      return { meta: done.meta, stream: new Response(done.blob).body };
    });
  }
  var start = n * MEDIA_CHUNK;
  var end = start + MEDIA_CHUNK - 1;
  if (ctx.meta) end = Math.min(end, ctx.meta.size - 1);
  var settle;
  mediaInflight[key] = new Promise(function (resolve) {
    settle = resolve;
  });
  var settleWith = function (value) {
    delete mediaInflight[key];
    settle(value);
  };
  return fetch(ctx.url, {
    headers: { Range: 'bytes=' + start + '-' + end },
    credentials: 'same-origin',
    cache: 'no-store',
  }).then(
    function (res) {
      // Deleted on the server: the offline copy goes too (Section 7 — a
      // deleted file is gone everywhere).
      if (res.status === 404) caches.delete(MEDIA_PREFIX + ctx.id).catch(noop);
      var cr = res.status === 206 ? parseContentRange(res.headers.get('Content-Range')) : null;
      if (!cr || cr.start !== start || !res.body) {
        settleWith(null);
        return { passthrough: res };
      }
      var fresh = {
        size: cr.size,
        type: res.headers.get('Content-Type') || 'application/octet-stream',
        etag: res.headers.get('ETag') || '',
      };
      var unchanged = ctx.meta && ctx.meta.size === fresh.size && ctx.meta.etag === fresh.etag;
      // A different size or ETag means the server's file changed (e.g. a
      // browser-playable copy was made): the old pieces would mix two files.
      var ready = unchanged
        ? Promise.resolve()
        : (ctx.meta ? wipeMediaChunks(ctx.cache) : Promise.resolve()).then(function () {
            return writeMediaMeta(ctx.cache, fresh);
          });
      var length = cr.end - cr.start + 1;
      var parts = res.body.tee();
      var store = new Response(parts[1])
        .blob()
        .then(function (blob) {
          // Only a complete piece is ever saved: a cut-off one would shift
          // every byte after it.
          if (blob.size !== length || !validChunkSize(length, n, fresh.size)) {
            settleWith(null);
            return;
          }
          return ready
            .then(function () {
              return ctx.cache.put(mediaChunkKey(n), new Response(blob));
            })
            .then(function () {
              settleWith({ blob: blob, meta: fresh });
            });
        })
        .catch(function () {
          settleWith(null);
        });
      ctx.life.add(store);
      return { meta: fresh, stream: parts[0] };
    },
    function (err) {
      settleWith(null);
      throw err;
    }
  );
}

/** A stream of piece n's bytes: from the phone if saved, else from the server. */
function openMediaChunk(ctx, n) {
  return ctx.cache
    .match(mediaChunkKey(n))
    .then(function (hit) {
      if (!hit) return null;
      return hit.blob().then(function (blob) {
        return validChunkSize(blob.size, n, ctx.meta.size) ? blob : null;
      });
    })
    .catch(function () {
      return null;
    })
    .then(function (blob) {
      if (blob) return { stream: new Response(blob).body, offset: n * MEDIA_CHUNK };
      return fetchMediaChunk(ctx, n).then(function (got) {
        if (!got.stream) throw new Error('piece unavailable');
        if (got.meta.size !== ctx.meta.size || got.meta.etag !== ctx.meta.etag) {
          got.stream.cancel().catch(noop);
          throw new Error('file changed'); // player reconnects and starts over on the new file
        }
        return { stream: got.stream, offset: n * MEDIA_CHUNK };
      });
    });
}

/** Bytes start..end (inclusive) of the file, walking piece by piece. */
function mediaRangeStream(ctx, start, end, first) {
  var pos = start;
  var reader = null;
  var readerPos = 0;
  var readerEnd = 0;
  var pendingFirst = first;
  var finished = false;

  var finish = function () {
    if (finished) return;
    finished = true;
    ctx.life.done();
  };
  var dropReader = function () {
    if (!reader) return;
    var r = reader;
    reader = null;
    r.cancel().catch(noop);
  };
  var openNext = function () {
    if (pendingFirst) {
      var f = pendingFirst;
      pendingFirst = null;
      return Promise.resolve(f);
    }
    return openMediaChunk(ctx, Math.floor(pos / MEDIA_CHUNK));
  };

  // Loops until it has enqueued something or closed: a pull that returns
  // empty-handed is not called again, which would stall the player.
  var step = function (controller) {
    if (pos > end) {
      dropReader();
      finish();
      controller.close();
      return Promise.resolve();
    }
    var ready = reader
      ? Promise.resolve()
      : openNext().then(function (src) {
          reader = src.stream.getReader();
          readerPos = src.offset;
          readerEnd = Math.min(src.offset + MEDIA_CHUNK, ctx.meta.size);
        });
    return ready
      .then(function () {
        return reader.read();
      })
      .then(function (r) {
        if (r.done) {
          reader = null;
          if (readerPos < readerEnd) throw new Error('piece ended early');
          return step(controller);
        }
        var bytes = r.value;
        var bytesStart = readerPos;
        readerPos += bytes.length;
        var from = Math.max(0, pos - bytesStart);
        var to = Math.min(bytes.length, end - bytesStart + 1);
        if (to <= from) return step(controller); // still skipping up to `start`
        controller.enqueue(bytes.subarray(from, to));
        pos = bytesStart + to;
        if (pos > end) {
          dropReader();
          finish();
          controller.close();
        }
      });
  };

  return new ReadableStream({
    pull: function (controller) {
      return step(controller).catch(function (err) {
        dropReader();
        finish();
        controller.error(err);
      });
    },
    cancel: function () {
      // She seeked or closed the video. A piece already downloading still
      // finishes and is saved (its other tee branch keeps reading).
      dropReader();
      finish();
    },
  });
}

function serveMedia(event, id) {
  var request = event.request;
  var name = MEDIA_PREFIX + id;
  return caches
    .has(name)
    .catch(function () {
      return false;
    })
    .then(function (wanted) {
      // Not one she's keeping: the network, exactly as before.
      if (!wanted) return fetch(request);
      return caches.open(name).then(function (cache) {
        return readMediaMeta(cache).then(function (meta) {
          var range = parseRangeHeader(request.headers.get('Range'));
          var partial = !!range;
          if (!range) {
            if (!meta) return fetch(request);
            range = { start: 0, end: null };
          }
          var ctx = { cache: cache, id: id, url: request.url, meta: meta, life: mediaLifetime(event) };
          var firstPiece = Math.floor(range.start / MEDIA_CHUNK);
          // First time this file is seen there's no meta yet: the first
          // piece's answer is what tells us the size and type.
          var first = meta ? Promise.resolve(null) : fetchMediaChunk(ctx, firstPiece);
          return first.then(function (got) {
            if (got && got.passthrough) {
              ctx.life.done();
              return got.passthrough;
            }
            if (got) ctx.meta = got.meta;
            var size = ctx.meta.size;
            if (range.start >= size) {
              if (got) got.stream.cancel().catch(noop);
              ctx.life.done();
              return fetch(request); // past the end: let the server say 416
            }
            var end = range.end === null ? size - 1 : Math.min(range.end, size - 1);
            var body = mediaRangeStream(
              ctx,
              range.start,
              end,
              got ? { stream: got.stream, offset: firstPiece * MEDIA_CHUNK } : null
            );
            var headers = {
              'Content-Type': ctx.meta.type,
              'Content-Length': String(end - range.start + 1),
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-store',
              // Lets the page's filler see that this worker (not the bare
              // network) answered, i.e. that the piece is being saved.
              'X-Media-Cache': '1',
            };
            if (!partial) return new Response(body, { status: 200, headers: headers });
            headers['Content-Range'] = 'bytes ' + range.start + '-' + end + '/' + size;
            return new Response(body, { status: 206, statusText: 'Partial Content', headers: headers });
          });
        });
      });
    });
}

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
