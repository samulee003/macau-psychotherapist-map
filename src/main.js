/* ============================================================
   應用入口：載入資料 → 初始化地圖 → 綁定 UI 互動
   ============================================================
   版面設計：
   - 桌面版：左側欄（搜尋/篩選/列表）+ 右側地圖
   - 手機版：上下分屏（地圖頂部 + 列表底部），AI 改為浮動按鈕 → 全螢幕覆蓋
   ============================================================ */

import { loadData } from './data-loader.js';
import { initFilters, initTimeFilters, setQuery, selectCategoryProgrammatic, resetFiltersProgrammatic } from './search.js';
import { initDetail, showLocationDetail } from './detail.js';
import { CATEGORIES } from './config.js';
import { initCopilot, updateModalUiState } from './copilot.js';
import { initInAppBrowserBanner } from './inapp-browser.js';
import { isLocationOpenNow } from './hours.js';
import { getWgsCoords, distanceMeters, formatDistance } from './geo.js';

let db = null;
let currentLocations = []; // 目前篩選後顯示的地點
let activeModalResultIndex = -1; // Spotlight 搜尋結果鍵盤選取索引
let userPosition = null; // 「附近優先」的使用者座標（WGS-84，[lng, lat]），null = 未啟用

// map.js（連同 maplibre-gl 這個大依賴）採動態載入，
// 讓列表/篩選/AI 等 app shell 不被地圖庫的下載與解析阻塞。
// 載入完成前所有地圖操作都是 no-op。
let mapApi = null;

function renderMarkers(...args) { mapApi?.renderMarkers(...args); }
function highlightMarker(...args) { mapApi?.highlightMarker(...args); }
function closeInfoWindow() { mapApi?.closeInfoWindow(); }
function fitToMarkers(...args) { mapApi?.fitToMarkers(...args); }
function showUserLocation(...args) { mapApi?.showUserLocation(...args); }
function hideUserLocation() { mapApi?.hideUserLocation(); }

