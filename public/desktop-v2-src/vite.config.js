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
          // Нормализуем разделители путей для Windows (\) и Linux (/).
          const norm = id.replace(/\\/g, '/');
          if (norm.includes('/node_modules/')) {
            if (norm.includes('/node_modules/react-router')) return 'router';
            // ВАЖНО: react + react-dom + scheduler в ОДНОМ chunk.
            // Узкое матчирование по точным путям — иначе пакеты типа
            // @floating-ui/react цепляются в react-vendor → цикл импорта
            // react-vendor ↔ editor (TipTap) → runtime error
            // «__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED».
            if (norm.includes('/node_modules/react/') ||
                norm.includes('/node_modules/react-dom/') ||
                norm.includes('/node_modules/scheduler/')) {
              return 'react-vendor';
            }
            // S-13H: TipTap composer (~160 KB gzip) — отдельный lazy chunk,
            // загружается только при открытии /correspondence/composer.
            if (norm.includes('/node_modules/@tiptap/') ||
                norm.includes('/node_modules/prosemirror') ||
                norm.includes('/node_modules/tiptap-markdown')) {
              return 'editor';
            }
            return 'vendor';
          }
        }
      }
    }
  }
});
