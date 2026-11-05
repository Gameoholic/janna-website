// Unit-tests web/public/sw.js (offline videos + listing fallback) in Node with a
// mock Cache Storage and a mock range-serving server. No browser needed.
// Run: node scripts/test-sw.mjs   (optionally pass another sw.js path)
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const ORIGIN = 'https://app.test';
const CHUNK = 1048576;

// ---- mock Cache Storage ----
class MockCache {
  constructor() { this.map = new Map(); }
  key(req) { return new URL(typeof req === 'string' ? req : req.url, ORIGIN).href; }
  async match(req) { const e = this.map.get(this.key(req)); return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined; }
  async put(req, res) { const body = await res.arrayBuffer(); this.map.set(this.key(req), { body, status: res.status, headers: [...res.headers] }); }
  async delete(req) { return this.map.delete(this.key(req)); }
  async keys() { return [...this.map.keys()].map((u) => new Request(u)); }
}
const store = new Map();
const caches = {
  async has(n) { return store.has(n); },
  async open(n) { if (!store.has(n)) store.set(n, new MockCache()); return store.get(n); },
  async delete(n) { return store.delete(n); },
  async keys() { return [...store.keys()]; },
  async match(req) { for (const c of store.values()) { const r = await c.match(req); if (r) return r; } },
};

// ---- mock server ----
const FILE_SIZE = 3 * CHUNK + 12345; // 4 pieces, last one short
const file = Buffer.alloc(FILE_SIZE);
for (let i = 0; i < FILE_SIZE; i++) file[i] = (i * 31 + (i >> 8)) & 255;
let etag = 'W/"v1"';
let online = true;
let rangeHits = 0;
let dieAfterBytes = null; // cut a response off mid-stream
const apiJson = { '/api/me': { device: { id: 'd1' } } };

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
  const headers = new Headers(init.headers || (typeof input === 'string' ? {} : input.headers));
  if (!online) throw new TypeError('Failed to fetch');
  if (url.pathname.startsWith('/api/media/')) {
    if (url.pathname !== '/api/media/f1') return new Response('{}', { status: 404 });
    const m = /^bytes=(\d+)-(\d*)$/.exec(headers.get('Range') || '');
    if (!m) return new Response(file, { status: 200, headers: { 'Content-Type': 'video/mp4', ETag: etag } });
    rangeHits++;
    const start = +m[1]; const end = Math.min(m[2] ? +m[2] : FILE_SIZE - 1, FILE_SIZE - 1);
    if (start >= FILE_SIZE) return new Response('', { status: 416 });
    const slice = file.subarray(start, end + 1);
    let body = slice;
    if (dieAfterBytes !== null) {
      const cut = dieAfterBytes;
      body = new ReadableStream({
        start(c) { c.enqueue(new Uint8Array(slice.subarray(0, cut))); c.error(new TypeError('network died')); },
      });
    } else {
      // stream in 64KB pieces like a real network
      let off = 0;
      body = new ReadableStream({ pull(c) { if (off >= slice.length) return c.close(); c.enqueue(new Uint8Array(slice.subarray(off, off + 65536))); off += 65536; } });
    }
    return new Response(body, { status: 206, headers: { 'Content-Type': 'video/mp4', ETag: etag, 'Content-Range': `bytes ${start}-${end}/${FILE_SIZE}`, 'Content-Length': String(end - start + 1) } });
  }
  if (apiJson[url.pathname]) return new Response(JSON.stringify(apiJson[url.pathname]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response('nope', { status: 404 });
}

// ---- load the worker ----
const listeners = {};
const waits = [];
const self = {
  location: new URL(ORIGIN + '/sw.js'),
  addEventListener: (t, fn) => { listeners[t] = fn; },
  skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] },
  registration: {},
};
const ctx = vm.createContext({ self, caches, fetch: mockFetch, Response, Request, Headers, URL, ReadableStream, Blob, Promise, setTimeout, clearTimeout, console, TypeError, Error, JSON, Math, Number, String });
vm.runInContext(fs.readFileSync(process.argv[2] || new URL('../web/public/sw.js', import.meta.url), 'utf8'), ctx);

async function dispatchFetch(path, headers = {}) {
  let responded = null;
  const event = {
    request: new Request(ORIGIN + path, { headers }),
    respondWith(p) { responded = Promise.resolve(p); },
    waitUntil(p) { waits.push(p); },
  };
  listeners.fetch(event);
  return responded;
}
async function body(res) { return Buffer.from(await res.arrayBuffer()); }
const settle = () => Promise.all(waits.splice(0)).then(() => new Promise((r) => setTimeout(r, 20)));

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }

await test('not kept: passes straight to the network', async () => {
  const res = await dispatchFetch('/api/media/f1', { Range: 'bytes=0-' });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('X-Media-Cache'), null);
  await res.arrayBuffer();
  assert.equal(store.size, 0);
});

await caches.open('janna-media-f1');

await test('kept, first play online: exact bytes, every piece saved', async () => {
  rangeHits = 0;
  const res = await dispatchFetch('/api/media/f1', { Range: 'bytes=0-' });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), `bytes 0-${FILE_SIZE - 1}/${FILE_SIZE}`);
  assert.equal(res.headers.get('X-Media-Cache'), '1');
  const b = await body(res);
  assert.ok(b.equals(file), 'bytes match');
  await settle();
  const c = store.get('janna-media-f1');
  const keys = (await c.keys()).map((r) => new URL(r.url).pathname).sort();
  assert.deepEqual(keys, ['/__mc/c/0', '/__mc/c/1', '/__mc/c/2', '/__mc/c/3', '/__mc/meta']);
  assert.equal(rangeHits, 4);
});

