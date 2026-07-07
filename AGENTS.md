# AGENTS.md

本檔案為 AI 代理（如 ZCode、Claude Code、Antigravity 等）提供本專案的工作指引。
修改程式碼前請先閱讀本檔，遵循其中的結構與約定。

## 專案概要

**澳門註冊心理治療師執業地址分布地圖** — 一個純靜態網頁應用，在地圖上展示澳門註冊心理治療師的執業地點分布，幫助市民查找心理治療資源。

- **資料來源**：澳門特別行政區政府衛生局 — 從事私人醫務活動專業人員名冊（`https://www.ssm.gov.mo/pubssmweb/Utlap/frmUtlapLic.aspx?licode=11&t=`）
- **官方首頁**：澳門衛生局官網首頁（`https://www.ssm.gov.mo/`）
- **資料性質**：官方公開註冊資訊（非個人隱私），全自動採集 + 人工校驗座標
- **規模**：90 位治療師、41 個執業地點、108 個執業關聯（多對多關係）
- **透明度**：UI 頁尾標註來源連結「澳門衛生局」（指向首頁）及採集日期，無任何項目官方背書歧義。

## 技術棧

| 層 | 技術 |
|----|------|
| 前端 | Vite + 原生 JavaScript（ES Modules，**不用框架**） |
| 地圖 | MapLibre GL JS + OSM/CARTO 光柵底圖（**免 key、WGS-84**；資料座標為 GCJ-02，顯示前經 `geo.js` 轉換） |
| 樣式 | 手寫 CSS（響應式、手機優先，融入玻璃擬態磨砂視覺） |
| 資料 | 靜態 JSON（`data/data.json`） |
| 採集 | Python 3 + Playwright Stealth（分頁抓取官方衛生局網頁） |
| 部署 | 純靜態（GitHub Pages / Vercel） |

## 目錄結構

```
├── index.html              # 單頁應用入口
├── vite.config.js          # Vite 設定（closeBundle 複製 data/；dev 代理與正式版共用淨化邏輯）
├── src/                    # 前端原始碼（ES Modules）
│   ├── config.js           # 機構分類定義、地圖初始視角（單一真相來源）
│   ├── i18n.js             # 三語字典（繁中/葡/英）+ t()/setLang/applyI18nDom
│   ├── data-loader.js      # 載入 data.json + 建立雙向查詢索引
│   ├── map.js              # MapLibre 地圖渲染、marker、資訊窗、使用者定位點
│   ├── search.js           # 搜尋、分類篩選、時段篩選（現在營業/週末/夜間）
│   ├── hours.js            # 診症時間結構化解析（hours 文字 → 可計算時段）
│   ├── geo.js              # 距離計算 + GCJ-02↔WGS-84 座標轉換
│   ├── detail.js           # 詳情抽屜面板（含分享深連結、營業狀態）
│   ├── copilot.js          # AI 智能助理（agent loop + 10 個工具）
│   ├── main.js             # 入口，串接所有模組 + 深連結 + SW 註冊
│   └── styles.css
├── lib/copilot-proxy.js    # 代理共用邏輯：請求驗證/淨化（api/ 與 vite dev 共用）
├── api/copilot.js          # Vercel serverless 薄代理（代管 DEEPSEEK_API_KEY）
├── public/                 # 靜態資源（Vite 原樣複製到 dist/ 根目錄）
│   ├── manifest.webmanifest # PWA manifest
│   ├── sw.js               # Service Worker（stale-while-revalidate 離線快取）
│   └── icon.svg            # 應用圖示
├── tests/                  # Vitest 單元測試（hours/geo/data-loader/copilot-proxy）
├── data/data.json          # 治療師 + 地點 + 執業關聯（採集產出）
├── scripts/                # Python 採集腳本（不在前端運行）
│   ├── scrape.py           # Playwright Stealth 模擬瀏覽器抓取衛生局官網 → raw.json
│   ├── geocode.py          # 地址→座標（高德 Web 服務） → geocoded.json
│   ├── build_data.py       # 去重/合併/分類 → data/data.json
│   ├── validate.py         # 資料完整性校驗（支援 --baseline 漂移守衛）
│   └── preview.html        # 座標人工校驗頁（獨立，不依賴 Vite）
└── docs/data-sources.md    # 資料來源與採集流程說明
```

注意：`scripts/raw.json` 與 `scripts/geocoded.json` 是採集中間產物，已加入 `.gitignore`，不會進版控。

## 常用命令

