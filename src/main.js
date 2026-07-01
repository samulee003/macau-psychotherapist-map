/* ============================================================
   應用入口：載入資料 → 初始化地圖 → 綁定 UI 互動
   ============================================================
   版面設計：
   - 桌面版：左側欄（搜尋/篩選/列表）+ 右側地圖
   - 手機版：上下分屏（地圖頂部 + 列表底部），AI 改為浮動按鈕 → 全螢幕覆蓋
   ============================================================ */

import { loadData } from './data-loader.js';
import { initMap, renderMarkers, onMarkerClick, highlightMarker, closeInfoWindow, fitToMarkers } from './map.js';
import { initFilters, setQuery, selectCategoryProgrammatic, resetFiltersProgrammatic } from './search.js';
import { initDetail, showLocationDetail } from './detail.js';
import { CATEGORIES } from './config.js';
import { initCopilot, updateModalUiState } from './copilot.js';

let db = null;
let currentLocations = []; // 目前篩選後顯示的地點

async function main() {
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

  showLoader('初始化地圖中…');

  const mapContainer = document.getElementById('map-container');
  try {
    await initMap(mapContainer);
  } catch (err) {
    console.error('地圖初始化失敗:', err);
    showLoader('地圖初始化失敗：' + err.message);
    return;
  }

  hideLoader();

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
  renderMobileFilters(db);
  bindMobileSearch();
  bindSplitHandle();
  bindAiFab();

  // marker 點擊 → 開啟詳情 + 標記列表 active
  // （手機版不再收合側欄，因為列表常駐下半屏；地圖上半屏仍可見）
  onMarkerClick((locationId) => {
    const loc = db.getLocationById(locationId);
    if (loc) showLocationDetail(loc, db);
    setActiveListItem(locationId);
  });

  // 桌面版側欄開合與大小調整
  bindSidebarToggle();
  bindSidebarResizer();
  bindDesktopSpotlight();

  // 首次渲染：顯示全部
  currentLocations = db.getGeocodedLocations();
  renderAll(currentLocations);

  // 初始化 Copilot 智能助理 (Agentic Chatbot)
  initCopilot(db, {
    showLocationDetail: (loc) => {
      showLocationDetail(loc, db);
      highlightMarker(loc.id, db);
      setActiveListItem(loc.id);
      
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
  // 只在地圖上放有座標的
  const mappable = locations.filter((l) => l.lng != null && l.lat != null);
  renderMarkers(mappable, db);
  renderLocationList(locations);
  renderMobileLocationList(locations);
  updateResultCount(locations);
  fitToMarkers(mappable);
  renderModalSearchResults(locations);
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
      </div>
      <div class="list__item-address">${escapeHtml(loc.addressZh || '地址不詳')}</div>
      ${therapistCount ? `<div class="list__item-count">${therapistCount} 位心理治療師</div>` : ''}
      ${loc.lng == null ? '<div class="list__item-count" style="color:#9ca3af">⚠ 無法定位</div>' : ''}
    `;
    li.addEventListener('click', () => {
      showLocationDetail(loc, db);
      highlightMarker(loc.id, db);
      setActiveListItem(loc.id);
    });
    ul.appendChild(li);
  }
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
      </div>
      <div class="mobile-list__item-address">${escapeHtml(loc.addressZh || '地址不詳')}</div>
      ${therapistCount ? `<div class="mobile-list__item-count">${therapistCount} 位心理治療師</div>` : ''}
      ${loc.lng == null ? '<div class="mobile-list__item-count" style="color:#9ca3af">⚠ 無法定位</div>' : ''}
    `;
    li.addEventListener('click', () => {
      showLocationDetail(loc, db);
      highlightMarker(loc.id, db);
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
  handle.addEventListener('touchstart', (e) => {
    dragging = true;
    document.body.style.userSelect = 'none';
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    if (t) {
      lastClientY = t.clientY;
      throttledSetHeight(t.clientY);
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', () => {
    if (dragging) {
      dragging = false;
      document.body.style.userSelect = '';
      // 拖曳結束時強制更新到最終位置
      setHeightFromY(lastClientY);
    }
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
}

/**
 * 渲染 Spotlight 模態框內部的即時搜尋結果清單 (桌面版專用)。
 */
function renderModalSearchResults(locations) {
  const container = document.getElementById('modal-search-results');
  if (!container) return;

  container.innerHTML = '';
  
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
  title.textContent = `🎯 執業地點快速預覽 (${locations.length} 個結果)`;
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
        <span class="modal-results__go">定位 ➔</span>
      </div>
    `;

    li.addEventListener('click', () => {
      showLocationDetail(loc, db);
      highlightMarker(loc.id, db);
      setActiveListItem(loc.id);
      
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

main();
