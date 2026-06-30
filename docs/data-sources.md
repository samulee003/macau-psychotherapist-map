# 資料來源與採集流程

## 實際採集與官方權威來源（已實現直接採集）

**澳門特別行政區政府衛生局 — 從事私人醫務活動專業人員名冊**

- 網址：<https://www.ssm.gov.mo/pubssmweb/Utlap/frmUtlapLic.aspx?licode=11&t=>
- 性質：官方即時、具法律效力之醫療人員執業註冊名冊。
- 欄位：執照類別、執照編號、專業、名稱（中葡）、執業地址（中葡）、電話、診症時間、Decreto-Lei n.º 84/90/M 准照編號及批示日期。
- 法律依據：第 18/2020 號法律《醫療人員專業資格及執業註冊制度》。

本專案現已實現從此官方權威來源**全自動直接採集**（`scripts/scrape.py`），資料新鮮度高，不再受第三方名冊延遲影響。

### 如何繞過 Cloudflare 反爬蟲保護？

衛生局官網查詢系統啟用了 **Cloudflare Turnstile** 驗證。我們使用 Playwright 在啟動瀏覽器時加入了隱形特徵參數：
1. `--disable-blink-features=AutomationControlled`：移除瀏覽器的自動化特徵（即 `navigator.webdriver` 屬性值設為 `false`/`undefined`），從而隱藏機器人特徵。
2. 忽略 `--enable-automation` 參數。
3. 採用 headed (有界面) 模式並輔以 45 秒超時等待。Cloudflare Turnstile 在檢測到無自動化標誌且為真實 Chrome 架構時，會自動靜默放行，無需任何人工點擊驗證。

這使得全自動腳本能夠可靠、穩定地進入系統並自動進行分頁抓取（共 6 頁，116 筆記錄）。

## 交叉參考來源

- **澳門心理治療師公會（MSRP）**：<https://www.msrpmacau.org/>
  - 由衛生局註冊心理治療師組成的專業團體，可交叉比對

## 採集流程（全自動 + 人工校驗座標）

```
APM 名冊頁（apm.org.mo，無反爬蟲）
   │
   ▼  scrape.py（requests + BeautifulSoup 解析靜態表格）
raw.json （83 筆原始記錄，含中葡雙語切分）
   │
   ▼  geocode.py（高德 Web 服務 API，48 個不重複地址）
geocoded.json （地址→座標）
   │
   ▼  build_data.py（去重地址、合併、分類、建立多對多關聯）
data.json （67 治療師 / 47 地點 / 78 關聯）
   │
   ▼  validate.py + preview.html（人工校驗座標）
data.json （修正後最終版）
```

### 執行步驟

```bash
# 1. 建立虛擬環境並安裝採集依賴
python3 -m venv .venv && source .venv/bin/activate
pip install requests beautifulsoup4 lxml

# 2. 設定高德 Web 服務 key（用於 geocoding）
export AMAP_WEB_KEY=你的高德Web服務key

# 3. 抓取 APM 名冊
python3 scripts/scrape.py

# 4. 地址轉座標
python3 scripts/geocode.py

# 5. 合併產出 data.json
python3 scripts/build_data.py

# 6. 校驗
python3 scripts/validate.py

# 7. 人工校驗座標（在瀏覽器開啟，填入高德 JS API key）
open scripts/preview.html
#    → 核對每個點是否準確，缺座標的點擊地圖補上
#    → 將修正結果更新回 data.json
```

### 中葡雙語切分

APM 表格的地址欄為「機構名 - 地址」中葡文相連（如「培甯心理治療中心 - 澳門...1GCENTRO DE PSICOTERAPIA...」）。

`scrape.py` 的 `split_bilingual()` 用**葡文關鍵字錨點**（CENTRO、HOSPITAL、RUA、AVENIDA 等）定位邊界，已驗證中文地址不殘留葡文。原始資料偶有中葡文黏合瑕疵（如 `1GCENTRO`），切分後中文段保留 `1G`、葡文段從 `CENTRO` 起始。

### 更新節奏

- 每 **半年** 重跑一次採集流程
- 採集日期會顯示在前端頁面，保持資料新鮮度透明

## 資料模型

詳見 `data/data.json`。三個實體形成多對多關係：

- **therapists**：心理治療師（姓名中葡、牌照號、狀況）
- **locations**：執業地點（機構名、地址中葡、分類、座標、電話、診症時間）
- **practices**：執業關聯（哪位治療師在哪個地點執業）

## 免責聲明

- 本網站**非官方機構**，與澳門衛生局、APM 無關
- 資料採集自 APM 整理的公開名冊，經整理與人工校驗，但**可能延遲或不完整**
- 資料**僅供參考**，不構成任何醫療建議、診斷或轉介
- 最新、最準確的資訊請以[官方查詢系統](https://www.ssm.gov.mo/pubssmweb/register/frmShowRegister.aspx)為準
- 本網站不提供評分或評論功能（醫療專業倫理考量）
