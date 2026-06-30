/* ============================================================
   v2 薄代理：Vercel Serverless Function
   ─ 代管 DEEPSEEK_API_KEY，轉發前端 → Deepseek 的請求
   ─ 無狀態、不存資料、不做 agent loop（loop 留在瀏覽器）
   ============================================================
   前端把「要送給 Deepseek 的 messages + tools 定義」POST 到 /api/copilot，
   本函式代入環境變數的 Key 轉發，再原樣回傳 Deepseek 的回應。
   如此前端瀏覽器無需持有任何 API Key。
   ============================================================ */

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// 簡易速率限制：每 IP 每 60 秒最多 20 次請求，防止共用 Key 被濫用
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const ipHits = new Map(); // 僅在單一函式實例生命週期內有效

function rateLimited(ip) {
  const now = Date.now();
  const hits = ipHits.get(ip) || [];
  const recent = hits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  ipHits.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  // 僅允許 POST
  if (req.method !== 'POST') {
    res.status(405).setHeader('Allow', 'POST').json({ error: 'Method Not Allowed' });
    return;
  }

  // 環境變數檢查（部署時在 Vercel 後台設定 DEEPSEEK_API_KEY）
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '伺服器尚未設定 DEEPSEEK_API_KEY 環境變數' });
    return;
  }

  // 速率限制
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
    return;
  }

  // 代轉請求至 Deepseek
  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(data);
  } catch (err) {
    res.status(502).json({ error: `無法連線至 Deepseek：${err.message}` });
  }
}
