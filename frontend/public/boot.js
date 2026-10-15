// Loaded from index.html as a file (not inline) so the CSP can forbid inline scripts.
(function () {
  // Safety net for stale service-worker caches after deployments.
  var pwaEnabledMeta = document.querySelector('meta[name="pwa-enabled"]');
  var pwaEnabled = pwaEnabledMeta && pwaEnabledMeta.getAttribute('content') === 'true';

  if (!pwaEnabled) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(function (registrations) {
          return Promise.all(registrations.map(function (registration) {
            return registration.unregister();
          }));
        })
        .catch(function () {});
    }
    if ('caches' in window) {
      caches.keys()
        .then(function (keys) {
          return Promise.all(keys
            .filter(function (key) {
              return key.includes('workbox') || key.includes('precache') || key.includes('vite-pwa');
            })
            .map(function (key) {
              return caches.delete(key);
            }));
        })
        .catch(function () {});
    }
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
