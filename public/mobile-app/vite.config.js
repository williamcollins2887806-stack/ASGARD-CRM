import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';

/* Прокси API для dev-сервера.
   Раньше здесь был прод (92.242.61.184:3000) — каждый запрос шёл через интернет
   и отвечал ~16 секунд, из-за чего приложение «тормозило». Теперь по умолчанию
   локальный бэкенд (:3100). Переопределяется переменной VITE_API_PROXY. */
const API_PROXY = process.env.VITE_API_PROXY || 'http://127.0.0.1:3100';

/* S2: вендоров выносим в отдельные параллельные чанки — браузер качает
   их конкурентно и кэширует между деплоями (хэш меняется только при
   смене версии библиотеки). react/router — критичный путь, charts/three —
   грузятся только экранами, которым нужны. */
function manualChunks(id) {
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
}

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
      '/api': { target: API_PROXY, changeOrigin: true },
    },
  },
  base: '/m/',
  build: {
    outDir: 'dist',
    rollupOptions: { output: { manualChunks } },
  },
});
