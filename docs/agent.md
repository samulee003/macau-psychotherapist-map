# Copilot 智能助理 (Agent) 設計架構說明

本專案實現了一個結合「本地離線規則引擎」與「雲端大語言模型 (LLM) 函數調用 (Tool Calling)」的混合型 AI 智能助理 (Copilot)。本文件說明其設計模式與架構。

---

## 1. 代理設計模式 (Agentic Design Patterns)

本助理之實現參考了業界常見的代理設計模式（如 *Routing* 與 *Tool Use*）：

### 💡 智能路由 (Routing)
助理在接收使用者輸入後，會經過路由模組決定後續的操作路徑：
- **無金鑰模式**：自動路由至**本地輕量規則引擎**，通過 regex 與關鍵字匹配快速做出反應。
- **有金鑰模式**：根據用戶選擇的 AI 服務商（Gemini / Deepseek / OpenAI 相容端點），將請求路由至對應的雲端模型。

### 🛠️ 函數調用 (Tool Calling / Action Dispatching)
大模型本身無法直接修改瀏覽器頁面或操縱地圖。我們通過設定嚴格的 System Instruction，強制 LLM 以 **Structured JSON Mode** 回傳，輸出特定的「指令 (Action)」數組，再由前端動態解析並執行。

---

## 2. 助理可執行的工具 (Tools Schema)

助理回傳的 JSON 結構中，`actions` 欄位可包含一或多個以下指令，前端會依序執行：

| 指令類型 (`type`) | 參數值 (`value`) | 前端執行行為 (Action Handler) |
| :--- | :--- | :--- |
| **`filter_category`** | `hospital` \| `med_center` \| `psych_center` \| `social` \| `university` \| `gov` \| `all` | 過濾特定的機構分類，並在 UI 上高亮顯示對應的 Chip。 |
| **`search`** | 搜尋關鍵字字串 | 程式化填入搜尋欄位，並對機構名稱、地址、治療師姓名進行模糊過濾。 |
| **`select_location`** | 地點 ID (如 `loc_189fe1c5`) | 地圖自動平滑飛越至該座標，並開啟左側（行動端為下方）詳細資訊面板。 |
| **`reset`** | `true` | 清除所有搜尋字詞與分類，重置地圖視角，還原全部打點。 |

### 回傳 JSON 範例：
當使用者問：「*幫我找培甯*」：
```json
{
  "reply": "已為您在地圖上找到「培甯心理治療中心」，並已打開詳細資料卡片！",
  "actions": [
    { "type": "select_location", "value": "loc_189fe1c5" }
  ]
}
```

---

## 3. 多服務商對接架構 (Multi-Provider Support)

我們抽象化了 API 請求發送邏輯，支援以下服務商：

1. **Google Gemini API** (`gemini-1.5-flash`)
   - 請求端點：`generativelanguage.googleapis.com` (v1beta)
   - 使用 `systemInstruction` 提供上下文。
   - 使用 `generationConfig.responseMimeType = "application/json"` 強制 JSON 輸出。
2. **Deepseek API** (`deepseek-chat`)
   - 請求端點：`api.deepseek.com/chat/completions`
   - 相容 OpenAI 格式，並開啟 `response_format: { type: "json_object" }` 確保 JSON 的輸出格式。
3. **OpenAI 相容端點**
   - 支援自訂 Base URL 及 Model Name，便於對接國內外第三方中轉站（OpenRouter, SiliconFlow 等）。
