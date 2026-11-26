// Loaded from index.html as a file (not inline) so the CSP can forbid inline scripts.
(function () {
  // The first page of a visit paints without its entry fades (route, card and
  // image fade-ins): Chrome counts the largest paint only once it is fully
  // shown, so each fade delayed LCP by its length (RA-002). Layout.jsx clears
  // this at the first in-app navigation; later pages fade in as designed.
  document.documentElement.setAttribute('data-boot', '');
  // Safety net for stale service workers and caches. The app ships no caching
  // service worker (C-INT-7); the only one it registers is the web-push worker
  // (/service-worker.js), which caches nothing and is kept: unregistering it
  // would silently turn web push off on every page load. Anything else is left
  // over from an old Workbox/VitePWA build, so it is removed, together with its
  // caches (including `api-cache`, which held authenticated API responses).
  var PUSH_WORKER = '/service-worker.js';
  var STALE_CACHE_TOKENS = ['workbox', 'precache', 'vite-pwa'];
  var STALE_CACHE_NAMES = ['api-cache', 'images'];
  function isPushWorker(registration) {
    var workers = [registration.active, registration.waiting, registration.installing];
    for (var i = 0; i < workers.length; i += 1) {
      var url = workers[i] && workers[i].scriptURL;
      if (url && url.slice(-PUSH_WORKER.length) === PUSH_WORKER) return true;
    }
    return false;
  }
  function isStaleCache(key) {
    if (STALE_CACHE_NAMES.indexOf(key) !== -1) return true;
    for (var i = 0; i < STALE_CACHE_TOKENS.length; i += 1) {
      if (key.indexOf(STALE_CACHE_TOKENS[i]) !== -1) return true;
    }
    return false;
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(function (registrations) {
        return Promise.all(registrations.filter(function (registration) {
          return !isPushWorker(registration);
        }).map(function (registration) {
          return registration.unregister();
        }));
      })
      .catch(function () {});
  }
  if ('caches' in window) {
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(isStaleCache).map(function (key) {
          return caches.delete(key);
        }));
      })
      .catch(function () {});
  }

  // Hide the initial loader once the page has loaded.
  window.addEventListener('load', function () {
    setTimeout(function () {
      var loader = document.getElementById('initial-loader');
      if (loader) {
        loader.classList.add('hidden');
        setTimeout(function () {
          loader.remove();
        }, 300);
      }
    }, 100);
  });
})();
