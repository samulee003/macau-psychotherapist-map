# Copilot 智能助理 (Agent) v2 架構說明

本專案 v2 實現了一個**後端薄代理 + 瀏覽器端 Agentic 迴圈**的 AI 智能助理。核心目標：**使用者免設定任何 API Key 即可使用**。

> **與 v1 的關鍵差異**：v1 採用純前端架構，使用者必須自行到 Deepseek 開帳號、取得 API Key 並貼入瀏覽器設定面板。這對面向市民的公共服務而言體驗不合理，且有 Key 暴露於瀏覽器的安全疑慮。v2 透過後端薄代理徹底解決此問題。

---

## 1. 設計模式

### 🔁 薄代理 + 瀏覽器 Agentic 迴圈

```
瀏覽器 ──(messages + tools 定義)──▶ /api/copilot  [自家 serverless]
                                       │ 代入 DEEPSEEK_API_KEY（後端環境變數）
                                       ▼
                                   Deepseek API
瀏覽器 ◀──(原始回應, 含 tool_calls)─── /api/copilot
  │
  └─ 瀏覽器本地執行 dispatchTool(database)  [data.json 仍載前端]
       │
       ├─ 工具結果以 role=tool 回填 messages
       └─ 再次 POST /api/copilot（最多 6 輪）
```

### 職責分工

| 角色 | 職責 | 不做 |
|------|------|------|
| **後端 `/api/copilot`** | 代管 Key、轉發請求、回傳原始回應、速率限制 | 不做 loop、不存資料、不存狀態 |
| **瀏覽器 `copilot.js`** | 執行 agent loop、執行工具、查詢本地 `database`、操控 UI | 不持有伺服器 Key（除非進階自帶模式） |

**為何如此分工？**
- `data.json` 是**公開官方資料**（衛生局註冊名冊），無隱私問題，留在前端合理，且能複用 1.0 已建好的本地索引（`data-loader.js`）。
- 後端維持**無狀態**，易維護、易擴展，符合 AGENTS.md「不做後端伺服器／資料庫」原則的放寬（僅限無狀態薄代理）。
- Token 消耗與「完整後端 Agent」相近，但換來後端零狀態。

### 🔧 兩種使用模式

| 模式 | 端點 | 何時用 | Key 位置 |
|------|------|--------|---------|
| **預設（免 Key）** | `/api/copilot`（自家代理） | 多數使用者 | 後端環境變數，前端不可見 |
| **進階（自帶 Key）** | `api.deepseek.com/v1/chat/completions`（直連） | 進階使用者、避免共用額度 | 瀏覽器 localStorage |

兩種模式共用同一個 agent loop 與工具集，差別僅在 HTTP 端點與 Authorization header。

---

## 2. 助理可執行的工具（9 個）

Deepseek 原生函數調用（Native Function Calling）共定義 **9 個工具**，分兩類：

### 📖 資料查詢工具（回傳資料給 LLM 觀察，不操控 UI）

| 工具名稱 | 參數 | 行為 |
| :--- | :--- | :--- |
| **`get_dataset_overview`** | （無） | 統計概覽：治療師數、地點數、各分類數、執業關聯數、採集日期。 |
| **`search_locations`** | `keyword` | 搜尋地點（比對名稱+地址），回傳 id/名稱/地址/分類。 |
| **`search_therapists`** | `keyword` | 搜尋治療師（中文/外文姓名+牌照號），回傳符合者及執業地點。 |
| **`get_location_detail`** | `location_id` | 地點完整資訊：電話、診症時間、分類、駐點治療師清單。 |
| **`get_therapist_detail`** | `therapist_id` | 治療師完整資訊：姓名、牌照號、所有執業地點。 |

### 🖱️ UI 行動工具（收集成 actions，迴圈結束後執行）

| 工具名稱 | 參數 | 行為 |
| :--- | :--- | :--- |
| **`filter_category`** | `category` | 篩選分類，高亮 Chip。 |
| **`search_map`** | `query` | 填入搜尋欄，模糊過濾。 |
| **`select_location`** | `location_id` | 地圖飛越 + 開啟詳情面板。 |
| **`reset_filters`** | （無） | 清除篩選，重置地圖。 |

---

## 3. Agentic 迴圈流程（`runDeepseekAgentLoop`）

```
使用者訊息
   │
   ▼
┌─────────────────────────────────────┐
│ 組裝 messages                        │
│ （system instruction + 記憶 + 問題） │
└────────────────┬────────────────────┘
                 │
        ┌────────▼─────────┐
        │ POST /api/copilot │◀──────────┐
        │  (帶 tools 定義)  │            │
        └────────┬─────────┘            │
                 │                       │
         ┌───────▼────────┐  有 tool_calls  │
         │回應含 tool_calls?├───────────────┤
         └───────┬────────┘                │
            否    │ 是                       │
         ┌───────▼────────┐   ┌────────────┴──────────┐
         │ 最終回覆 reply  │   │ 逐一執行工具           │
         │ + 收集的 actions │   │ 查詢類→回傳資料        │
         │ → 結束          │   │ UI 類→收集 action      │
         └────────────────┘   │ 結果回填 role=tool     │
                               └────────────┬──────────┘
                                            │ 回到 POST（最多 6 輪）
```

**防護機制**：`MAX_STEPS = 6`，防止 LLM 無限呼叫工具。超過步數則回傳已收集的 actions + 提示訊息。

### 實測驗證
以「地圖上有多少位心理治療師？」測試，Deepseek 正確回傳：
```json
{
  "finish_reason": "tool_calls",
  "message": {
    "content": "好的，我來查詢一下資料庫的統計概覽。",
    "tool_calls": [{
      "function": { "name": "get_dataset_overview", "arguments": "{}" }
    }]
  }
}
```
證明 LLM 不會亂猜數字，而是主動呼叫工具查真實資料後再回答。

---

## 4. 本機開發 vs 正式部署

| | 本機 (`npm run dev`) | 正式部署 (Vercel) |
|---|---|---|
| `/api/copilot` 由誰提供 | Vite dev server middleware（讀本機 `.env`） | Vercel serverless function（讀後台環境變數） |
| 行為 | **完全相同** — 代管 Key、轉發 Deepseek | **完全相同** |
| 設定方式 | 專案根目錄 `.env`（不入版控） | Vercel 後台 Environment Variables |

這個設計確保「本機開發體驗」與「正式部署」完全一致，開發者無需另起後端服務。

---

## 5. 防濫用機制

後端 `/api/copilot` 內建：
- **速率限制**：每 IP 每 60 秒最多 20 次請求，超過回 HTTP 429。
- **方法限制**：僅接受 POST，其餘回 HTTP 405。
- **Key 不可見**：`DEEPSEEK_API_KEY` 環境變數只在 serverless function 內部使用，絕不回傳前端。

---

## 6. 錯誤處理

| 情境 | HTTP | 前端行為 |
|------|------|---------|
| 未設定伺服器 Key | 500 | 顯示「AI 服務暫時無法使用」提示 |
| 速率超限 | 429 | 同上 |
| Deepseek 認證失敗 | 401 | 同上 |
| Deepseek 連線失敗 | 502 | 同上 |
| 任何錯誤 | — | **地圖搜尋/篩選/詳情功能不受影響**，僅 AI 助理失效 |
