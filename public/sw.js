// Service Worker for Actualy PWA
// Network-first for HTML, cache-first for static assets

const CACHE_NAME = 'timer-local-stable-v1';
const urlsToCache = [
  '/manifest.json',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Install event - cache resources
self.addEventListener('install', event => {
  console.log('[SW] Installing new service worker, version:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => {
        console.log('[SW] Installation complete, skipping waiting');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - network-first for HTML, cache-first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // NEVER cache API requests - always fetch from network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for HTML (index.html, /) to prevent stale HTML trap
  if (url.pathname === '/' || url.pathname === '/index.html' || event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Successfully fetched from network, return fresh HTML
          return response;
        })
        .catch(() => {
          // Network failed, fall back to cached version if available
          return caches.match('/index.html')
            .then(cached => cached || new Response('Offline', { status: 503 }));
        })
    );
    return;
  }

  // Cache-first for static assets (icons, manifest)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Return cached version
        }

        // Not in cache, fetch from network
        return fetch(event.request).then(fetchResponse => {
          // Don't cache external resources
          if (!event.request.url.startsWith(self.location.origin)) {
            return fetchResponse;
          }

          // Cache successful responses
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      })
  );
});

// Force immediate activation of new service worker
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
