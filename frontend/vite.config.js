import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Parse ALLOWED_HOSTS from environment variable
const allowedHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
  : ['localhost', '127.0.0.1']

// Deployment timestamp for cache busting and debugging
const deploymentTime = new Date().toISOString()
const enablePWA = process.env.VITE_ENABLE_PWA === 'true'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
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
          `  <meta name="deployment-time" content="${deploymentTime}">\n  <meta name="pwa-enabled" content="${enablePWA ? 'true' : 'false'}">\n  </head>`
        )
      }
    },
    // PWA support is opt-in in production to avoid stale SW asset incidents.
    enablePWA && VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Activate new SW immediately without waiting for tabs to close
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Don't pre-cache HTML - let the browser always fetch index.html from network
        // so Caddy's no-cache headers work and new deployments are seen immediately
        globPatterns: ['**/*.{js,css,ico,png,svg,webp}'],
        // SPA navigation fallback
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/django-admin\//, /^\/media\//, /^\/static\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|gif|webp|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*\/api\/v1\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 24 * 60 * 60, // 24 hours
              },
            },
          },
        ],
      },
    }),
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
        target: 'http://web:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://daphne:8001',
        changeOrigin: true,
        ws: true,
      },
      '/media': {
        // Media files are served by Caddy/MinIO, not Django.
        // Proxying to web:8000 causes 404 for /media/* in dev.
        target: 'http://caddy:80',
        changeOrigin: true,
        // Caddy virtual host is bound to localhost in this setup.
        // Force host header so /media requests always hit the correct site block.
        headers: {
          Host: 'localhost',
        },
      },
      '/django-admin': {
        target: 'http://web:8000',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://web:8000',
        changeOrigin: true,
      },
      '/accounts': {
        target: 'http://web:8000',
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