async function main() {
  // 儘早偵測並提示 App 內置瀏覽器（不等待資料載入）
  initInAppBrowserBanner();

  showLoader('載入資料中…');

  try {
    db = await loadData();
  } catch (err) {
    console.error(err);
    showLoader('資料載入失敗：' + err.message);
    return;
  }

  // 顯示採集日期與動態來源資訊（從 data.json 的 meta 填入）
  const collectedAt = document.getElementById('collected-at');
  if (collectedAt && db.meta.collectedAt) {
    collectedAt.textContent = db.meta.collectedAt;
  }
  const sourceLink = document.getElementById('meta-source-link');
  if (sourceLink && db.meta.source) {
    sourceLink.textContent = db.meta.source;
    if (db.meta.sourceUrl) sourceLink.href = db.meta.sourceUrl;
  }
  const officialLink = document.getElementById('meta-official-link');
  if (officialLink && db.meta.officialSourceUrl) {
    officialLink.href = db.meta.officialSourceUrl;
  }
  const disclaimer = document.getElementById('meta-disclaimer');
  if (disclaimer && db.meta.note) {
    disclaimer.textContent = db.meta.note;
  }

  hideLoader();

  // 地圖與 UI 並行初始化：map.js（含 maplibre-gl）動態載入，
  // 列表、篩選、AI 一律不等待。底圖就緒後補渲染 marker、
  // 綁定 marker 點擊，並重新聚焦深連結指定的地點（若有）。
  const mapContainer = document.getElementById('map-container');
  import('./map.js')
    .then(async (mod) => {
      await mod.initMap(mapContainer);
      mapApi = mod;

      // marker 點擊 → 開啟詳情 + 標記列表 active
      // （手機版不再收合側欄，因為列表常駐下半屏；地圖上半屏仍可見）
      mod.onMarkerClick((locationId) => {
        const loc = db.getLocationById(locationId);
        if (loc) openLocation(loc, { focusMap: false });
      });

      renderAll(currentLocations);
      const locId = new URLSearchParams(window.location.hash.slice(1)).get('loc');
      if (locId) {
        const loc = db.getLocationById(locId);
        if (loc) highlightMarker(loc.id, db);
      }
      if (userPosition) showUserLocation(userPosition);
    })
    .catch((err) => {
      console.error('地圖初始化失敗:', err);
      const msg = (err && err.message) ? err.message : '無法連線至地圖服務';
      showMapLoadError(mapContainer, msg);
    });

  // ---- 手機版 Copilot 容器 id 切換 ----
  // copilot.js 的 setupDom() 寫死尋找 #copilot-sidebar-container。
  // 手機版時將該 id 從隱藏的 sidebar 容器轉移到 overlay 內的容器，
  // 讓 copilot 不需改動即可掛載到手機版覆蓋層。
  if (window.innerWidth <= 768) {
    const sidebarContainer = document.getElementById('copilot-sidebar-container');
    const mobileContainer = document.getElementById('copilot-mobile-container');
    if (sidebarContainer && mobileContainer) {
      sidebarContainer.removeAttribute('id');
      mobileContainer.id = 'copilot-sidebar-container';
    }
  }

  // 初始化 UI 元件
  initDetail();
  initFilters(db, onFilterResult);
  initTimeFilters(db, ['time-filter-list', 'mobile-time-filters']);
  renderMobileFilters(db);
  bindMobileSearch();
  bindSplitHandle();
  bindAiFab();
  bindNearbyButtons();

  // 桌面版側欄開合與大小調整
  bindSidebarToggle();
  bindSidebarResizer();
  bindDesktopSpotlight();

  // 首次渲染：顯示全部
  currentLocations = db.getGeocodedLocations();
  renderAll(currentLocations);

  // 深連結：支援 #loc=<id>（開啟特定地點）、#cat=<key>、#q=<關鍵字>
  applyDeepLink();

  // 註冊 Service Worker（離線快取；不支援或失敗時靜默略過）
  registerServiceWorker();

  // 初始化 Copilot 智能助理 (Agentic Chatbot)
  initCopilot(db, {
    showLocationDetail: (loc) => {
      openLocation(loc);

      // 點選地點後，自動關閉桌面版搜尋模態框
      const backdrop = document.getElementById('desktop-search-backdrop');
      if (backdrop) backdrop.hidden = true;
    },
    setQuery: (query) => {
      const chatInput = document.getElementById('chat-input');
      if (chatInput) chatInput.value = query;
      // 同步手機版搜尋框
      const mobileSearch = document.getElementById('mobile-search-input');
      if (mobileSearch) mobileSearch.value = query;
      setQuery(query, db);
    },
    selectCategory: (catKey) => {
      selectCategoryProgrammatic(catKey, db);
    },
    resetFilters: () => {
      // 同步手機版搜尋框
      const mobileSearch = document.getElementById('mobile-search-input');
      if (mobileSearch) mobileSearch.value = '';
      resetFiltersProgrammatic(db);
    },
  });
}

/**
 * 篩選結果回呼：重繪地圖 marker 與側欄列表。
 */
function onFilterResult(filteredLocations, database) {
  currentLocations = filteredLocations;
  renderAll(filteredLocations);
}

function renderAll(locations) {
  // 「附近優先」啟用時依距離排序（無座標的排最後）
  const display = sortForDisplay(locations);
  // 只在地圖上放有座標的
  const mappable = display.filter((l) => l.lng != null && l.lat != null);
  renderMarkers(mappable, db);
  renderLocationList(display);
  renderMobileLocationList(display);
  updateResultCount(display);
  fitToMarkers(mappable);
  renderModalSearchResults(display);
}

/**
 * 依目前排序模式回傳顯示用陣列。
 * 預設維持 data-loader 的名稱筆劃排序；「附近優先」時依距離。
 */
function sortForDisplay(locations) {
  if (!userPosition) return locations;
  const [ulng, ulat] = userPosition;
  return [...locations].sort((a, b) => locDistance(a, ulng, ulat) - locDistance(b, ulng, ulat));
}

function locDistance(loc, ulng, ulat) {
  // 地點座標為 GCJ-02，需轉 WGS-84 後才能與 Geolocation 座標比較
  const coords = getWgsCoords(loc);
  if (!coords) return Infinity;
  return distanceMeters(ulng, ulat, coords[0], coords[1]);
}

