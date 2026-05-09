// 🎙️ AI Meeting Recorder — Service Worker
const VERSION = 'v1.0.0';
const CACHE_NAME = `meeting-recorder-${VERSION}`;
const OFFLINE_QUEUE_KEY = 'offline_recording_queue';

// Cache these on install
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap'
];

// ── INSTALL ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        PRECACHE.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean old caches
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      )
    ])
  );
});

// ── FETCH — Cache-first for static, network-first for API ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Anthropic API — always network, never cache
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Nominatim geocoding — network with cache fallback
  if (url.hostname === 'nominatim.openstreetmap.org') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets — cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML navigation
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── BACKGROUND SYNC — process queued recordings when online ──
self.addEventListener('sync', event => {
  if (event.tag === 'process-recordings') {
    event.waitUntil(processQueuedRecordings());
  }
});

async function processQueuedRecordings() {
  // Notify all open clients to process the queue
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'PROCESS_QUEUE' });
  });
}

// ── ONLINE event relay ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Periodic check — when SW receives online signal from page
self.addEventListener('message', event => {
  if (event.data?.type === 'ONLINE_STATUS_CHANGE' && event.data.online) {
    processQueuedRecordings();
  }
});
