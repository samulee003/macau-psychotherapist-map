import { defineConfig } from 'vite';
import { cpSync } from 'fs';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
    // data/data.json 透過 fetch() 動態載入，Vite 不會自動打包。
    // 用 closeBundle 在打包後原樣複製到 dist/data/，確保部署後可存取。
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
  },
  plugins: [
    {
      name: 'copy-data',
      closeBundle() {
        cpSync('data', 'dist/data', { recursive: true });
        console.log('\n[data] 已複製 data/ → dist/data/');
      },
    },
  ],
});
