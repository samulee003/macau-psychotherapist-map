# Copilot 記憶體管理 (Memory) v2 說明

v2 的記憶體管理分為「短期對話記憶」與「長期偏好持久化」兩層，並在 v1 基礎上做了安全強化（多數使用者不再需要儲存任何 API Key）。

---

## 1. 短期記憶 (Short-term / Contextual Memory)

維持**對話上下文連貫性**。例如：
> User: 「鏡湖醫院在哪裡？」
> User: 「那**它**的電話是多少？」

若無短期記憶，助理在第二輪會遺失對「鏡湖醫院」這個主體的追蹤。

### ⚙️ 實作與 Payload 格式

瀏覽器端維護 `chatHistory` 陣列。每次成功對答後寫入當前輪次，並在下次請求時映射成 Deepseek 標準 `messages` 格式送至 `/api/copilot`：

```json
[
  { "role": "system", "content": "System instruction..." },
  { "role": "user", "content": "幫我找鏡湖醫院" },
  { "role": "assistant", "content": "已定位至鏡湖醫院。" }
]
```

### v2 的記憶內容簡化（重要改進）

記憶**只存純文字 `reply`**，不存：
- ❌ 原始 JSON 回應（v1 會存整個 `{reply, actions}` JSON，造成記憶膨脹）
- ❌ `tool_calls` 中間過程（agent loop 的工具呼叫/結果只在當次請求的 `messages` 陣列內流動，不寫入長期記憶）

這讓記憶更精簡、Token 消耗更低，且跨輪次的上下文依然清晰。

### 🧽 容量管理

- **滾動窗口（Sliding Window）**：上限 **10 條訊息（5 個完整問答輪次）**，超出自動從頭部 `shift()` 移除，防止 Token 溢出與 API 成本失控。
- **一鍵重置**：
  - 對話面板右上角 🗑️ 按鈕 → 立即 `chatHistory = []`。
  - 在對話框輸入「重置」「清除對話」「還原」等關鍵字也會觸發清空。

---

## 2. 長期記憶 (Long-term / Persistent Memory)

儲存**使用者偏好**於瀏覽器 `localStorage`：

| Key | 用途 | 預設值 |
|-----|------|--------|
| `copilot_use_own_key` | 是否使用「自帶 Key」模式（`'true'`/`'false'`） | `'false'` |
| `copilot_api_key` | 自帶的 Deepseek Key（僅進階模式用） | `''`（空） |
| `copilot_model` | 自訂模型名稱 | `''`（用預設 `deepseek-chat`） |

### 🔒 v2 安全設計改進

| 面向 | v1（純前端） | v2（薄代理） |
|------|-------------|-------------|
| 多數使用者的 localStorage | 必存 API Key | **完全不存任何 Key** |
| Key 暴露面 | 每個使用者瀏覽器都有 Key | 僅伺服器環境變數有 Key，前端不可見 |
| 自帶 Key 模式 | 唯一模式 | 進階選用，預設關閉 |

### 自帶 Key 模式的安全保證（進階使用者）
即便使用者選擇自帶 Key：
- Key 僅在瀏覽器發起**直連 Deepseek** 時使用，**不經任何第三方伺服器**（不經自家 `/api/copilot`）。
- Key 輸入框為 `<input type="password">`，防日常展示或截圖洩露。
- **站台伺服器的 `DEEPSEEK_API_KEY` 環境變數絕不暴露給前端** — 只在 serverless function 內部使用，前端無法讀取。

---

## 3. 環境變數管理（開發者視角）

| 環境 | 變數來源 | 是否入版控 |
|------|---------|-----------|
| 本機開發 | 專案根目錄 `.env`（`DEEPSEEK_API_KEY=...`） | ❌ 不入（`.gitignore` 已排除 `.env*`） |
| 正式部署 | Vercel 後台 Environment Variables | ❌ 不入（Vercel 後台管理） |
| 範本 | `.env.example`（無真實 Key，僅供參考） | ✅ 入版控 |

**絕對原則**：真實的 Deepseek API Key **絕不**寫入任何程式碼、設定檔或 commit。