/**
 * 統一的「開啟地點」入口：詳情抽屜 + 地圖聚焦 + 列表 active + 深連結 hash。
 * marker 點擊時 focusMap 傳 false（地圖已在該處，避免多餘動畫）。
 */
function openLocation(loc, { focusMap = true, updateHash = true } = {}) {
  showLocationDetail(loc, db);
  if (focusMap) highlightMarker(loc.id, db);
  setActiveListItem(loc.id);
  if (updateHash) {
    history.replaceState(null, '', `#loc=${encodeURIComponent(loc.id)}`);
  }
}

/**
 * 解析網址 hash 深連結並套用。
 * 格式：#loc=<地點id> 或 #cat=<分類key> 或 #q=<關鍵字>（可用 & 組合 cat/q）。
 */
function applyDeepLink() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;
  let params;
  try {
    params = new URLSearchParams(hash);
  } catch {
    return;
  }

  const locId = params.get('loc');
  if (locId) {
    const loc = db.getLocationById(locId);
    if (loc) openLocation(loc, { updateHash: false });
    return;
  }

  const cat = params.get('cat');
  if (cat && CATEGORIES[cat]) {
    selectCategoryProgrammatic(cat, db);
  }
  const q = params.get('q');
  if (q) {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.value = q;
    const mobileSearch = document.getElementById('mobile-search-input');
    if (mobileSearch) mobileSearch.value = q;
    setQuery(q, db);
  }
}

/** 註冊 PWA Service Worker（僅 https 或 localhost 生效） */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker 註冊失敗（不影響使用）:', err);
    });
  } catch (e) {
    // 私隱模式等環境可能拋例外，靜默略過
  }
}

/* ============================================================
   地點列表渲染（桌面版 + 手機版）
   ============================================================ */

/**
 * 渲染側欄地點列表（桌面版）。
 */
function renderLocationList(locations) {
  const ul = document.getElementById('location-list');
  const countEl = document.getElementById('list-count');
  if (countEl) countEl.textContent = `(${locations.length})`;

  if (!ul) return;
  ul.innerHTML = '';
  if (locations.length === 0) {
    ul.innerHTML = '<li style="padding:16px 0;color:#9ca3af;font-size:13px;text-align:center">沒有符合條件的地點</li>';
    return;
  }

  for (const loc of locations) {
    const cat = CATEGORIES[loc.category] || CATEGORIES.other;
    const therapistCount = db.getTherapistsByLocation(loc.id).length;
    const li = document.createElement('li');
    li.className = 'list__item';
    li.dataset.locationId = loc.id;
    li.innerHTML = `
      <div class="list__item-name">
        <span class="list__item-dot" style="background:${cat.color}"></span>
        ${escapeHtml(loc.name)}
        ${isLocationOpenNow(loc) ? '<span class="badge-open">營業中</span>' : ''}
      </div>
      <div class="list__item-address">${escapeHtml(loc.addressZh || '地址不詳')}</div>
      ${therapistCount ? `<div class="list__item-count">${therapistCount} 位心理治療師${distanceLabel(loc)}</div>` : `<div class="list__item-count">${distanceLabel(loc, true)}</div>`}
      ${loc.lng == null ? '<div class="list__item-count" style="color:#9ca3af">無法定位</div>' : ''}
    `;
    li.addEventListener('click', () => {
      openLocation(loc);
    });
    ul.appendChild(li);
  }
}

/**
 * 「附近優先」啟用時的距離標籤（如「 · 850 公尺」）。
 * @param {boolean} bare 為 true 時不帶前導分隔符
 */
function distanceLabel(loc, bare = false) {
  if (!userPosition || loc.lng == null || loc.lat == null) return '';
  const d = formatDistance(locDistance(loc, userPosition[0], userPosition[1]));
  if (!d) return '';
  return bare ? d : ` · ${d}`;
}

/**
 * 渲染手機版地點列表（下半屏）。
 */
