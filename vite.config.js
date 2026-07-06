import { defineConfig, loadEnv } from 'vite';
import { cpSync } from 'fs';
import { sanitizeCopilotRequest } from './lib/copilot-proxy.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

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
          manualChunks: { maplibre: ['maplibre-gl'] },
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
            cpSync('og-image.png', 'dist/og-image.png');
            console.log('[og-image] 已複製 og-image.png → dist/og-image.png');
          } catch (e) {
            console.warn('[og-image] 複製 og-image.png 失敗:', e.message);
          }
        },
      },
      {
        // v2 開發用：在 Vite dev server 攔截 /api/copilot，
        // 代轉至 Deepseek（讀本機 .env 的 DEEPSEEK_API_KEY），
        // 模擬 Vercel serverless function 行為，讓本地開發免另外起後端。
        // 注意：此 middleware 僅在 dev 模式生效，不影響 build 產出。
        name: 'copilot-dev-proxy',
        configureServer(server) {
          server.middlewares.use('/api/copilot', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.setHeader('Allow', 'POST');
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }

            const apiKey = env.DEEPSEEK_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: '本機尚未設定 DEEPSEEK_API_KEY。請在專案根目錄建立 .env 並填入 DEEPSEEK_API_KEY=sk-...',
              }));
              return;
            }

            // 收集 request body
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const rawBody = Buffer.concat(chunks).toString();

            // 與正式環境（api/copilot.js）一致：驗證並淨化請求，
            // model / max_tokens / temperature 由伺服器端強制指定
            let parsed;
            try {
              parsed = JSON.parse(rawBody);
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: '請求內容不是有效的 JSON' }));
              return;
            }
            const { error: validationError, payload } = sanitizeCopilotRequest(parsed);
            if (validationError) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `請求內容不符規範：${validationError}` }));
              return;
            }

            try {
              const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(payload),
              });
              const data = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(data);
            } catch (err) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `無法連線至 Deepseek：${err.message}` }));
            }
          });
        },
      },
    ],
  };
});

