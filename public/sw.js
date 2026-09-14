const CACHE_NAME = 'global-academy-v1';

const APP_SHELL = [
    '/',
    '/login.html',
    '/images/logo.png',
    '/images/school-bg.jpg'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});
self.addEventListener('fetch', event => {

    // Only handle GET requests.
    if (event.request.method !== 'GET') {
        return;
    }

    // Never cache API responses.
    if (event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {

                if (response.ok) {

                    const responseClone =
                        response.clone();

                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(
                                event.request,
                                responseClone
                            );
                        });
                }

                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});