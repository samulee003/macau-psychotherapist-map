/* ============================================================
   應用入口：載入資料 → 初始化地圖 → 綁定 UI 互動
   ============================================================ */

import { loadData } from './data-loader.js';
import { initMap, renderMarkers, onMarkerClick, highlightMarker, closeInfoWindow, fitToMarkers } from './map.js';
import { initFilters, setQuery, selectCategoryProgrammatic, resetFiltersProgrammatic } from './search.js';
import { initDetail, showLocationDetail } from './detail.js';
import { CATEGORIES } from './config.js';

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

  // 初始化 UI 元件
  initDetail();
  initFilters(db, onFilterResult);

  // marker 點擊 → 開啟詳情 + 標記列表 active
  onMarkerClick((locationId) => {
    const loc = db.getLocationById(locationId);
    if (loc) showLocationDetail(loc, db);
    setActiveListItem(locationId);

    // 行動版點擊標記後，自動最小化側欄（收回底部），便於查看地圖與詳情抽屜
    if (window.innerWidth <= 768) {
      const sidebar = document.getElementById('sidebar');
      sidebar?.classList.remove('is-expanded');
    }
  });

  // 側欄開合
  bindSidebarToggle();
  bindSidebarResizer();

  // 首次渲染：顯示全部
  currentLocations = db.getGeocodedLocations();
  renderAll(currentLocations);

  // 初始化 Copilot 智能助理 (Agentic Chatbot)
  import('./copilot.js').then((m) => {
    m.initCopilot(db, {
      showLocationDetail: (loc) => {
        showLocationDetail(loc, db);
        highlightMarker(loc.id, db);
        setActiveListItem(loc.id);
      },
      setQuery: (query) => {
        const chatInput = document.getElementById('chat-input');
        if (chatInput) chatInput.value = query;
        setQuery(query, db);
      },
      selectCategory: (catKey) => {
        selectCategoryProgrammatic(catKey, db);
      },
      resetFilters: () => {
        resetFiltersProgrammatic(db);
      },
    });

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
  updateResultCount(locations);
  fitToMarkers(mappable);
}

/**
 * 渲染側欄地點列表。
 */
function renderLocationList(locations) {
  const ul = document.getElementById('location-list');
  const countEl = document.getElementById('list-count');
  if (countEl) countEl.textContent = `(${locations.length})`;

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
      
      // 在行動裝置上，點擊列表地點後自動最小化側欄（收回底部），以防重疊並顯現地圖與抽屜
      if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        sidebar?.classList.remove('is-expanded');
      }
    });
    ul.appendChild(li);
  }
}

function setActiveListItem(locationId) {
  document.querySelectorAll('.list__item').forEach((li) => {
    const isActive = li.dataset.locationId === locationId;
    li.classList.toggle('is-active', isActive);
    if (isActive) {
      li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function updateResultCount(locations) {
  const el = document.getElementById('search-results-count');
  if (!el) return;
  el.textContent = locations.length === 0
    ? '沒有符合的結果'
    : `顯示 ${locations.length} 個執業地點`;
}

/**
 * 側欄開合邏輯（行動裝置與桌面皆可用）。
 */
function bindSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  const openBtn = document.getElementById('sidebar-open');
  const mapContainer = document.getElementById('map-container');
  const handle = document.getElementById('sidebar-handle');
  const header = document.querySelector('.sidebar__header');

  // 桌上版與行動版通用的完全摺疊邏輯
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.add('is-collapsed');
    sidebar.classList.remove('is-expanded');
    openBtn.hidden = false;
    closeInfoWindow();
  });

  openBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.remove('is-collapsed');
    openBtn.hidden = true;
  });

  // 行動裝置專屬的底部抽屜（展開/收合最小化）切換邏輯
  const toggleMobileExpand = (e) => {
    if (window.innerWidth <= 768) {
      // 避免點擊收合按鈕時重複觸發
      if (e.target.closest('#sidebar-toggle')) return;
      sidebar.classList.toggle('is-expanded');
    }
  };

  handle?.addEventListener('click', toggleMobileExpand);
  header?.addEventListener('click', toggleMobileExpand);

  // 在行動裝置上，點擊地圖區域空白處自動最小化側欄（收回底部），提升使用者體驗
  mapContainer?.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      sidebar.classList.remove('is-expanded');
    }
  });
}

/**
 * 側欄寬度拖動調整邏輯 (Resizable Sidebar)。
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
