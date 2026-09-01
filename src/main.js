/* ============================================================
   應用入口：載入資料 → 初始化地圖 → 綁定 UI 互動
   ============================================================
   版面設計：
   - 桌面版：左側欄（搜尋/篩選/列表）+ 右側地圖
   - 手機版：上下分屏（地圖頂部 + 列表底部）
   ============================================================ */

import { loadData } from './data-loader.js';
import { initFilters, initTimeFilters, setQuery, selectCategoryProgrammatic, applyCategoriesProgrammatic, resetFiltersProgrammatic, getFilterSnapshot, applyTimeFiltersProgrammatic } from './search.js';
import { initDetail, showLocationDetail, hideDetail } from './detail.js';
import { CATEGORIES } from './config.js';
import { initInAppBrowserBanner } from './inapp-browser.js';
import { isLocationOpenNow } from './hours.js';
import { getWgsCoords, distanceMeters, formatDistance } from './geo.js';
import { t, getLang, setLang, onLangChange, applyI18nDom } from './i18n.js';

let db = null;
let currentLocations = []; // 目前篩選後顯示的地點
let activeModalResultIndex = -1; // Spotlight 搜尋結果鍵盤選取索引
let userPosition = null; // 「附近優先」的使用者座標（WGS-84，[lng, lat]），null = 未啟用

// map.js（連同 maplibre-gl 這個大依賴）採動態載入，
// 讓列表/搜尋/篩選等 app shell 不被地圖庫的下載與解析阻塞。
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

  // 套用已保存的語言（DOM 靜態文案）並綁定切換器
  applyI18nDom();
  bindLangSwitch();

  showLoader(t('loading_data'));

  try {
    db = await loadData();
  } catch (err) {
    console.error(err);
    showLoader(t('loading_failed') + err.message);
    return;
  }

  updateFooterMeta();

  hideLoader();

  // 地圖與 UI 並行初始化：map.js（含 maplibre-gl）動態載入，
  // 列表、搜尋、篩選一律不等待。底圖就緒後補渲染 marker、
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
      const msg = (err && err.message) ? err.message : t('map_error_fallback');
      showMapLoadError(mapContainer, msg);
    });

  // 初始化 UI 元件
  initDetail();
  initFilters(db, onFilterResult);
  initTimeFilters(db, ['time-filter-list', 'mobile-time-filters']);
  renderMobileFilters(db);
  bindMobileSearch();
  bindSplitHandle();
  bindNearbyButtons();

  // 桌面版側欄開合與大小調整
  bindSidebarToggle();
  bindSidebarResizer();

  // 首次渲染：顯示全部
  currentLocations = db.getGeocodedLocations();
  renderAll(currentLocations);

  // 語言切換後重繪所有由 JS 產生的文案
  onLangChange(() => {
    updateFooterMeta();
    initFilters(db, onFilterResult);
    initTimeFilters(db, ['time-filter-list', 'mobile-time-filters']);
    renderMobileFilters(db);
    renderAll(currentLocations);
    hideDetail(); // 抽屜內容為舊語言，關閉讓使用者重開即新語言
  });

  // 註冊 Service Worker（離線快取；不支援或失敗時靜默略過）
  registerServiceWorker();

  // 桌面版 Spotlight 關鍵字搜尋（⌘K / Ctrl+K）
  bindDesktopSpotlight();

  // 深連結需要先有搜尋欄 DOM，才能同步桌面與手機搜尋框。
  applyDeepLink();

  // 返回鍵 / 手動改 hash：重新套用深連結狀態（可用返回鍵關閉詳情抽屜）
  window.addEventListener('hashchange', onHashChange);
}

/**
 * 篩選結果回呼：重繪地圖 marker 與側欄列表。
 */
function onFilterResult(filteredLocations, database) {
  currentLocations = filteredLocations;
  renderAll(filteredLocations);
  syncFilterHash();
}

