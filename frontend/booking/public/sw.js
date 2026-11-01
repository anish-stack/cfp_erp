/* CPF service worker — app shell offline, hashed assets cached, API never cached */
const VERSION = 'v1';
const SHELL = `cpf-shell-${VERSION}`;
const ASSETS = `cpf-assets-${VERSION}`;
const PRECACHE = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, ASSETS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

const trim = async (name, max) => {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // only same-origin; API, uploads and signed documents always go to the network
  if (url.origin !== self.location.origin || /^\/(api|uploads|d)\//.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put('/index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/offline.html'));
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // content-hashed files never change → cache first
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { (await caches.open(ASSETS)).put(req, res.clone()); trim(ASSETS, 120); }
      return res;
    })());
    return;
  }
  if (/\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then(async (res) => { if (res.ok) (await caches.open(SHELL)).put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});