await test('offline: full file from the phone', async () => {
  online = false;
  const b = await body(await dispatchFetch('/api/media/f1', { Range: 'bytes=0-' }));
  assert.ok(b.equals(file));
});

await test('offline: arbitrary mid-file ranges are exact', async () => {
  for (const [s, e] of [[1500000, 2600000], [CHUNK - 1, CHUNK], [3 * CHUNK + 5, null], [0, 0], [FILE_SIZE - 1, null]]) {
    const res = await dispatchFetch('/api/media/f1', { Range: `bytes=${s}-${e ?? ''}` });
    const end = e ?? FILE_SIZE - 1;
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), `bytes ${s}-${end}/${FILE_SIZE}`);
    assert.equal(res.headers.get('Content-Length'), String(end - s + 1));
    assert.ok((await body(res)).equals(file.subarray(s, end + 1)), `range ${s}-${e}`);
  }
});

await test('cancelling mid-stream (a seek) does not throw', async () => {
  const res = await dispatchFetch('/api/media/f1', { Range: 'bytes=0-' });
  const reader = res.body.getReader();
  await reader.read();
  await reader.cancel();
});

await test('partly saved + offline: saved part plays, then the stream errors', async () => {
  const c = store.get('janna-media-f1');
  await c.delete('/__mc/c/2');
  const res = await dispatchFetch('/api/media/f1', { Range: 'bytes=0-' });
  const reader = res.body.getReader();
  let got = 0; let err = null;
  try { for (;;) { const r = await reader.read(); if (r.done) break; got += r.value.length; } } catch (e) { err = e; }
  assert.ok(err, 'errored');
  assert.equal(got, 2 * CHUNK);
});

await test('back online: missing piece is fetched once and saved', async () => {
  online = true; rangeHits = 0;
  const b = await body(await dispatchFetch('/api/media/f1', { Range: `bytes=${2 * CHUNK}-${3 * CHUNK - 1}` }));
  assert.ok(b.equals(file.subarray(2 * CHUNK, 3 * CHUNK)));
  await settle();
  assert.equal(rangeHits, 1);
  assert.ok(await store.get('janna-media-f1').match('/__mc/c/2'));
});

await test('two requests for the same missing piece: one download', async () => {
  const c = store.get('janna-media-f1');
  await c.delete('/__mc/c/1');
  rangeHits = 0;
  const [a, b] = await Promise.all([
    dispatchFetch('/api/media/f1', { Range: `bytes=${CHUNK}-${2 * CHUNK - 1}` }),
    dispatchFetch('/api/media/f1', { Range: `bytes=${CHUNK}-${2 * CHUNK - 1}` }),
  ]);
  const [ba, bb] = await Promise.all([body(a), body(b)]);
  assert.ok(ba.equals(file.subarray(CHUNK, 2 * CHUNK)) && bb.equals(ba));
  await settle();
  assert.equal(rangeHits, 1);
});

await test('a piece cut off mid-download is never saved', async () => {
  const c = store.get('janna-media-f1');
  await c.delete('/__mc/c/1');
  dieAfterBytes = 1000;
  const res = await dispatchFetch('/api/media/f1', { Range: `bytes=${CHUNK}-` });
  let err = null;
  try { await res.arrayBuffer(); } catch (e) { err = e; }
  assert.ok(err);
  await settle();
  assert.equal(await c.match('/__mc/c/1'), undefined);
  dieAfterBytes = null;
});

await test('file changed on server: old pieces wiped, stream errors, next request is the new file', async () => {
  etag = 'W/"v2"';
  for (let i = 0; i < 10; i++) file[i] ^= 0xff;
  const c = store.get('janna-media-f1');
  // piece 1 is missing (previous test), so serving it hits the network and sees the new ETag
  const res = await dispatchFetch('/api/media/f1', { Range: `bytes=${CHUNK}-` });
  let err = null;
  try { await res.arrayBuffer(); } catch (e) { err = e; }
  assert.ok(err, 'errored on change');
  await settle();
  const meta = await (await c.match('/__mc/meta')).json();
  assert.equal(meta.etag, 'W/"v2"');
  assert.equal(await c.match('/__mc/c/0'), undefined, 'old piece 0 wiped');
  const b = await body(await dispatchFetch('/api/media/f1', { Range: 'bytes=0-' }));
  assert.ok(b.equals(file));
});

await test('deleted on server (404): offline copy dropped', async () => {
  await caches.open('janna-media-gone');
  const res = await dispatchFetch('/api/media/gone', { Range: 'bytes=0-' });
  assert.equal(res.status, 404);
  await settle();
  assert.equal(await caches.has('janna-media-gone'), false);
});

await test('activate keeps offline videos and listings, drops old shell caches', async () => {
  await caches.open('janna-shell-v1');
  await caches.open('janna-api-v1');
  let p; listeners.activate({ waitUntil: (x) => { p = x; } }); await p;
  const names = await caches.keys();
  assert.ok(names.includes('janna-media-f1') && names.includes('janna-api-v1'));
  assert.ok(!names.includes('janna-shell-v1'));
});

await test('listing: cached online, served from cache offline', async () => {
  online = true;
  let res = await dispatchFetch('/api/me');
  assert.deepEqual(await res.json(), { device: { id: 'd1' } });
  await settle();
  online = false;
  res = await dispatchFetch('/api/me');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { device: { id: 'd1' } });
  online = true;
});

console.log(`\n${passed} passed`);
