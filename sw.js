// کار آفلاین: فایل‌های خود برنامه اول از شبکه، و اگر شبکه نبود از حافظه
importScripts('./js/version.js');

const CACHE = `avazyar-${self.AVAZYAR_VERSION}`;
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/version.js',
  './js/app.js',
  './js/pitch.js',
  './js/notes.js',
  './js/synth.js',
  './js/store.js',
  './js/lessons.js',
  './js/exercise.js',
  './js/stats.js',
  './js/charts.js',
  './js/lane.js',
  './fonts/Vazirmatn-Regular.woff2',
  './fonts/Vazirmatn-Bold.woff2',
  './fonts/Vazirmatn-ExtraBold.woff2',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});