function renderMobileLocationList(locations) {
  const ul = document.getElementById('mobile-location-list');
  const countEl = document.getElementById('mobile-list-count');
  if (countEl) countEl.textContent = `(${locations.length})`;

  if (!ul) return;
  ul.innerHTML = '';
  if (locations.length === 0) {
    ul.innerHTML = '<li style="padding:24px 0;color:#9ca3af;font-size:13px;text-align:center">沒有符合條件的地點</li>';
    return;
  }

  for (const loc of locations) {
    const cat = CATEGORIES[loc.category] || CATEGORIES.other;
    const therapistCount = db.getTherapistsByLocation(loc.id).length;
    const li = document.createElement('li');
    li.className = 'mobile-list__item';
    li.dataset.locationId = loc.id;
    li.innerHTML = `
      <div class="mobile-list__item-name">
        <span class="mobile-list__item-dot" style="background:${cat.color}"></span>
        ${escapeHtml(loc.name)}
        ${isLocationOpenNow(loc) ? '<span class="badge-open">營業中</span>' : ''}
      </div>
      <div class="mobile-list__item-address">${escapeHtml(loc.addressZh || '地址不詳')}</div>
      ${therapistCount ? `<div class="mobile-list__item-count">${therapistCount} 位心理治療師${distanceLabel(loc)}</div>` : `<div class="mobile-list__item-count">${distanceLabel(loc, true)}</div>`}
      ${loc.lng == null ? '<div class="mobile-list__item-count" style="color:#9ca3af">無法定位</div>' : ''}
    `;
    li.addEventListener('click', () => {
      openLocation(loc);
      setActiveMobileListItem(loc.id);
    });
    ul.appendChild(li);
  }
}

/**
 * 設定桌面版列表的 active 狀態。
 */
