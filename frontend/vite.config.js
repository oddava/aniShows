import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Parse ALLOWED_HOSTS from environment variable
const allowedHosts = process.env.ALLOWED_HOSTS 
  ? process.env.ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
  : ['localhost', '127.0.0.1']

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // PWA support with service worker for caching
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
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
        manualChunks: {
          // Vendor chunks - separate frequently used libraries
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', '@tanstack/react-virtual'],
          // Icons chunk - lucide is large
          'vendor-icons': ['lucide-react'],
        },
        // Optimize chunk naming
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Disable source maps in all outputs
        sourcemap: false,
      },
    },
    // Minification options - use esbuild (faster than terser)
    minify: 'esbuild',
    esbuildOptions: {
      drop: ['console', 'debugger'],
    },
    // Optimize bundle size
    target: 'es2015',
    sourcemap: false,
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
      '/media': {
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
  // Preload critical assets
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (hostType === 'js') {
        return { relative: true }
      }
      return { relative: true }
    },
  },
}))
