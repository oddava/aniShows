// Service-worker and runtime-cache handling for the app shell (G4 Notifications).
// main.jsx calls clearAppRuntimeCaches() while recovering from a failed bootstrap.
// The web-push worker (/service-worker.js, registered by
// components/notifications/pushClient.js) is kept: it caches nothing, and
// unregistering it would turn push off (spec 4, C-INT-7).

export const CACHE_PURGE_TOKENS = ['workbox', 'precache', 'vite-pwa', 'api-cache', 'images']
export const PUSH_WORKER_PATH = '/service-worker.js'

/** True when any of the registration's workers is the push worker. */
export function isPushWorkerRegistration(registration) {
  return [registration?.active, registration?.waiting, registration?.installing]
    .some((worker) => typeof worker?.scriptURL === 'string' && worker.scriptURL.endsWith(PUSH_WORKER_PATH))
}

export async function clearAppRuntimeCaches() {
  const jobs = []

  if ('serviceWorker' in navigator) {
    jobs.push(
      navigator.serviceWorker.getRegistrations().then((registrations) => (
        Promise.allSettled(
          registrations
            .filter((registration) => !isPushWorkerRegistration(registration))
            .map((registration) => registration.unregister()),
        )
      )),
    )
  }

  if ('caches' in window) {
    jobs.push(
      caches.keys().then((keys) => (
        Promise.allSettled(
          keys
            .filter((key) => CACHE_PURGE_TOKENS.some((token) => key.includes(token)))
            .map((key) => caches.delete(key)),
        )
      )),
    )
  }

  await Promise.allSettled(jobs)
}
