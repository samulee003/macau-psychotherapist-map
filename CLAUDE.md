# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本檔為快速上手指南。詳細約定見 **`AGENTS.md`**（結構、程式碼規範、倫理邊界、修改前檢查清單），
> 決策脈絡與踩過的坑見 **`MEMORY.md`**。兩者為權威來源，與本檔衝突時以它們為準。

## 專案定位

澳門註冊心理治療師執業地點地圖 —— **100% 純靜態**單頁應用（無後端、無 serverless function、無資料庫）。
資料來自澳門衛生局公開名冊，由 Python 腳本離線採集後產出 `data/data.json`，前端 `fetch()` 載入。

## 常用命令

```bash
npm install
npm run dev            # Vite dev server → http://localhost:5173
npm run build          # 產出 dist/（含 closeBundle 複製的 data/ 與 og-image.jpg）
npm run preview
npm test               # Vitest 全部單元測試

npx vitest run tests/hours.test.js        # 單一測試檔
npx vitest run -t "往返轉換"              # 單一測試（依 describe/it 名稱過濾）

python3 scripts/validate.py                          # 資料完整性校驗
python3 scripts/validate.py --baseline <舊 data.json> # 加上漂移守衛（數量驟減 >30% 即失敗）
```

CI（`.github/workflows/ci.yml`）跑的就是 `npm test` → `npm run build` → 檢查 `dist/data/data.json` 與
`dist/manifest.webmanifest` 存在 → `python scripts/validate.py`。推送前本機跑完這四步就不會紅。

## 資料採集（本機專用）

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install playwright requests beautifulsoup4 lxml && python -m playwright install chromium
export AMAP_WEB_KEY=<高德 Web 服務 key>    # 只有 geocoding 需要；前端地圖免 key

python3 scripts/scrape.py                  # 衛生局名冊 → raw.json
python3 scripts/geocode.py --fill-gaps     # 只補新地址座標 → geocoded.json
python3 scripts/build_data.py              # 去重/合併/分類 → data/data.json
python3 scripts/validate.py --baseline <更新前的 data.json>
open scripts/preview.html                  # 人工校驗座標
```

- **採集不能在 CI 跑**：`ssm.gov.mo` 對機房 IP 一律回 403 Cloudflare challenge（卡的是 IP 信譽，
  換瀏覽器指紋無效）。`update_data.yml` 已移除排程，只留手動觸發。
- **CSV 路徑**：從瀏覽器匯出名冊時走 `python3 scripts/import_roster_csv.py 名冊.csv`，它會從現有
  `data.json` 沿用座標，來源沒有新增地址時完全不需要 `AMAP_WEB_KEY`。

## 架構要點

### 資料模型：三張表 + 雙向索引

`data/data.json` 是 `therapists` / `locations` / `practices`（多對多關聯）三個陣列。
`src/data-loader.js` 的 `buildDatabase()` 建立雙向索引，**所有查詢都應透過它的方法**
（`getTherapistsByLocation` / `getLocationsByTherapist` / `getGeocodedLocations` …），
不要在各模組自行掃陣列。**地圖 marker 的單位是 location，不是 therapist。**

### 資料流

`main.js` 是唯一的串接點：`loadData()` → 建 DB → 動態 `import('./map.js')` → 綁定 UI。
篩選狀態的單一真相在 `search.js`（`state.query` / `activeCategories` / `activeTimeFilters`），
任何 UI 改變關鍵字都必須呼叫 `setQuery()`，由它 emit 回 `main.js` 的 `onFilterResult` →
`renderAll()` 一次重繪 marker、桌面列表、手機列表與 Spotlight 結果預覽。

### 座標系鐵律（最常出錯的地方）

`data.json` 的 `lng`/`lat` 是 **GCJ-02**（高德 geocoding 產出）；底圖（MapLibre + OSM）與
瀏覽器 Geolocation 是 **WGS-84**。任何「畫到地圖上」或「與使用者定位比距離」都必須先過
`geo.js` 的 `getWgsCoords(loc)`（記憶化）。**不要就地覆寫 data.json 的座標** —— `detail.js`
的高德導航 URL 仍需原始 GCJ-02 值。缺座標的地點會被 `getGeocodedLocations()` 濾掉而不上圖，
`build_data.py` 末段有一組手動座標修正規則專門補這種洞。

### 效能與離線的兩條硬約定

1. **`map.js` 必須動態載入**：maplibre-gl 約 273KB gzip，靜態 import 會把列表/搜尋一起卡住。
   載入完成前所有地圖呼叫經 `mapApi?.` 包裝成 no-op。第三方資源（Google Fonts、Analytics）
   一律非阻塞 —— 內地訪客常態被牆，被牆時列表仍須在數百毫秒內渲染。
2. **Service Worker（`public/sw.js`）**：HTML 導覽與 `data.json` 走 **network-first**，
   hashed JS/CSS/圖示才走 stale-while-revalidate。曾因整站 stale-while-revalidate 導致舊訪客
   回訪時被端出整個舊版 App（舊 index.html → 舊 hashed bundle）。改策略時務必 bump `CACHE_NAME`。

### marker 聚合的隱形 layer

`map.js` 用 GeoJSON source（`cluster: true`）+ **一層半徑 0 的隱形 circle layer** + DOM marker。
那層 layer 是必要的：沒有任何 layer 引用的 source 不會載入 tile，`querySourceFeatures()` 會永遠回空。

### i18n

繁中／葡文／英文三語，字典集中在 `src/i18n.js`。UI 字串走 `t(key)` 或 `data-i18n*` 屬性；
**資料本身（機構名、地址、診時）不翻譯**。新增字串必須同時補齊三語 —— `tests/i18n.test.js`
會擋缺譯、多餘鍵與佔位符不一致。i18n 模組須維持 Node 安全（單元測試會直接 import）。

## 不可逾越的約定

- **不做評分、評論、排名**（醫療專業敏感）；列表排序永遠附「不具推薦意義」的說明。
- **姓名只擇一顯示**（優先中文名），不並列中英對照；牌照號可顯示以便官方核實。
- **UI 禁止裝飾性 Emoji**。
- **Analytics 不上報使用者輸入內容** —— 只記 `search_used` 這類行為事件，不記搜尋詞。
- **不重新引入 AI 對話助理**：v2 曾有 Deepseek agent + 薄代理，v2.3 已整套移除（見
  `docs/roadmap-v2.md` 與 `MEMORY.md` 第 14 條）。除非使用者明確要求，勿還原。
- 前端**不得含任何 API key**；`AMAP_WEB_KEY` 只能存在於環境變數／GitHub Secrets，
  workflow 內嚴禁硬編碼 fallback。

## 改動後的自檢

改 UI 一定要同時確認桌面版（`.sidebar` + Spotlight 模態框）與手機版（`#mobile-*` 分屏元件）
兩套 DOM；改資料 schema 要同步 `data-loader.js`、`validate.py`、`build_data.py`。
本專案沒有 lint 設定，把關的是 `npm test` + `npm run build` + `scripts/validate.py`。
