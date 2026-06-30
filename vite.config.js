import { defineConfig, loadEnv } from 'vite';
import { cpSync } from 'fs';

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
            const body = Buffer.concat(chunks).toString();

            try {
              const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body,
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

