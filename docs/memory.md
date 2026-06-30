# Copilot 記憶體管理 (Memory) v2 說明

---

## 1. 短期記憶 (Short-term / Contextual Memory)

維持**對話上下文連貫性**。例如：
> User: 「鏡湖醫院在哪裡？」
> User: 「那**它**的電話是多少？」

瀏覽器端維護 `chatHistory` 陣列，每次成功對答後寫入當前輪次。

### ⚙️ Payload 格式
作為 `messages` 陣列送至 `/api/copilot`（Deepseek 標準格式）：
```json
[
  { "role": "system", "content": "System instructions..." },
  { "role": "user", "content": "幫我找鏡湖醫院" },
  { "role": "assistant", "content": "已定位至鏡湖醫院。" }
]
```
**註**：記憶只存純文字 `reply`，不存原始 JSON 或 tool_calls 中間過程，避免膨脹。

### 🧽 容量管理
- **滾動窗口**：上限 **10 條訊息（5 個問答輪次）**，超出自動 `shift()`。
- **一鍵重置**：🗑️ 按鈕或輸入「重置」「清除對話」即清空 `chatHistory`。

---

## 2. 長期記憶 (Long-term / Persistent Memory)

儲存**使用者偏好**於瀏覽器 `localStorage`：

| Key | 用途 |
|-----|------|
| `copilot_use_own_key` | 是否使用自帶 Key 模式（`'true'`/`'false'`） |
| `copilot_api_key` | 自帶的 Deepseek Key（僅進階模式用） |
| `copilot_model` | 自訂模型名稱 |

### 🔒 安全設計（v2 改進）
- **預設模式完全不需要 Key** — 多數使用者 localStorage 不會存任何金鑰。
- 自帶 Key 模式下，Key 僅在瀏覽器發起直連 Deepseek 時使用，**不經任何第三方**。
- Key 輸入框為 `<input type="password">`，防截圖洩露。
- **站台伺服器的 `DEEPSEEK_API_KEY` 環境變數絕不暴露給前端** — 只在後端 serverless function 內部使用。
