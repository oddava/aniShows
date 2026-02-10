import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Parse ALLOWED_HOSTS from environment variable
const allowedHosts = process.env.ALLOWED_HOSTS 
  ? process.env.ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
  : ['localhost', '127.0.0.1']

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
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
    // CSS optimization
    cssMinify: true,
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
}))