function setActiveListItem(locationId) {
  document.querySelectorAll('.list__item').forEach((li) => {
    const isActive = li.dataset.locationId === locationId;
    li.classList.toggle('is-active', isActive);
    if (isActive) {
      li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  // 同步手機版列表的 active 狀態
  document.querySelectorAll('.mobile-list__item').forEach((li) => {
    li.classList.toggle('is-active', li.dataset.locationId === locationId);
  });
}

/**
 * 設定手機版列表的 active 狀態，並同步桌面版。
 */
function setActiveMobileListItem(locationId) {
  document.querySelectorAll('.mobile-list__item').forEach((li) => {
    const isActive = li.dataset.locationId === locationId;
    li.classList.toggle('is-active', isActive);
    if (isActive) {
      li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  // 同步桌面版列表的 active 狀態
  document.querySelectorAll('.list__item').forEach((li) => {
    li.classList.toggle('is-active', li.dataset.locationId === locationId);
  });
}

function updateResultCount(locations) {
  const el = document.getElementById('search-results-count');
  if (!el) return;
  el.textContent = locations.length === 0
    ? '沒有符合的結果'
    : `顯示 ${locations.length} 個執業地點`;
}

/* ============================================================
   手機版搜尋與分類篩選
   ============================================================ */

/**
 * 簡易的防抖函數 (Debounce)
 */
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 簡易的節流函數 (Throttle)
 */
function throttle(fn, limit) {
  let inThrottle = false;
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * 綁定手機版搜尋框 input 事件，加防抖避免打字時頻繁重建 Marker 導致地圖崩潰。
 */
function bindMobileSearch() {
  const input = document.getElementById('mobile-search-input');
  if (!input) return;
  const debouncedSearch = debounce((val) => {
    setQuery(val, db);
  }, 250);
  input.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });
}

/**
 * 渲染手機版分類篩選 chip。
 * 手機版採「單選」模式：點擊某分類即呼叫 selectCategoryProgrammatic，
 * 它會同步所有 .filter-chip（含桌面版）的 is-active 狀態並觸發篩選。
 */
function renderMobileFilters(db) {
  const container = document.getElementById('mobile-filters');
  if (!container) return;

  // 「全部」chip
  const usedCategories = new Set(db.locations.map((l) => l.category));
  container.innerHTML = '';

  // 全部
  const allChip = document.createElement('button');
  allChip.className = 'filter-chip';
  allChip.dataset.category = 'all';
  allChip.innerHTML = `<span>全部</span>`;
  allChip.addEventListener('click', () => {
    selectCategoryProgrammatic('all', db);
  });
  container.appendChild(allChip);

  for (const catKey of Object.keys(CATEGORIES)) {
    if (!usedCategories.has(catKey)) continue;
    const cat = CATEGORIES[catKey];
    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.dataset.category = catKey;
    chip.innerHTML = `
      <span class="filter-chip__dot" style="background:${cat.color}"></span>
      <span>${escapeHtml(cat.label)}</span>`;
    chip.addEventListener('click', () => {
      selectCategoryProgrammatic(catKey, db);
    });
    container.appendChild(chip);
  }
}

/* ============================================================
   分屏拖曳把手
   ============================================================ */

/**
 * 綁定 #split-handle 拖曳，調整地圖容器高度（25%~70%）。
 * 同時支援滑鼠與觸控事件。採用節流 (Throttle) 限制 DOM 與地圖 resize 頻率，防止 iOS/Android 瀏覽器 WebGL 崩潰。
 */
function bindSplitHandle() {
  const handle = document.getElementById('split-handle');
  const mapContainer = document.getElementById('map-container');
  if (!handle || !mapContainer) return;

  let dragging = false;
  let lastClientY = 0;

  const setHeightFromY = (clientY) => {
    const winH = window.innerHeight;
    let pct = (clientY / winH) * 100;
    // 限制 25%~70%
    if (pct < 25) pct = 25;
    if (pct > 70) pct = 70;
    document.documentElement.style.setProperty('--split-map-height', pct + '%');
    mapContainer.style.height = pct + '%';
  };

  // 節流設定為每 80ms 更新一次高度 (約 12.5 FPS)，有效降低 WebGL 重繪負荷，防止崩潰
  const throttledSetHeight = throttle(setHeightFromY, 80);

  // --- 滑鼠 ---
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    lastClientY = e.clientY;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    lastClientY = e.clientY;
    throttledSetHeight(e.clientY);
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // 拖曳結束時強制更新到最終位置，確保位置精準
      setHeightFromY(lastClientY);
    }
  });

  // --- 觸控 ---
  // 利用移動端 Touch Target Capture 特性，將所有觸控監聽直接綁定在 handle 上
  // 並配合 e.stopPropagation()，阻止 Threads/FB/Line 等 App 內置瀏覽器將此手勢判定為「下拉關閉 Webview」
  handle.addEventListener('touchstart', (e) => {
    dragging = true;
    document.body.style.userSelect = 'none';
    if (e.touches && e.touches[0]) {
      lastClientY = e.touches[0].clientY;
    }
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }, { passive: false });

  handle.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    if (t) {
      lastClientY = t.clientY;
      throttledSetHeight(t.clientY);
    }
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }, { passive: false });

  handle.addEventListener('touchend', (e) => {
    if (dragging) {
      dragging = false;
      document.body.style.userSelect = '';
      // 拖曳結束時強制更新到最終位置
      setHeightFromY(lastClientY);
      e.stopPropagation();
    }
  });
}

/* ============================================================
   「附近優先」定位排序
   ============================================================ */

/**
 * 綁定桌面版與手機版的「附近優先」按鈕。
 * 開啟：取得定位（WGS-84 → GCJ-02）→ 距離排序 + 地圖藍點。
 * 再次點擊：關閉，恢復名稱筆劃排序。
 */