function renderAll(locations) {
  // 「附近優先」啟用時依距離排序（無座標的排最後）
  const display = sortForDisplay(locations);
  // 只在地圖上放有座標的
  const mappable = display.filter((l) => l.lng != null && l.lat != null);
  renderMarkers(mappable, db);
  renderLocationList(display);
  renderMobileLocationList(display);
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
 * 用 pushState 讓「返回鍵」可以關閉抽屜（hashchange 會觸發 onHashChange）。
 */
function openLocation(loc, { focusMap = true, updateHash = true } = {}) {
  showLocationDetail(loc, db);
  if (focusMap) highlightMarker(loc.id, db);
  setActiveListItem(loc.id);
  if (updateHash) {
    history.pushState(null, '', `#loc=${encodeURIComponent(loc.id)}`);
  }
}

/**
 * 解析網址 hash 深連結並套用。
 * 格式：#loc=<地點id>，或 #cat=<分類key>&q=<關鍵字>&tf=<時段,逗號分隔>。
 */
function applyDeepLink() {
  const hash = window.location.hash.replace(/^#/, '');
  let params = new URLSearchParams();
  try {
    if (hash) params = new URLSearchParams(hash);
  } catch {
    // 無法解析的 hash 視為沒有篩選條件，並清除舊狀態。
  }

  const locId = params.get('loc');
  if (locId) {
    const loc = db.getLocationById(locId);
    if (loc) openLocation(loc, { updateHash: false });
    else {
      hideDetail();
      closeInfoWindow();
    }
    return;
  }

  hideDetail();
  closeInfoWindow();
  suppressHashSync = true;
  try {
    const cat = params.get('cat');
    const cats = cat ? cat.split(',').filter((c) => CATEGORIES[c]) : [];
    applyCategoriesProgrammatic(cats, db);

    const tf = params.get('tf');
    applyTimeFiltersProgrammatic(tf ? tf.split(',') : [], db);

    const q = params.get('q') || '';
    const desktopSearch = document.getElementById('desktop-search-input');
    if (desktopSearch) desktopSearch.value = q;
    const mobileSearch = document.getElementById('mobile-search-input');
    if (mobileSearch) mobileSearch.value = q;
    setQuery(q, db);
  } finally {
    suppressHashSync = false;
  }
}

// 篩選 → hash 同步：避免深連結還原過程反向覆寫 hash
let suppressHashSync = false;

/**
 * 把目前篩選狀態寫回網址 hash（replaceState，不進瀏覽歷史），
 * 讓「週末開診的心理中心」這類篩選視圖也能直接分享。
 * 詳情抽屜開啟（#loc=）時不覆寫。
 */
function syncFilterHash() {
  if (suppressHashSync) return;
  if (window.location.hash.startsWith('#loc=')) return;

  const { query, categories, timeFilters } = getFilterSnapshot();
  const params = new URLSearchParams();
  if (categories.length > 0) params.set('cat', categories.join(','));
  if (timeFilters.length > 0) params.set('tf', timeFilters.join(','));
  if (query) params.set('q', query);

  const str = params.toString();
  const base = window.location.pathname + window.location.search;
  history.replaceState(null, '', str ? `${base}#${str}` : base);
}

/**
 * hashchange（返回鍵 / 手動改網址）：重新套用狀態。
 * 沒有 #loc 時關閉詳情抽屜 — 這讓返回鍵成為「關閉抽屜」。
 */
function onHashChange() {
  applyDeepLink();
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
    ul.innerHTML = `<li style="padding:16px 0;color:#9ca3af;font-size:13px;text-align:center">${t('no_results_list')}</li>`;
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
        ${isLocationOpenNow(loc) ? `<span class="badge-open">${t('open_now_badge')}</span>` : ''}
      </div>
      <div class="list__item-address">${escapeHtml(loc.addressZh || t('detail_addr_unknown'))}</div>
      ${therapistCount ? `<div class="list__item-count">${t('therapist_count', { n: therapistCount })}${distanceLabel(loc)}</div>` : `<div class="list__item-count">${distanceLabel(loc, true)}</div>`}
      ${loc.lng == null ? `<div class="list__item-count" style="color:#9ca3af">${t('cannot_locate')}</div>` : ''}
    `;
    makeListItemInteractive(li, loc);
    ul.appendChild(li);
  }
}

/**
 * 列表項的互動與鍵盤可及性：click + Tab 聚焦 + Enter/Space 開啟。
 */
function makeListItemInteractive(li, loc) {
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', loc.name);
  li.addEventListener('click', () => {
    openLocation(loc);
  });
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLocation(loc);
    }
  });
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
    ul.innerHTML = `<li style="padding:24px 0;color:#9ca3af;font-size:13px;text-align:center">${t('no_results_list')}</li>`;
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
        ${isLocationOpenNow(loc) ? `<span class="badge-open">${t('open_now_badge')}</span>` : ''}
      </div>
      <div class="mobile-list__item-address">${escapeHtml(loc.addressZh || t('detail_addr_unknown'))}</div>
      ${therapistCount ? `<div class="mobile-list__item-count">${t('therapist_count', { n: therapistCount })}${distanceLabel(loc)}</div>` : `<div class="mobile-list__item-count">${distanceLabel(loc, true)}</div>`}
      ${loc.lng == null ? `<div class="mobile-list__item-count" style="color:#9ca3af">${t('cannot_locate')}</div>` : ''}
    `;
    makeListItemInteractive(li, loc);
    li.addEventListener('click', () => {
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

/**
 * 頁尾來源資訊（從 data.json 的 meta 填入）。
 * 免責聲明：中文顯示 meta.note 原文，其他語言用通用翻譯。
 */
function updateFooterMeta() {
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
  if (disclaimer) {
    disclaimer.textContent = (getLang() === 'zh' && db.meta.note) ? db.meta.note : t('disclaimer_generic');
  }
}

/** 綁定語言切換器（桌面側欄 + 手機快捷條各一組，狀態互相同步） */
function bindLangSwitch() {
  document.querySelectorAll('.lang-switch__btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === getLang());
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });
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
    // 同步桌面版 Spotlight 輸入框，讓兩個版面的關鍵字一致
    const desktopSearch = document.getElementById('desktop-search-input');
    if (desktopSearch) desktopSearch.value = e.target.value;
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
  allChip.innerHTML = `<span>${t('all')}</span>`;
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
      <span>${escapeHtml(t('cat_' + catKey))}</span>`;
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
        alert(t('geo_unsupported'));
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
          alert(t('geo_failed'));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
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
 * 桌面版 Spotlight 關鍵字搜尋模態框控制邏輯。
 * ⌘K / Ctrl+K 開啟、Esc 關閉；輸入即時篩選（防抖 250ms），
 * ↑↓ 選取預覽結果、Enter 定位。
 */
function bindDesktopSpotlight() {
  const trigger = document.getElementById('desktop-search-trigger');
  const backdrop = document.getElementById('desktop-search-backdrop');
  const input = document.getElementById('desktop-search-input');
  const clearBtn = document.getElementById('desktop-search-clear');
  if (!trigger || !backdrop) return;

  const openModal = () => {
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      if (input) {
        input.focus();
        input.select();
        updateModalUiState(input.value.trim());
      }
    });
  };

  const closeModal = () => {
    backdrop.hidden = true;
  };

  trigger.addEventListener('click', openModal);
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal();
    }
  });

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

  // 輸入即時篩選（防抖，避免打字時頻繁重建 marker）
  const debouncedSearch = debounce((val) => {
    setQuery(val, db);
  }, 250);

  input?.addEventListener('input', (e) => {
    const val = e.target.value;
    updateModalUiState(val.trim());
    // 同步手機版搜尋框，讓兩個版面的關鍵字一致
    const mobileSearch = document.getElementById('mobile-search-input');
    if (mobileSearch) mobileSearch.value = val;
    debouncedSearch(val);
  });

  clearBtn?.addEventListener('click', () => {
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });

  // 鍵盤導航：ArrowUp / ArrowDown 選取預覽結果，Enter 定位
  input?.addEventListener('keydown', (e) => {
    const resultsContainer = document.getElementById('modal-search-results');
    const items = resultsContainer && !resultsContainer.hidden
      ? resultsContainer.querySelectorAll('.modal-results__item')
      : [];

    if (items.length === 0) {
      activeModalResultIndex = -1;
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeModalResultIndex++;
      if (activeModalResultIndex >= items.length) {
        activeModalResultIndex = 0; // 循環到第一個
      }
      updateSelectedModalResult(items, activeModalResultIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeModalResultIndex--;
      if (activeModalResultIndex < 0) {
        activeModalResultIndex = items.length - 1; // 循環到最後一個
      }
      updateSelectedModalResult(items, activeModalResultIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 未選取時，Enter 直接定位第一筆結果
      const index = activeModalResultIndex >= 0 ? activeModalResultIndex : 0;
      items[index].click();
      activeModalResultIndex = -1;
    }
  });
}

/**
 * 依目前關鍵字切換 Spotlight 內部區塊：
 * 無關鍵字 → 顯示操作提示；有關鍵字 → 顯示結果預覽。
 */
function updateModalUiState(query) {
  const hint = document.getElementById('search-modal-hint');
  const results = document.getElementById('modal-search-results');
  const hasQuery = Boolean(query);
  if (hint) hint.hidden = hasQuery;
  if (results) results.hidden = !hasQuery;
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
  
  // 沒有關鍵字時整區由 updateModalUiState 隱藏
  const queryInput = document.getElementById('desktop-search-input');
  if (!queryInput || !queryInput.value.trim()) {
    return;
  }

  if (locations.length === 0) {
    container.innerHTML = `
      <div class="modal-results__empty">
        ${t('modal_results_empty')}
      </div>`;
    return;
  }

  // 限制只顯示前 5 筆最相關結果，避免撐爆模態框
  const displayLocations = locations.slice(0, 5);

  const title = document.createElement('div');
  title.className = 'modal-results__title';
  title.textContent = t('modal_results_title', { n: locations.length });
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
        <span class="modal-results__badge">${t('modal_results_badge', { n: therapists.length })}</span>
        <span class="modal-results__go">${t('modal_results_locate')}</span>
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
 * 當地圖加載失敗時，渲染警告卡片替代空白，讓列表與搜尋篩選仍可正常使用
 */
function showMapLoadError(container, errorMsg) {
  if (!container) return;
  container.classList.add('map-error-state');
  container.innerHTML = `
    <div class="map-error-card">
      <div class="map-error-card__icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </div>
      <div class="map-error-card__title">${t('map_error_title')}</div>
      <div class="map-error-card__desc">
        ${t('map_error_desc')}
      </div>
      <div class="map-error-card__tech">${t('map_error_detail')}${escapeHtml(errorMsg)}</div>
      <button class="btn btn--primary map-error-card__retry" onclick="window.location.reload()">${t('map_error_retry')}</button>
    </div>
  `;
}

main();