```bash
# 前端開發
npm install
npm run dev          # 本地 dev server (http://localhost:5173)
npm run build        # 產出 dist/（含自動複製的 data/data.json）
npm run preview      # 預覽 build 結果
npm test             # Vitest 單元測試（hours/geo/data-loader/copilot-proxy）

# 資料採集（用虛擬環境）
python3 -m venv .venv && source .venv/bin/activate
pip install requests beautifulsoup4 lxml
export AMAP_WEB_KEY=你的高德Web服務key      # geocoding 用
python3 scripts/scrape.py        # 從 APM 名冊抓取 → raw.json
python3 scripts/geocode.py       # 地址→座標 → geocoded.json
python3 scripts/build_data.py    # 去重/合併/分類 → data/data.json
python3 scripts/validate.py      # 資料校驗
open scripts/preview.html        # 人工校驗座標
```

## 資料模型（核心）

`data/data.json` 含三個實體，形成**多對多**關係：

- **therapists**：`id`（由牌照號派生）、`licenseNo`、`nameZh`、`nameEn`、`status`
- **locations**：`id`（由地址 hash 派生）、`name`、`addressZh`、`category`、`lng`/`lat`、`phone`、`hours`
- **practices**：`therapistId` + `locationId`（執業關聯）

一位治療師可在多地點執業；一個地點可有多位治療師。

`meta` 區塊記錄來源資訊（`source`、`sourceUrl`、`officialSource`、`officialSourceUrl`、`collectedAt`、`note`），前端頁尾**動態讀取**這些欄位顯示（見 main.js）。修改來源時只需改採集腳本的 `_meta`，前端自動跟著走。

## 機構分類（單一真相來源）

分類定義在 `src/config.js` 的 `CATEGORIES`，**這是前端唯一來源**。marker 配色、篩選 chip、詳情標籤都從這裡讀。

| key | 中文 | 色 |
|-----|------|----|
| hospital | 醫院 | `#d64545` |
| med_center | 醫療中心 | `#e8893a` |
| psych_center | 心理治療中心 | `#2c6e7f` |
| social | 社會服務機構 | `#5b8c5a` |
| university | 大學 | `#7a5ca0` |
| gov | 政府機構 | `#6b7280` |
| other | 其他 | `#9ca3af` |

採集時自動分類的規則在 `scripts/build_data.py` 的 `CATEGORY_RULES`（依機構名關鍵字，順序重要）。目前「其他」歸零，47 個地點全數精準歸類。

## 開發約定

### 前端
- **ES Modules**：所有 `src/*.js` 使用 `import`/`export`，不引入框架。
- **單一真相原則**：分類、配色、地圖視角集中在 `config.js`。
- **地圖視角**：以「地點」為主（marker = location，點擊展開此地點的治療師）。
- **HTML 跳脫**：所有從資料渲染到 DOM 的字串必須 `escapeHtml()`（各模組內已有此函式）。
- **檔案職責單一**：`map.js` 只管地圖、`search.js` 只管篩選、`detail.js` 只管詳情。
- **行動端上下分屏設計**：在寬度小於或等於 `768px` 時，桌面版側欄 `.sidebar` 完全隱藏（`display:none`），改為「地圖固定上半屏（預設 40vh）+ 列表常駐下半屏」的分屏佈局。兩者同時可見、永不互相遮擋。中間有 `.split-handle` 拖曳把手，支援 mouse + touch 調整比例（限制 25%~70%）。
- **行動端專屬 DOM**：手機版有獨立的 `#mobile-panel`（含 `#mobile-search-input`、`#mobile-filters`、`#mobile-location-list`），與桌面版側欄（`#location-list` 等）並存但互不影響。`main.js` 的 `renderAll()` 同時渲染兩套列表，`setActiveListItem` / `setActiveMobileListItem` 互相同步 active 狀態。
- **行動端 AI 浮動按鈕**：AI 助理改為 `.ai-fab` 浮動按鈕（右下角）→ 點擊開啟 `.ai-overlay` 全螢幕覆蓋層。
- **行動端分類滑動**：手機版分類標籤設為單行橫向滑動（`.mobile-filters`），採「單選」模式。

### 🚨 去 Slop 與 Emoji 絕對禁令 (Design Taste Guidelines)
- **UI 與 AI 絕對禁止裝飾性 Emoji**：除了使用者主動要求的特定情境，UI 界面（`index.html` 卡片、詳情抽屜、頁尾）以及 AI Copilot 回覆中**絕對禁止使用任何表情符號 (Emoji)**。AI 助理必須以乾淨專業的 Markdown 和純文字回覆。

### 🔒 個人隱私展示約定
- **單一姓名展示**：在詳情抽屜的地點治療師列表中，**姓名僅展示中文姓名或英文姓名中的一個（優先中文名）**，避免中英文全名並列對照過度曝光。執業牌照號碼（License No.）照常展示以便官方核實。AI 助理回覆亦必須嚴格遵循此隱私規則。

### 🔐 分析事件隱私約定
- **不上報使用者輸入內容**：Vercel Analytics 事件只記錄「行為發生」（如 `search_used`），**絕不上報搜尋詞、AI 提問等使用者輸入的文字** — 心理健康網站的輸入內容可能含姓名或敏感健康字眼。

