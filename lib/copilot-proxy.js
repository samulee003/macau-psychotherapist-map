/* ============================================================
   Copilot 代理共用邏輯：請求驗證與淨化
   ─ 由 api/copilot.js（Vercel 正式環境）與 vite.config.js
     （本地 dev middleware）共用，確保兩邊行為一致。
   ─ 核心原則：不信任前端傳入的任何模型參數。model、
     temperature、max_tokens 一律由伺服器端強制指定，
     前端只能提供 messages 與（白名單內的）tools。
   ============================================================ */

// 伺服器強制指定的模型參數（前端傳入值一律忽略）
export const FORCED_MODEL = 'deepseek-chat';
export const FORCED_TEMPERATURE = 0.2;
export const MAX_COMPLETION_TOKENS = 1024;

// 請求體驗證上限：防止惡意夾帶超長內容耗用代管的 Deepseek 額度
// （系統指令含地點摘要 + 對話歷史最多 10 則，正常請求遠低於此上限）
export const MAX_MESSAGES = 60;
export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_TOTAL_CHARS = 60_000;

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

// 允許轉發的工具名單 — 必須與 src/copilot.js 的 TOOLS 保持同步。
// 不在名單內的工具定義一律拒絕，防止把代理當成任意 LLM API 使用。
export const ALLOWED_TOOL_NAMES = new Set([
  'get_dataset_overview',
  'search_locations',
  'search_therapists',
  'get_location_detail',
  'get_therapist_detail',
  'find_open_locations',
  'filter_category',
  'search_map',
  'select_location',
  'reset_filters',
]);

/**
 * 驗證前端傳入的 messages 陣列是否在合理範圍內。
 * @returns {string|null} 錯誤訊息（合法時回傳 null）
 */
export function validateMessages(body) {
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

/**
 * 驗證 tools 定義只包含白名單內的工具。
 * @returns {string|null} 錯誤訊息（合法時回傳 null）
 */
export function validateTools(tools) {
  if (tools == null) return null;
  if (!Array.isArray(tools)) return 'tools 必須為陣列';
  if (tools.length > ALLOWED_TOOL_NAMES.size) return 'tools 數量超過上限';
  for (const t of tools) {
    const name = t?.function?.name;
    if (t?.type !== 'function' || !name || !ALLOWED_TOOL_NAMES.has(name)) {
      return `不支援的工具定義：${name || '(未命名)'}`;
    }
  }
  return null;
}

/**
 * 淨化請求：驗證 messages 與 tools，並組出送往 Deepseek 的 payload。
 * model / temperature / max_tokens / stream 一律由本函式決定，
 * 前端傳入的同名欄位全部丟棄。
 *
 * @returns {{error: string}|{payload: Object}}
 */
export function sanitizeCopilotRequest(body) {
  const msgError = validateMessages(body);
  if (msgError) return { error: msgError };

  const toolsError = validateTools(body.tools);
  if (toolsError) return { error: toolsError };

  const payload = {
    model: FORCED_MODEL,
    messages: body.messages,
    temperature: FORCED_TEMPERATURE,
    max_tokens: MAX_COMPLETION_TOKENS,
    stream: false,
  };
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    payload.tools = body.tools;
    payload.tool_choice = 'auto';
  }
  return { payload };
}
