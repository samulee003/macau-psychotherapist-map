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

// 請求體驗證上限：防止惡意夾帶超長內容耗用代管的 Deepseek 額度
// （系統指令含 41 個地點的 JSON 摘要 + 對話歷史最多 10 則，正常請求遠低於此上限）
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 60_000;

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

/**
 * 驗證前端傳入的 messages 陣列是否在合理範圍內。
 * @returns {string|null} 錯誤訊息（合法時回傳 null）
 */
function validateMessages(body) {
  if (!body || typeof body !== 'object') return '請求內容格式錯誤';
  const messages = body.messages;
  if (!Array.isArray(messages)) return '缺少有效的 messages 陣列';
  if (messages.length === 0) return 'messages 不可為空';
  if (messages.length > MAX_MESSAGES) return `messages 數量超過上限（${MAX_MESSAGES}）`;

  let totalChars = 0;
  for (let idx = 0; idx < messages.length; idx++) {
    const m = messages[idx];
    if (!m || typeof m !== 'object') return 'messages 內含無效項目';
    if (!ALLOWED_ROLES.has(m.role)) return `不支援的 role：${m.role}`;
    // 只允許第一則訊息為 system role，防止在對話中間夾帶偽造的系統指令
    if (m.role === 'system' && idx !== 0) return 'system role 只能出現在第一則訊息';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    if (content.length > MAX_MESSAGE_CHARS) return `單一訊息內容超過上限（${MAX_MESSAGE_CHARS} 字元）`;
    totalChars += content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) return `訊息總長度超過上限（${MAX_TOTAL_CHARS} 字元）`;

  return null;
}

function rateLimited(ip) {
  const now = Date.now();
  
  // Periodic global cache cleanup if it grows too large to prevent memory leaks
  if (ipHits.size > 1000) {
    for (const [key, hits] of ipHits.entries()) {
      const validHits = hits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (validHits.length === 0) {
        ipHits.delete(key);
      } else {
        ipHits.set(key, validHits);
      }
    }
  }

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

  // 請求體驗證：防止夾帶超長內容耗用代管的 API 額度
  const validationError = validateMessages(req.body);
  if (validationError) {
    res.status(400).json({ error: `請求內容不符規範：${validationError}` });
    return;
  }

  // 代轉請求至 Deepseek
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.status(upstream.status).setHeader('Content-Type', contentType).send(data);
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'Deepseek API 請求超時（10 秒）' : `無法連線至 Deepseek：${err.message}`
    });
  }
}