function bindNearbyButtons() {
  const buttons = [
    document.getElementById('nearby-btn'),
    document.getElementById('mobile-nearby-btn'),
  ].filter(Boolean);
  if (buttons.length === 0) return;

  const setActive = (active) => {
    buttons.forEach((b) => {
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  };

  const disable = () => {
    userPosition = null;
    hideUserLocation();
    setActive(false);
    renderAll(currentLocations);
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (userPosition) {
        disable();
        return;
      }
      if (!navigator.geolocation) {
        alert('您的瀏覽器不支援定位功能。');
        return;
      }
      buttons.forEach((b) => b.classList.add('is-loading'));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          buttons.forEach((b) => b.classList.remove('is-loading'));
          // OSM 底圖與 Geolocation 皆為 WGS-84，原生座標直接可用；
          // 與資料座標（GCJ-02）比較時由 locDistance 統一轉換
          userPosition = [pos.coords.longitude, pos.coords.latitude];
          showUserLocation(userPosition);
          setActive(true);
          renderAll(currentLocations);
        },
        (err) => {
          buttons.forEach((b) => b.classList.remove('is-loading'));
          console.warn('定位失敗:', err);
          alert('無法取得您的位置。請確認已允許定位權限，或改用搜尋/篩選查找。');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  });
}

/* ============================================================
   AI 浮動按鈕與全螢幕覆蓋
   ============================================================ */

/**
 * 綁定 AI 浮動按鈕開啟 / 覆蓋層關閉。
 */
function bindAiFab() {
  const fab = document.getElementById('ai-fab');
  const overlay = document.getElementById('ai-overlay');
  const closeBtn = document.getElementById('ai-overlay-close');
  if (!fab || !overlay) return;

  const openOverlay = () => {
    overlay.hidden = false;
    document.body.style.overflow = 'hidden'; // 阻止背景滾動
  };
  const closeOverlay = () => {
    overlay.hidden = true;
    document.body.style.overflow = '';
  };

  fab.addEventListener('click', openOverlay);
  closeBtn?.addEventListener('click', closeOverlay);

  // 點擊覆蓋層背景（非內容區）也可關閉
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });
}

/* ============================================================
   桌面版側欄開合（手機版不再使用此邏輯）
   ============================================================ */

/**
 * 桌面版側欄開合邏輯。
 */
function bindSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  const openBtn = document.getElementById('sidebar-open');
  if (!sidebar) return;

  // 桌上版完全離屏摺疊 / 展開
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.add('is-collapsed');
    sidebar.classList.remove('is-expanded');
    if (openBtn) openBtn.hidden = false;
    closeInfoWindow();
  });

  openBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.remove('is-collapsed');
    openBtn.hidden = true;
  });
}

/**
 * 側欄寬度拖動調整邏輯 (Resizable Sidebar，桌面版專用)。
 */
function bindSidebarResizer() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('sidebar');
  if (!resizer || !sidebar) return;

  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    
    resizer.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });

  function handleMouseMove(e) {
    const width = startWidth + (e.clientX - startX);
    if (width >= 280 && width <= 600) {
      document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    }
  }

  function handleMouseUp() {
    resizer.classList.remove('is-dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }
}

/**
 * 桌面版 Spotlight 搜尋與 AI 助理模態框控制邏輯。
 */
function bindDesktopSpotlight() {
  const trigger = document.getElementById('desktop-search-trigger');
  const backdrop = document.getElementById('desktop-search-backdrop');
  if (!trigger || !backdrop) return;

  const openModal = () => {
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      const input = document.getElementById('chat-input');
      if (input) {
        input.focus();
        input.select();
        // 開啟時同步一次 UI 狀態，確保顯示正確
        updateModalUiState(input.value.trim());
      }
    });
  };

  const closeModal = () => {
    backdrop.hidden = true;
  };

  trigger.addEventListener('click', openModal);

  // 點擊背景關閉
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeModal();
    }
  });

  // 鍵盤快捷鍵：⌘K 或 Ctrl+K 開啟，Esc 關閉
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openModal();
    }
    if (e.key === 'Escape' && !backdrop.hidden) {
      closeModal();
    }
  });

  // 鍵盤導航：在 Spotlight 輸入框按 ArrowUp / ArrowDown 選取預覽結果，按 Enter 定位
  const chatInput = document.getElementById('chat-input');
  chatInput?.addEventListener('keydown', (e) => {
    const resultsContainer = document.getElementById('modal-search-results');
    if (!resultsContainer || resultsContainer.hidden) {
      activeModalResultIndex = -1;
      return;
    }

    const items = resultsContainer.querySelectorAll('.modal-results__item');
    if (items.length === 0) {
      activeModalResultIndex = -1;
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      activeModalResultIndex++;
      if (activeModalResultIndex >= items.length) {
        activeModalResultIndex = 0; // 循環到第一個
      }
      updateSelectedModalResult(items, activeModalResultIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      activeModalResultIndex--;
      if (activeModalResultIndex < -1) {
        activeModalResultIndex = items.length - 1; // 循環到最後一個
      }
      updateSelectedModalResult(items, activeModalResultIndex);
    } else if (e.key === 'Enter') {
      // 只有當選中了某個即時預覽結果時，才攔截 Enter 鍵並進行定位（否則放行給 AI 對話）
      if (activeModalResultIndex >= 0 && activeModalResultIndex < items.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        items[activeModalResultIndex].click(); // 觸發定位點擊事件
        activeModalResultIndex = -1;
      }
    }
  }, true); // 使用 Capture 捕獲階段，以先於 copilot.js 的 Enter 對話發送事件進行攔截
}

