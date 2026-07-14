const CACHE_NAME = 'railway-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './master_timetable.csv'
];

// Install event: Save files to phone on first load
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

// Fetch event: Network first, fallback to cache if offline
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // If network fetch succeeds, update the hidden cache with the newest data
                if (response && response.status === 200) {
                    let responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // If offline (network fails), serve the saved version from the phone
                return caches.match(event.request);
            })
    );
});
