// Service-worker and runtime-cache handling for the app shell (G4 Notifications).
// main.jsx calls clearAppRuntimeCaches() while recovering from a failed bootstrap;
// G4 adds the push service-worker registration here (spec 4, C-INT-7).

export const CACHE_PURGE_TOKENS = ['workbox', 'precache', 'vite-pwa', 'api-cache', 'images']

export async function clearAppRuntimeCaches() {
  const jobs = []

  if ('serviceWorker' in navigator) {
    jobs.push(
      navigator.serviceWorker.getRegistrations().then((registrations) => (
        Promise.allSettled(registrations.map((registration) => registration.unregister()))
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
