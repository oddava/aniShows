import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Parse ALLOWED_HOSTS from environment variable
const allowedHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
  : ['localhost', '127.0.0.1']

// Deployment timestamp for cache busting and debugging
const deploymentTime = new Date().toISOString()
// Dev proxy targets. Default to the docker-compose service names; override to
// point the dev server at a backend running elsewhere (e.g. a local mock).
const devApiTarget = process.env.DEV_API_TARGET || 'http://web:8000'
const devMediaTarget = process.env.DEV_MEDIA_TARGET || 'http://minio:9000'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
      ],
    },
  },
  plugins: [
    react(),
    // Inject deployment timestamp into HTML for debugging
    {
      name: 'html-deployment-info',
      transformIndexHtml(html) {
        return html.replace(
          '</head>',
          `  <meta name="deployment-time" content="${deploymentTime}">\n  </head>`
        )
      }
    },
    // No Workbox/VitePWA service worker (C-INT-7). The only service worker is the
    // web-push worker, public/service-worker.js, registered at scope `/` by
    // components/notifications/pushClient.js. A second worker at `/` would
    // replace it (one registration per scope) and turn push off, and the old
    // `api-cache` rule kept authenticated /api/v1 responses in CacheStorage for
    // 24 h, past logout. public/boot.js still unregisters any leftover worker
    // and purges those caches on old installs.
    // Bundle analyzer - only loaded when needed
    mode === 'analyze' && (async () => {
      const { visualizer } = await import('rollup-plugin-visualizer')
      return visualizer({
        open: true,
        gzipSize: true,
        brotliSize: true,
      })
    })(),
  ].filter(Boolean),
  build: {
    // Optimize chunking
    rollupOptions: {
      output: {
        // Keep default chunking. Custom vendor chunking introduced a circular
        // dependency that could make React undefined at runtime.
        // Optimize chunk naming
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Minification options - use terser for better compression
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug']
      }
    },
    // Optimize bundle size
    target: 'es2015',
    // Hidden source maps for Sentry error tracking (not exposed to browser)
    sourcemap: 'hidden',
    // CSS optimization - no source maps in production
    cssMinify: true,
    cssCodeSplit: true,
    // Report bundle size
    reportCompressedSize: true,
    // Enable chunk size warnings
    chunkSizeWarningLimit: 500,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: allowedHosts,
    hmr: {
      overlay: false, // Disable error overlay in production
    },
    proxy: {
      '/api': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: devApiTarget,
        changeOrigin: true,
        ws: true,
      },
      '/media': {
        // Media lives in the MinIO bucket under the "media/" prefix.
        target: devMediaTarget,
        changeOrigin: true,
        rewrite: (path) => `/${process.env.MEDIA_BUCKET || 'anishows-media'}${path}`,
      },
      '/django-admin': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/static': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/accounts': {
        target: devApiTarget,
        changeOrigin: true,
      },
      // robots.txt and the sitemap come from Django (apps/core/views/seo.py).
      '/robots.txt': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/sitemap': {
        target: devApiTarget,
        changeOrigin: true,
      },
    },
  },
  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      '@tanstack/react-virtual',
    ],
    exclude: ['lucide-react'], // Lucide icons are tree-shaken better when excluded
  },
}))
