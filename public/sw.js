// Service Worker for Actualy PWA
// Simple cache-first strategy for fast loading

const CACHE_NAME = 'actualy-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
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

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request).then(fetchResponse => {
          // Don't cache API calls or external resources
          if (!event.request.url.startsWith(self.location.origin) ||
              event.request.url.includes('/api/')) {
            return fetchResponse;
          }

          // Cache successful responses
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      })
      .catch(() => {
        // Offline fallback for HTML pages
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});