### ⏰ 時段篩選與診時解析（hours.js）
- `hours.js` 把 `hours` 自由文字（如「星期一至星期六 12:30-19:30」）解析為結構化時段，支援「現在營業 / 週末開診 / 夜間開診」篩選、列表「營業中」徽章、AI 的 `find_open_locations` 工具。
- 解析結果記憶化掛在 location 物件的 `_hoursParsed`。無法解析（「暫未提供資料」等）回傳 null，時段篩選時視為不符合。
- 「夜間」定義為 18:00 後仍開診。改動解析規則須同步 `tests/hours.test.js`。

### 🔗 深連結與 URL 狀態（Deep Links）
- 支援 `#loc=<地點id>`（開啟詳情並定位）、`#cat=<分類,逗號分隔>`、`#q=<關鍵字>`、`#tf=<時段,逗號分隔>`。詳情抽屜的「分享連結」按鈕產生 `#loc=` 連結，供轉介場景直接分享特定機構。
- **開啟地點用 `pushState`**（進瀏覽歷史 → 返回鍵可關閉抽屜）；**篩選變動用 `replaceState`**（不灌爆歷史）。`hashchange` 監聽負責返回鍵/手動改網址時還原狀態。
- 篩選 → hash 同步經 `syncFilterHash()`；深連結還原期間以 `suppressHashSync` 防止反向覆寫。

### 🌐 三語 i18n（繁中/葡文/英文）
- 所有**使用者可見的 UI 字串**必須走 `src/i18n.js` 的 `t(key)`：靜態 HTML 用 `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` / `data-i18n-aria` 屬性；JS 產生的字串直接呼叫 `t()`。新增字串必須同時補齊三語（`tests/i18n.test.js` 會擋缺譯）。
- **資料不翻譯**：機構名、地址、診時維持中文原文；分類標籤用 `t('cat_<key>')`。
- AI 回覆語言跟隨 UI 語言（`getSystemInstruction` 依 `getLang()` 切換語言規則）。
- 語言持久化於 localStorage；切換時 `onLangChange` 回呼觸發 main.js 重繪列表/chips。i18n 模組必須保持 Node 安全（單元測試會 import）。

### ♿ 鍵盤可及性
- 列表項（桌面/手機/Spotlight 結果）一律 `role="button"` + `tabindex="0"` + Enter/Space 觸發（`makeListItemInteractive`）；互動元件需有 `:focus-visible` 外框。新增可點擊元件時遵循同一約定。

### 📍 附近優先（geo.js）
- 「附近優先」按鈕：Geolocation 原生 WGS-84 座標直接使用；與資料座標（GCJ-02）比較時由 `locDistance` 經 `getWgsCoords` 統一轉換，否則距離有數十至數百米偏差。
- 排序只在顯示層（`main.js` 的 `sortForDisplay`），不改動 data-loader 的名稱筆劃基準排序。

### 🛡️ 薄代理安全鎖定（lib/copilot-proxy.js）
- 代理**不信任前端傳入的模型參數**：`model`、`temperature`、`max_tokens`、`stream` 一律由 `lib/copilot-proxy.js` 強制指定；`tools` 僅允許白名單（`ALLOWED_TOOL_NAMES`，須與 `src/copilot.js` 的 TOOLS 同步）。
- `api/copilot.js`（正式）與 `vite.config.js` dev middleware（本地）都必須經 `sanitizeCopilotRequest`，勿讓任一邊直通。
- **金鑰紀律**：前端**不持有任何地圖 key**（MapLibre + OSM 免 key）。`AMAP_WEB_KEY`（採集 geocoding 用）只能存在於 GitHub Secrets / 環境變數，workflow 檔內**嚴禁**硬編碼 fallback。

### 🧭 手機端 App 喚醒與微信沙盒相容
- **地圖 App 喚醒**：點擊「高德導航」或「Google 地圖」按鈕時，行動端優先調起原生 App（透過各自特定的 URL Schemes / `geo:` 協議）。若手機未安裝該 App，設置 1.5 秒延遲計時器優雅降級跳轉至地圖 Web 行動版。
- **微信瀏覽器相容**：由於微信屏蔽 App 跳轉，檢測到微信內置瀏覽器時會自動觸發一個高質感的磨砂玻璃擬態彈窗，引導使用者「在瀏覽器中打開」以調起 App，或點擊按鈕直接在微信內瀏覽網頁版地圖。

