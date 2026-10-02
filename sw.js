/* 画面のファイルを端末にも保存し、通信が悪いときの備えにする(新しい版は通信できるとき自動で取得) */
const C = 'sr-v12', FILES = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'config.js', 'vendor/leaflet.js', 'vendor/leaflet.css'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(x => { if (x.ok) { const y = x.clone(); caches.open(C).then(c => c.put(e.request, y)); } return x; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
