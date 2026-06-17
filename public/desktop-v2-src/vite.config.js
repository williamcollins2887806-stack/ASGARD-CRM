import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/v2/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5174,
    proxy: {
      // D-2 browser 15-roles test: backend lives on :3100 (asgard_crm_test clone).
      // Was :3000 (dev) — repointed for full-roles run on real clone backend.
      '/api': 'http://127.0.0.1:3100'
    }
  },
  build: {
    outDir: '../v2',
    emptyOutDir: true,
    sourcemap: false,
    // КРУГ A пункт 5: код-сплит — vendor отдельным чанком, тяжёлые
    // редко-используемые страницы вынесены в React.lazy (см. App.jsx).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router')) return 'router';
            if (id.includes('react-dom') || id.includes('scheduler')) return 'react-dom';
            if (id.includes('/react/')) return 'react';
            return 'vendor';
          }
        }
      }
    }
  }
});
