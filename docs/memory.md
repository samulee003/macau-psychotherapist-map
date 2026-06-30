# Copilot 智能助理記憶體管理 (Memory) 說明

本專案之智能助理 (Copilot) 具備「短期對話上下文記憶」與「長期本地配置持久化」兩大記憶體機制，本文件說明其具體實現細節。

---

## 1. 短期記憶 (Short-term / Contextual Memory)

短期記憶主要負責維持**對話上下文的連貫性**。例如，當使用者先後提問：
> User: 「鏡湖醫院在哪裡？」  
> User: 「那**它**的電話是多少？」

如果沒有短期記憶，助理在第二個輪次將會遺失對主體「鏡湖醫院」的追蹤。

### ⚙️ 技術實現與 Payload 格式化
我們在客戶端維護了一個 `chatHistory` 數組。每次成功對答後，都會將當前輪次的問答結果寫入該記憶庫：

1. **Gemini API (`contents` 歷史記錄格式)**：
   我們將本地的 `chatHistory` 映射成 Gemini 官方要求的 alternating role（交替角色）數組：
   ```json
   [
     { "role": "user", "parts": [{ "text": "幫我找鏡湖醫院" }] },
     { "role": "model", "parts": [{ "text": "{\"reply\":\"已定位至鏡湖醫院。\",\"actions\":[{\"type\":\"select_location\",\"value\":\"loc_jh\"}]}" }] }
   ]
   ```
2. **Deepseek / OpenAI API (`messages` 歷史記錄格式)**：
   格式化為 OpenAI 標準的 chat messages 結構：
   ```json
   [
     { "role": "system", "content": "System instructions..." },
     { "role": "user", "content": "幫我找鏡湖醫院" },
     { "role": "assistant", "content": "{\"reply\":\"已定位至鏡湖醫院。\",\"actions\":[{\"type\":\"select_location\",\"value\":\"loc_jh\"}]}" }
   ]
   ```

### 🧽 記憶容量管理 (Sliding Window & Clear Memory)
- **滾動窗口 (Sliding Window)**：為防止對話歷史過長導致上下文視窗過載、產生高昂的 API Token 消耗或響應延遲，我們將記憶深度上限設定為 **10 條訊息 (5 個完整的問答輪次)**，超出部分會自動被 `shift()` 從頭部移除。
- **一鍵重置 (🗑️ 垃圾桶按鈕)**：對話面板右上角設有 `🗑️` 按鈕，點擊後會立即執行 `chatHistory = []`，完全重置助理的情境記憶。用戶在對話框中輸入「重置」、「清除對話」等關鍵字也會觸發相同的清空操作。

---

## 2. 長期記憶 (Long-term / Persistent Memory)

長期記憶主要負責儲存**使用者偏好設置與認證金鑰**。

### 🔒 瀏覽器本地存儲 (Client-Side LocalStorage)
本專案採用純靜態無後端架構，為確保用戶隱私與金鑰安全，所有設定（AI 服務商、API 金鑰、自訂端點及模型）均僅保存在瀏覽器本地的 `localStorage` 中：

- `copilot_provider`
- `copilot_api_key`
- `copilot_base_url`
- `copilot_model`

每次打開頁面或初始化 Copilot 時，代碼會自動讀取上述欄位。**金鑰只會在瀏覽器中發起對 AI 官方 API 的 HTTPS 請求時使用，絕不上傳至任何第三方伺服器**。

### 🚫 安全合規防範
為了防止 API 金鑰洩漏，本項目在代碼層面：
- 禁止將任何真實的 API 金鑰硬編碼在代碼或配置文件中。
- `.gitignore` 已排除一切包含私密環境變量的 `.env` 文件。
- 金鑰輸入框在網頁端被設置為 `<input type="password">`，防止日常屏幕展示或調試時被截圖洩露。
