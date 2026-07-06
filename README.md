# 澳門註冊心理治療師執業地址分布地圖

一個純靜態網頁應用，在地圖上展示澳門註冊心理治療師的執業地點分布，幫助市民查找心理治療資源。

資料來源為**澳門心理專業人員協會（APM）整理名冊**（源自衛生局註冊資料），全自動採集 + 人工校驗座標。

## ✨ 功能

- 🗺️ **互動地圖**：高德地圖顯示所有執業地點，依機構類型配色
- 🔍 **即時搜尋**：依治療師姓名、機構名稱、地址搜尋
- 🏷️ **分類篩選**：依機構類型（醫院／醫療中心／心理中心／社服機構等）篩選
- ⏰ **時段篩選**：「現在營業」「週末開診」「夜間開診」一鍵篩選，列表顯示「營業中」徽章
- 📍 **附近優先**：一鍵以自身位置排序，顯示步行距離（自動處理 GCJ-02 座標偏移）
- 🔗 **深連結分享**：`#loc=<id>` 直達特定機構，詳情面板一鍵複製分享連結（轉介場景）
- 📋 **地點詳情**：點擊查看機構資訊、電話（可直撥）、診症時間、該處所有心理治療師
- 🧭 **一鍵導航**：整合高德／Google 地圖 App 喚醒
- 🤖 **AI 智能助理**：免 Key 對話式查詢（Deepseek agent + 10 個工具），可控制地圖與篩選
- 📱 **響應式設計 + PWA**：手機、平板、桌面皆適用；支援離線快取與安裝到主畫面
- ☎️ **官方求助資源**：自我心理狀態快測、明愛生命熱線、社工局心理熱線常駐入口

## 🚀 快速開始

### 前置需求

- Node.js 18+
- 一個 [高德開放平台](https://lbs.amap.com/dev/) 帳號（免費）

### 安裝與本地運行

```bash
npm install
npm run dev
```

開啟 <http://localhost:5173>

```bash
npm test   # 單元測試（診時解析、座標轉換、資料索引、代理驗證）
```

### 設定高德 API Key（必要）

地圖功能需要高德 API key。請至 [高德開放平台](https://lbs.amap.com/dev/) 申請：

1. **JS API 應用**（前端地圖顯示）：
   - 建立「Web端(JS API)」類型應用
   - 在「綁定網域」加入你的網域（如 `localhost`、`xxx.github.io`）
   - 取得 **key** 與 **安全金鑰(securityJsCode)**
   - 填入 `src/config.js` 的 `AMAP_CONFIG`

2. **Web 服務應用**（採集腳本 geocoding 用，可選）：
   - 建立「Web服務」類型應用
   - 設定環境變數：`export AMAP_WEB_KEY=你的key`

## 📊 資料更新

資料採集流程詳見 [docs/data-sources.md](docs/data-sources.md)。簡言之：

```bash
# 採集依賴（建議用虛擬環境）
python3 -m venv .venv && source .venv/bin/activate
pip install requests beautifulsoup4 lxml
export AMAP_WEB_KEY=你的key   # 高德 Web 服務 key，用於 geocoding

# 一鍵採集流程
python3 scripts/scrape.py        # 從 APM 名冊抓取 → raw.json
python3 scripts/geocode.py       # 地址→座標 → geocoded.json
python3 scripts/build_data.py    # 去重/合併 → data/data.json
python3 scripts/validate.py      # 資料校驗
open scripts/preview.html        # 人工校驗座標
```

## 🏗️ 技術棧

| 項目 | 技術 |
|------|------|
| 前端 | Vite + 原生 JavaScript (ES Modules) |
| 地圖 | 高德地圖 JS API 2.0 |
| 樣式 | 手寫 CSS（響應式） |
| 資料 | 靜態 JSON |
| 採集 | Python + requests + BeautifulSoup |
| 部署 | 純靜態（GitHub Pages / Vercel） |

## 📁 專案結構

```
├── index.html              # 單頁應用入口
├── src/
│   ├── config.js           # 高德 key、分類定義
│   ├── data-loader.js      # 資料載入與索引
│   ├── map.js              # 地圖渲染、marker、彈窗
│   ├── search.js           # 搜尋與篩選
│   ├── detail.js           # 詳情面板
│   └── styles.css
├── data/data.json          # 治療師+地點資料
├── scripts/                # 採集腳本
│   ├── scrape.py           # 抓取 APM 名冊 → raw.json
│   ├── geocode.py          # 地址→座標
│   ├── build_data.py       # 產出 data.json
│   ├── validate.py         # 資料校驗
│   └── preview.html        # 座標人工校驗頁
└── docs/data-sources.md    # 資料來源說明
```

## 🚢 部署

`npm run build` 會產出 `dist/`，其中 `data/data.json` 已透過 vite.config.js 的 `closeBundle` hook 自動複製（Vite 預設不打包 fetch 載入的檔案）。直接部署 `dist/` 即可。

### GitHub Pages

```bash
npm run build
# 將 dist/ 內容推到 gh-pages 分支，或設定 GitHub Actions
```

### Vercel / Netlify

```bash
npm run build
# 上傳 dist/ 目錄，或連結 Git repo 自動部署
```

> ⚠️ 部署後記得在高德後台將部署網域加入 JS API 的「綁定網域」白名單。

### 部署前安全檢查清單

- [ ] 高德 **JS API key**（`src/config.js`）已在高德後台綁定正式部署網域的白名單。
- [ ] 高德 **JS API key** 與**Web 服務 key**（採集腳本用）已分離為兩組獨立 key，避免前端公開 key 與後端 geocoding key 混用。
- [ ] **Web 服務 key 只存在於 GitHub Secrets（`AMAP_WEB_KEY`）**，workflow 檔內無任何硬編碼 fallback。若 key 曾出現在版控歷史，須至高德後台**作廢舊 key 並換新**。
- [ ] Vercel 環境變數 `DEEPSEEK_API_KEY` 已設定，且未提交至版本控制。
- [ ] `.env` 未被意外提交（已列於 `.gitignore`）。
- [ ] `/api/copilot` 淨化邏輯（`lib/copilot-proxy.js`）未被繞過 — model/max_tokens 由伺服器強制，tools 走白名單。

## ⚖️ 免責聲明

本網站**非官方機構**，與澳門衛生局或 APM 無關。資料採集自 APM 整理的公開名冊（源自衛生局註冊資料），**僅供參考**，可能延遲或不完整，不構成醫療建議或轉介。最新資訊請以[衛生局官方查詢系統](https://www.ssm.gov.mo/pubssmweb/register/frmShowRegister.aspx)為準。
