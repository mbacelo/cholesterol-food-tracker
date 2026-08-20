/**
 * A deliberately minimal service worker.
 *
 * Chrome's install criteria want a worker with a fetch handler, so there is one.
 * It caches NOTHING: caching authenticated JSON would serve one account's data
 * after a session change and make a 401 sticky, and there is no offline write
 * queue by design -- logging needs the model, so the app shows an offline state
 * instead of pretending to work (functional spec §6.10).
 *
 * /api is never touched.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // Pass through to the network. Intentionally no caching.
})
