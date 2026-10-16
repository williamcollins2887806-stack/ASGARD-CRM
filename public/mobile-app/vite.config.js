import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://92.242.61.184:3000',
    },
  },
  base: '/m/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        /* S2: вендоров выносим в отдельные параллельные чанки — браузер качает
           их конкурентно и кэширует между деплоями (хэш меняется только при
           смене версии библиотеки). react/router — критичный путь, charts/three —
           грузятся только экранами, которым нужны. */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('/three/') || id.includes('three-')) return 'vendor-three';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('jssip')) return 'vendor-sip';
          if (id.includes('zustand')) return 'vendor-state';
          if (id.includes('@base-ui') || id.includes('radix')) return 'vendor-ui';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
          return 'vendor-misc';
        },
      },
    },
  },
});
