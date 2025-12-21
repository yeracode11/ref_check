import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Оптимизация для production
    minify: 'esbuild', // esbuild быстрее чем terser
    // Code splitting для уменьшения размера бандла
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'leaflet-vendor': ['leaflet', 'leaflet.markercluster'],
          'chart-vendor': ['recharts'],
          'qr-vendor': ['react-qr-code'],
        },
      },
    },
    // Увеличиваем лимит предупреждений о размере чанков
    chunkSizeWarningLimit: 1000,
    // Оптимизация размера
    target: 'es2015',
    cssCodeSplit: true,
  },
  // Оптимизация для dev сервера
  server: {
    hmr: {
      overlay: false, // Отключаем overlay для ускорения
    },
  },
  // Оптимизация зависимостей
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
});


