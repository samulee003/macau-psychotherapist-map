import { defineConfig } from 'vite';
import { cpSync } from 'fs';

export default defineConfig(() => {
  return {
    base: './',
    build: {
      outDir: 'dist',
      assetsInlineLimit: 4096,
      // data/data.json 透過 fetch() 動態載入，Vite 不會自動打包。
      // 用 closeBundle 在打包後原樣複製到 dist/data/，確保部署後可存取。
      emptyOutDir: true,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          // maplibre-gl 體積大且極少變動，拆成獨立 chunk 利於長期快取
          manualChunks(id) {
            if (id.includes('maplibre-gl')) return 'maplibre';
          },
        },
      },
    },
    server: {
      port: 5173,
      open: true,
    },
    plugins: [
      {
        name: 'copy-data',
        apply: 'build', // 僅在 build 時執行（dev/test 不需要，也避免 vitest 誤觸發）
        closeBundle() {
          // 複製資料 JSON
          cpSync('data', 'dist/data', { recursive: true });
          console.log('\n[data] 已複製 data/ → dist/data/');
          
          // 複製社交分享預覽縮圖
          try {
            cpSync('og-image.jpg', 'dist/og-image.jpg');
            console.log('[og-image] 已複製 og-image.jpg → dist/og-image.jpg');
          } catch (e) {
            console.warn('[og-image] 複製 og-image.jpg 失敗:', e.message);
          }
        },
      },
    ],
  };
});

