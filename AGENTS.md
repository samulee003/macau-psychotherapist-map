# AGENTS.md

本檔案為 AI 代理（如 ZCode、Claude Code 等）提供本專案的工作指引。
修改程式碼前請先閱讀本檔，遵循其中的結構與約定。

## 專案概要

**澳門註冊心理治療師執業地址分布地圖** — 一個純靜態網頁應用，在地圖上展示澳門註冊心理治療師的執業地點分布，幫助市民查找心理治療資源。

- **資料來源**：澳門特別行政區政府衛生局 — 從事私人醫務活動專業人員名冊（`https://www.ssm.gov.mo/pubssmweb/Utlap/frmUtlapLic.aspx?licode=11&t=`）
- **資料性質**：官方公開註冊資訊（非個人隱私），全自動採集 + 人工校驗座標
- **規模**：90 位治療師、41 個執業地點、108 個執業關聯（多對多關係）
- **透明度**：UI 動態標註官方資料來源、採集日期，並附衛生局官方即時查詢連結供核實

## 技術棧

| 層 | 技術 |
|----|------|
| 前端 | Vite + 原生 JavaScript（ES Modules，**不用框架**） |
| 地圖 | 高德地圖 JS API 2.0 |
| 樣式 | 手寫 CSS（響應式、手機優先） |
| 資料 | 靜態 JSON（`data/data.json`） |
| 採集 | Python 3 + Playwright Stealth（分頁抓取官方衛生局網頁） |
| 部署 | 純靜態（GitHub Pages / Vercel） |

## 目錄結構

```
├── index.html              # 單頁應用入口
├── vite.config.js          # Vite 設定（含 closeBundle hook 複製 data/ 到 dist/）
├── src/                    # 前端原始碼（ES Modules）
│   ├── config.js           # 高德 key、機構分類定義（單一真相來源）
│   ├── data-loader.js      # 載入 data.json + 建立雙向查詢索引
│   ├── map.js              # 高德地圖渲染、marker、資訊窗
│   ├── search.js           # 搜尋與分類篩選
│   ├── detail.js           # 詳情抽屜面板
│   ├── main.js             # 入口，串接所有模組 + 動態填充來源 meta
│   └── styles.css
├── data/data.json          # 治療師 + 地點 + 執業關聯（採集產出）
├── scripts/                # Python 採集腳本（不在前端運行）
│   ├── scrape.py           # Playwright Stealth 模擬瀏覽器抓取衛生局官網 → raw.json
│   ├── geocode.py          # 地址→座標（高德 Web 服務） → geocoded.json
│   ├── build_data.py       # 去重/合併/分類 → data/data.json
│   ├── validate.py         # 資料完整性校驗
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
- **ES Modules**：所有 `src/*.js` 使用 `import`/`export`，不引入框架。~67 筆資料用原生 JS 足夠。
- **單一真相原則**：分類、配色、地圖視角集中在 `config.js`。
- **地圖視角**：以「地點」為主（marker = location，點擊展開此地點的治療師）。
- **HTML 跳脫**：所有從資料渲染到 DOM 的字串必須 `escapeHtml()`（各模組內已有此函式）。
- **檔案職責單一**：`map.js` 只管地圖、`search.js` 只管篩選、`detail.js` 只管詳情。

### 地圖初始化（已驗證的關鍵約定）
高德 JS API 偏好以**容器 id 字串**初始化，直接傳 DOM 元素會在內部偵測時報 `Map container div not exist`。`map.js` 的 `initMap()` 已處理：取 `container.id` 傳遞，並用 `requestAnimationFrame` 確保版面就緒。**勿改回傳 DOM 元素**。

### 採集腳本
- **Python 3**，獨立於前端，產出 JSON 後即完成任務。
- **資料來源**：`scrape.py` 直接從官方衛生局註冊網頁抓取，獲取最新的官方註冊數據。
- **繞過官方反爬蟲**：利用 Playwright 啟動參數 `--disable-blink-features=AutomationControlled` 與排除 `--enable-automation` 隱藏自動化特徵，結合 headed 模式與超時等待，成功自動繞過 Cloudflare Turnstile 驗證。
- **中葡與細節切分**：衛生局表格內的名單以 `<br>` 分隔中文與外/葡文姓名、地址與診症時間。本腳本直接按換行拆分，並自動分離出機構名稱 (`placeName`)、實際地址 (`addressZh`) 及葡文地址 (`addressPt`)。
- **Geocoding fallback**：`geocode.py` 對難解析地址採用了雙重 Fallback 機制（簡化門牌後綴、截斷至主要地標或街道號碼），實測 **45/45 個地址 100% 成功解析**。對無地址的公立醫療機構 (如衛生局)，`build_data.py` 自動注入若憲馬路預設地標坐標，實現 100% 坐標地圖呈現。

### Build 與部署
- **data.json 打包**：Vite 預設只打包被 import 的資源，`data/data.json` 是 `fetch()` 動態載入的，**不會自動進 dist**。`vite.config.js` 用 `closeBundle` hook 在打包後 `cpSync('data','dist/data')` 修復此問題。修改 Vite 設定時勿移除此 hook。

## 安全注意事項

- **高德 JS API key**（前端）：填在 `src/config.js`。建議在後台綁定網域白名單（目前與 Web 服務 key 共用同一個，正式上線建議分開並綁定正式網域）。
- **高德 Web 服務 key**（採集）：透過環境變數 `AMAP_WEB_KEY` 注入，**絕不寫入程式碼**，不進前端。
- `.gitignore` 已排除 `.env`、`.venv`、`scripts/raw.json`、`scripts/geocoded.json`、`dist/`。

## 倫理邊界（不可逾越）

- **不做評分/評論系統** — 醫療專業敏感。
- **不做使用者帳號/收藏** — MVP 範圍外，且涉及隱私。
- **明確免責聲明** — 頁面須標示「非官方、僅供參考、以官方為準、不構成醫療建議」。
- **資料透明** — 頁面顯示採集日期與來源，並附官方即時查詢連結。

## 不做（YAGNI）

- 後端伺服器／資料庫（~67 筆資料，靜態 JSON 足夠）
- 評分/評論、使用者帳號、離線/推播
- 「以治療師為 pin」的地圖視角切換

## 修改程式碼前的檢查清單

1. 改分類 → 同步 `src/config.js` 的 `CATEGORIES` + `styles.css` 的 `--cat-*` + `build_data.py` 的 `CATEGORY_RULES`
2. 改資料 schema → 同步 `data-loader.js` 的索引邏輯 + `validate.py` 的校驗 + `build_data.py` 的產出 + `main.js` 的 meta 讀取
3. 改 UI → 確認手機/桌面響應式（`@media (max-width: 768px)`）
4. 跑 `npm run build` 確認無語法錯，且 `dist/data/data.json` 存在
5. 跑 `python3 scripts/validate.py` 確認資料一致
6. 改 Vite 設定 → 確認 `closeBundle` hook 仍複製 data/
