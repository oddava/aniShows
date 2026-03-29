import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initSentry } from './sentry'
import './index.css'

const BOOTSTRAP_RECOVERY_KEY = 'frontend_bootstrap_recovery'
const CACHE_PURGE_TOKENS = ['workbox', 'precache', 'vite-pwa', 'api-cache', 'images']

function isRecoverableBootstrapError(error) {
  const message = String(
    error?.message
      || error?.reason?.message
      || error?.reason
      || ''
  )
  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'ChunkLoadError',
    'Loading chunk',
    "can't access property 'createContext' of undefined",
  ].some((needle) => message.includes(needle))
}

async function clearAppRuntimeCaches() {
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

function renderFatalBootstrapError() {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    return
  }
  rootElement.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#120a1a;color:#e5e7eb;padding:24px;text-align:center;font-family:system-ui,sans-serif;">
      <div>
        <h1 style="margin:0 0 12px;font-size:20px;">App failed to load</h1>
        <p style="margin:0;opacity:0.85;">Please hard refresh the page. If the issue persists, clear browser site data for this domain.</p>
      </div>
    </div>
  `
}

async function recoverAndReload() {
  const hasRetried = sessionStorage.getItem(BOOTSTRAP_RECOVERY_KEY) === '1'
  await clearAppRuntimeCaches()

  if (!hasRetried) {
    sessionStorage.setItem(BOOTSTRAP_RECOVERY_KEY, '1')
    window.location.reload()
    return
  }

  renderFatalBootstrapError()
}

async function bootstrap() {
  // Initialize Sentry before rendering.
  initSentry()

  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Root element is missing')
  }

  try {
    const { default: App } = await import('./App.jsx')
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    sessionStorage.removeItem(BOOTSTRAP_RECOVERY_KEY)
  } catch (error) {
    if (isRecoverableBootstrapError(error)) {
      await recoverAndReload()
      return
    }
    renderFatalBootstrapError()
    throw error
  }
}

bootstrap().catch((error) => {
  console.error('Frontend bootstrap failed:', error)
})
