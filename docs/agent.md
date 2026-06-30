# Copilot 智能助理 (Agent) v2 架構說明

本專案 v2 實現了一個**後端薄代理 + 瀏覽器端 Agentic 迴圈**的 AI 智能助理。核心目標：**使用者免設定任何 API Key 即可使用**。

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

**職責分工：**
| 角色 | 職責 |
|------|------|
| **後端 `/api/copilot`** | 無狀態。只代管 Key、轉發請求、回傳原始回應。不做 loop、不存資料。 |
| **瀏覽器 `copilot.js`** | 執行 agent loop、執行工具、查詢本地 `database`、操控 UI。 |

### 🔧 兩種模式
1. **預設（免 Key）**：瀏覽器 POST 到自家 `/api/copilot`，後端代管 Key。**多數使用者用此模式**。
2. **進階（自帶 Key）**：使用者在設定面板填入自己的 Deepseek Key，瀏覽器直連 `api.deepseek.com`，不經代理。

### 🛡️ 防濫用
後端 `/api/copilot` 內建速率限制：每 IP 每 60 秒最多 20 次請求。

---

## 2. 助理可執行的工具（9 個）

Deepseek 原生函數調用共定義 **9 個工具**，分兩類：

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

## 3. 本機開發 vs 正式部署

| | 本機 (`npm run dev`) | 正式部署 (Vercel) |
|---|---|---|
| `/api/copilot` 由誰提供 | Vite dev server middleware（讀本機 `.env` 的 `DEEPSEEK_API_KEY`） | Vercel serverless function（讀後台環境變數） |
| 行為 | 完全相同 — 代管 Key、轉發 Deepseek | 完全相同 |
| 設定方式 | 專案根目錄 `.env`（不入版控） | Vercel 後台 Environment Variables |