/**
 * 更新 Spotlight 搜尋結果的鍵盤選取樣式與滾動視角
 */
function updateSelectedModalResult(items, index) {
  items.forEach((item, i) => {
    if (i === index) {
      item.classList.add('modal-results__item--selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('modal-results__item--selected');
    }
  });
}

/**
 * 渲染 Spotlight 模態框內部的即時搜尋結果清單 (桌面版專用)。
 */
function renderModalSearchResults(locations) {
  const container = document.getElementById('modal-search-results');
  if (!container) return;

  container.innerHTML = '';
  activeModalResultIndex = -1; // 每次重新輸入或搜尋時，重置鍵盤選取索引
  
  // 若沒有篩選關鍵字且對話尚未開始，由 updateModalUiState 控制隱藏
  const queryInput = document.getElementById('chat-input');
  if (!queryInput || !queryInput.value.trim()) {
    return;
  }

  if (locations.length === 0) {
    container.innerHTML = `
      <div class="modal-results__empty">
        沒有找到符合的執業地點，您可以直接按 Enter 詢問 AI 助理。
      </div>`;
    return;
  }

  // 限制只顯示前 5 筆最相關結果，避免撐爆模態框
  const displayLocations = locations.slice(0, 5);
  
  const title = document.createElement('div');
  title.className = 'modal-results__title';
  title.textContent = `執業地點快速預覽 (${locations.length} 個結果)`;
  container.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'modal-results__list';

  for (const loc of displayLocations) {
    const cat = CATEGORIES[loc.category] || CATEGORIES.other;
    const therapists = db.getTherapistsByLocation(loc.id);
    const li = document.createElement('li');
    li.className = 'modal-results__item';
    li.innerHTML = `
      <div class="modal-results__item-left">
        <span class="modal-results__dot" style="background:${cat.color}"></span>
        <div class="modal-results__name">${escapeHtml(loc.name)}</div>
        <div class="modal-results__address">${escapeHtml(loc.addressZh || '')}</div>
      </div>
      <div class="modal-results__item-right">
        <span class="modal-results__badge">${therapists.length}位治療師</span>
        <span class="modal-results__go">定位</span>
      </div>
    `;

    li.addEventListener('click', () => {
      openLocation(loc);

      // 點擊後關閉 Spotlight 模態框
      const backdrop = document.getElementById('desktop-search-backdrop');
      if (backdrop) backdrop.hidden = true;
    });

    ul.appendChild(li);
  }

  container.appendChild(ul);
}

/* ---------- 載入狀態 ---------- */
function showLoader(msg) {
  let loader = document.querySelector('.loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.className = 'loader';
    document.body.appendChild(loader);
  }
  loader.textContent = msg || '載入中…';
  loader.style.display = 'flex';
}

function hideLoader() {
  const loader = document.querySelector('.loader');
  if (loader) loader.style.display = 'none';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 當地圖加載失敗時，渲染精美的警告卡片替代空白，使系統其他列表與 AI 功能正常降級運行
 */
function showMapLoadError(container, errorMsg) {
  if (!container) return;
  container.classList.add('map-error-state');
  container.innerHTML = `
    <div class="map-error-card">
      <div class="map-error-card__icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </div>
      <div class="map-error-card__title">地圖服務暫時無法載入</div>
      <div class="map-error-card__desc">
        可能是您的網絡連接受限或底圖服務暫時繁忙。您仍可透過列表、搜尋、篩選或 AI 助理檢索資源。
      </div>
      <div class="map-error-card__tech">錯誤詳情：${escapeHtml(errorMsg)}</div>
      <button class="btn btn--primary map-error-card__retry" onclick="window.location.reload()">重新整理網頁</button>
    </div>
  `;
}

main();