### 地圖與座標系（關鍵約定）
- 底圖為 **MapLibre GL + CARTO light（基於 OSM）**，免 API key；attribution 必須保留（OSM/CARTO 授權要求）。
- **座標系鐵律**：`data.json` 的 `lng`/`lat` 是 **GCJ-02**（高德 geocoding 產出），底圖與 Geolocation 是 **WGS-84**。任何「顯示於地圖」或「與定位比較」都必須經 `geo.js` 的 `getWgsCoords(loc)`（記憶化）轉換；**勿就地覆寫 data.json 座標** — `detail.js` 的高德導航 URL 仍需原始 GCJ-02 值（`coordinate=gcj02`）。
- `initMap()` 等待 `style.load`（只等內嵌樣式 JSON，不等底圖磚），另設 8 秒逾時放行 — 底圖磚載入失敗不阻擋 marker 與其他功能。
- **map.js 必須動態載入**：`main.js` 以 `import('./map.js')` 延後載入（maplibre-gl 285KB gzip），列表/篩選/AI 不等地圖庫；載入前的地圖呼叫經 `mapApi` 包裝為 no-op。勿改回靜態 import。
- **marker 聚合**：GeoJSON source（`cluster: true`）+ 一層半徑 0 的隱形 circle layer（**必要** — 無 layer 引用的 source 不會載入 tile，`querySourceFeatures` 永遠回空）+ DOM marker 呈現（聚合 = `.map-cluster` 數字圓點、單點 = SVG pin）。
- **第三方資源不得阻塞首屏**：Google Fonts 以 `media="print"` + onload 非同步載入、Vercel Analytics 用 `async` — 兩者被牆或逾時（內地訪客常態）時列表仍須在數百毫秒內渲染。

### 採集腳本
- **Python 3**，獨立於前端，產出 JSON 後即完成任務。
- **資料來源**：`scrape.py` 直接從官方衛生局註冊網頁抓取，獲取最新的官方註冊數據。
- **繞過官方反爬蟲**：利用 Playwright 啟動參數 `--disable-blink-features=AutomationControlled` 與排除 `--enable-automation` 隱藏自動化特徵，結合 headed 模式與超時等待，成功自動繞過 Cloudflare Turnstile 驗證。
- **Geocoding fallback**：對無地址的公立醫療機構或易產生偏移的地址在 `build_data.py` 設有手動精準坐標修正。

### Build 與部署
- **data.json 打包**：Vite 預設只打包被 import 的資源，`data/data.json` 是 `fetch()` 動態載入的，**不會自動進 dist**。`vite.config.js` 用 `closeBundle` hook 在打包後 `cpSync('data','dist/data')` 修復此問題。修改 Vite 設定時勿移除此 hook。

## 倫理邊界（不可逾越）

- **不做評分/評論系統** — 醫療專業敏感。
- **不做使用者帳號/收藏** — MVP 範圍外，且涉及隱私。
- **明確免責聲明** — 頁面須標示「非官方、僅供參考、以官方為準、不構成醫療建議」。
- **資料與來源透明** — 頁尾顯示採集日期，並包含跳轉到衛生局官網首頁的連結以維護來源真實性。

## 不做（YAGNI）

- **v2（現況）已實作 AI Agent 功能**：`src/copilot.js` + `api/copilot.js`（Vercel 薄代理代管 `DEEPSEEK_API_KEY`）+ `vercel.json`，讓使用者免 Key 即可使用 Deepseek Agent（9 個工具）。詳見 `docs/roadmap-v2.md`。
- 後端伺服器／資料庫（~90 位治療師、41 地點，靜態 JSON 足夠）。v2 僅放寬至「無狀態 serverless 薄代理」，仍不做資料庫，`data.json` 仍在前端載入。
- 評分/評論、使用者帳號、離線/推播
- 「以治療師為 pin」的地圖視角切換

## 修改程式碼前的檢查清單

1. 改分類 → 同步 `src/config.js` 的 `CATEGORIES` + `styles.css` 的 `--cat-*` + `build_data.py` 的 `CATEGORY_RULES`
2. 改資料 schema → 同步 `data-loader.js` 的索引邏輯 + `validate.py` 的校驗 + `build_data.py` 的產出 + `main.js` 的 meta 讀取
3. 改 UI → 確認手機/桌面響應式（`@media (max-width: 768px)`）。手機版改動需同步 `#mobile-*` 元件與桌面版 `.sidebar` 內對應元件
4. 改 AI 工具 → 同步 `src/copilot.js` 的 `TOOLS` + `lib/copilot-proxy.js` 的 `ALLOWED_TOOL_NAMES`
5. 跑 `npm test` 確認單元測試通過（改 hours/geo/proxy 邏輯時務必補測試）
6. 跑 `npm run build` 確認無語法錯，且 `dist/data/data.json` 存在
7. 跑 `python3 scripts/validate.py` 確認資料一致
8. 改 Vite 設定 → 確認 `closeBundle` hook 仍複製 data/，且 dev 代理仍經 `sanitizeCopilotRequest`
