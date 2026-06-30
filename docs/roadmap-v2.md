# v2 升級藍圖：後端代理 Copilot

> **狀態**：規劃中（未實作）。本文記錄 v2 的設計決策與工作項，供未來執行參考。
> **背景**：1.0（純靜態）為了避免「使用者自己貼 API Key」的不合理體驗，**完全移除了 Copilot 功能**。v2 透過後端代理重新引入 Agent，讓使用者免 Key 即可使用。

---

## 1. 問題與目標

### 1.0 的限制
1.0 是純靜態 GitHub Pages 網站。若要加入 AI Agent（Deepseek），API Key 只能由**使用者自己提供**並存於瀏覽器 localStorage。對面向市民的公共服務而言，這體驗不合理：
- 一般市民不會去 Deepseek 開帳號、拿 Key
- Key 放瀏覽器有洩漏風險

### v2 目標
引入**後端代理**代管 Deepseek Key，使用者**什麼都不用貼**即可使用 AI 智能助理。

---

## 2. 架構：薄代理（已選定）

從「純靜態 GitHub Pages」→「Vercel 靜態前端 + 薄代理 serverless function」。

```
瀏覽器 ──(messages + tools 定義)──▶ /api/copilot
                                       │ 代入 Key（後端環境變數 DEEPSEEK_API_KEY）
                                       ▼
                                   Deepseek API
瀏覽器 ◀──(Deepseek 原始回應, 含 tool_calls)─── /api/copilot
  │
  └─ 瀏覽器本地執行 dispatchTool(database)  [data.json 仍載前端]
```

### 為何選薄代理（而非完整後端 Agent）

| 方案 | 後端職責 | 複雜度 | 取捨 |
|------|---------|--------|------|
| **薄代理（v2 採用）** | 只代轉請求 + 代管 Key | 最低（~40 行無狀態） | loop/工具/資料查詢仍在瀏覽器；data.json 載前端 |
| 完整後端 Agent | loop + 資料查詢全移後端 | 最高（~200 行） | 瀏覽器只收 `{reply, actions}`；最安全但複雜 |

- **最快上線**、後端最薄（無狀態、不管資料）
- `data.json` 是**公開官方資料**（衛生局註冊名冊），無隱私問題，留在前端合理
- 若未來 token 成本或延遲成問題，可升級為「完整後端 Agent」

---

## 3. v2 主要工作項

1. **後端代理**
   - 新增 `api/copilot.js`（Vercel Functions）：接收前端請求 → 代入 `DEEPSEEK_API_KEY` 環境變數 → 轉發至 Deepseek → 回傳原始回應。無狀態、不存資料。
   - 新增 `vercel.json`（框架/路由設定）
   - 在 Vercel 後台設定環境變數 `DEEPSEEK_API_KEY`

2. **前端 Copilot 重生**
   - 新增 `src/copilot.js`（恢復 agent loop + 9 個工具 + dispatchTool）
   - **移除「自貼 Key」設定面板**，改為：偵測自家 `/api/copilot` 端點可用時直接啟用 Agent（免 Key）
   - 保留「自帶 Key」為進階選項（直連 Deepseek，不經代理）
   - `getSystemInstruction()`：移除硬編碼統計（90/41/108），改動態讀 `database.meta.stats`

3. **部署平台遷移**
   - GitHub Pages → Vercel（支援 serverless functions）
   - 保留 `.github/workflows/deploy.yml` 作 fallback

4. **文件**
   - 重新撰寫 `docs/agent.md`（涵蓋薄代理架構 + 工具 schema）
   - 重新撰寫 `docs/memory.md`（短期記憶 + 後端 Key 管理）

---

## 4. 與 AGENTS.md 原則的關係

v2 需**放寬** `AGENTS.md`「不做（YAGNI）」區塊的「後端伺服器」原則，但**僅限於無狀態薄代理**：
- ✅ 允許：Vercel serverless function 代管 API Key（無狀態、無資料庫）
- ❌ 仍不做：資料庫、使用者帳號、評分評論、離線推播

其餘倫理邊界（不做評分、免責聲明、資料透明）在 v2 完全維持不變。

---

## 5. 風險與緩解

| 風險 | 緩解 |
|------|------|
| 共享 Key 被濫用導致額度耗盡 | 後端加速率限制（如每 IP 每分鐘 N 次）；Vercel 函數設 `maxDuration` |
| Deepseek 服務中斷 | 保留本地規則引擎（`parseLocalAgent`）作 fallback |
| 代理函數冷啟動延遲 | Vercel 預設無冷啟動問題（Edge/Node 函數）；監控回應時間 |
