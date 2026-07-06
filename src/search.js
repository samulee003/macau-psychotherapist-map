/* ============================================================
   搜尋與篩選：依關鍵字 + 分類過濾地點，並與地圖/列表聯動
   ============================================================ */

import { CATEGORIES } from './config.js';
import { getParsedHours, isOpenAt, opensOnWeekend, opensEvening } from './hours.js';

/** 時段篩選定義（多選，AND 語意） */
export const TIME_FILTERS = {
  open_now: { label: '現在營業' },
  weekend: { label: '週末開診' },
  evening: { label: '夜間開診' },
};

/** 目前生效的篩選狀態 */
const state = {
  query: '',
  activeCategories: new Set(), // 空集合 = 不篩選（全部）
  activeTimeFilters: new Set(), // 空集合 = 不篩選時段
};

let onFilterChangeCb = null;

/**
 * 初始化篩選器 UI。
 * @param {Database} db
 * @param {(filteredLocations)=>void} onChange 篩選結果變動回呼
 */
export function initFilters(db, onChange) {
  onFilterChangeCb = onChange;

  // 找出資料中實際出現的分類（只顯示有用的 chip）
  const usedCategories = new Set(db.locations.map((l) => l.category));
  const filterList = document.getElementById('filter-list');
  if (!filterList) return;

  filterList.innerHTML = '';
  for (const catKey of Object.keys(CATEGORIES)) {
    if (!usedCategories.has(catKey)) continue;
    const cat = CATEGORIES[catKey];

    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.dataset.category = catKey;
    chip.innerHTML = `
      <span class="filter-chip__dot" style="background:${cat.color}"></span>
      <span>${cat.label}</span>`;
    chip.addEventListener('click', () => {
      toggleCategory(catKey);
      chip.classList.toggle('is-active');
      emit(db);
    });
    filterList.appendChild(chip);
  }
}

function toggleCategory(catKey) {
  if (state.activeCategories.has(catKey)) {
    state.activeCategories.delete(catKey);
  } else {
    state.activeCategories.add(catKey);
  }
}

/**
 * 初始化時段篩選 chip（可同時渲染到桌面版與手機版容器）。
 * 多選 toggle；各容器內的同名 chip 狀態互相同步。
 * @param {Database} db
 * @param {string[]} containerIds 容器元素 id 陣列
 */
export function initTimeFilters(db, containerIds) {
  for (const containerId of containerIds) {
    const container = document.getElementById(containerId);
    if (!container) continue;
    container.innerHTML = '';
    for (const [key, def] of Object.entries(TIME_FILTERS)) {
      const chip = document.createElement('button');
      chip.className = 'filter-chip filter-chip--time';
      chip.dataset.timeFilter = key;
      chip.innerHTML = `<span>${def.label}</span>`;
      chip.addEventListener('click', () => {
        toggleTimeFilter(key, db);
      });
      container.appendChild(chip);
    }
  }
}

/** 切換時段篩選並同步所有 chip 的 active 狀態 */
export function toggleTimeFilter(key, db) {
  if (state.activeTimeFilters.has(key)) {
    state.activeTimeFilters.delete(key);
  } else {
    state.activeTimeFilters.add(key);
  }
  syncTimeFilterChips();
  emit(db);
}

function syncTimeFilterChips() {
  document.querySelectorAll('[data-time-filter]').forEach((chip) => {
    chip.classList.toggle('is-active', state.activeTimeFilters.has(chip.dataset.timeFilter));
  });
}

let trackTimer = null;
function trackSearch(q) {
  if (!q) return;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => {
    if (window.va) {
      // 隱私約定：只記錄「有搜尋行為」，不上報搜尋詞內容 —
      // 心理健康網站的搜尋詞可能含姓名或敏感健康字眼
      window.va('event', { name: 'search_used' });
    }
  }, 1000); // 停止打字 1 秒後才發送事件，避免記錄無效的碎片輸入
}

/**
 * 設定搜尋關鍵字。
 */
export function setQuery(query, db) {
  state.query = (query || '').trim().toLowerCase();
  trackSearch(state.query);
  emit(db);
}

/**
 * 套用目前篩選狀態，回傳符合的地點陣列。
 */
export function applyFilters(db) {
  const q = state.query;
  const cats = state.activeCategories;
  const timeFilters = state.activeTimeFilters;
  const now = new Date();

  return db.locations.filter((loc) => {
    // 分類篩選
    if (cats.size > 0 && !cats.has(loc.category)) return false;

    // 時段篩選（診時無法解析的地點視為不符合）
    if (timeFilters.size > 0) {
      const parsed = getParsedHours(loc);
      if (timeFilters.has('open_now') && !isOpenAt(parsed, now)) return false;
      if (timeFilters.has('weekend') && !opensOnWeekend(parsed)) return false;
      if (timeFilters.has('evening') && !opensEvening(parsed)) return false;
    }

    // 關鍵字篩選：比對機構名、地址、以及該地點的治療師姓名
    if (q) {
      const inLoc =
        loc.name.toLowerCase().includes(q) ||
        (loc.addressZh || '').toLowerCase().includes(q);

      if (inLoc) return true;

      // 比對此地點關聯的治療師姓名
      const therapists = db.getTherapistsByLocation(loc.id);
      const inTherapist = therapists.some(
        (t) =>
          (t.nameZh || '').toLowerCase().includes(q) ||
          (t.nameEn || '').toLowerCase().includes(q) ||
          (t.licenseNo || '').toLowerCase().includes(q)
      );
      return inTherapist;
    }

    return true;
  });
}

/** 觸發篩選結果回呼 */
function emit(db) {
  const filtered = applyFilters(db);
  if (onFilterChangeCb) onFilterChangeCb(filtered, db);
}

/**
 * 程式化選擇分類（用於 Copilot 連動）
 */
export function selectCategoryProgrammatic(catKey, db) {
  state.activeCategories.clear();
  if (catKey && catKey !== 'all') {
    state.activeCategories.add(catKey);
  }
  // 同步 UI 上的 chips
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach((chip) => {
    if (chip.dataset.category === catKey) {
      chip.classList.add('is-active');
    } else {
      chip.classList.remove('is-active');
    }
  });
  emit(db);
}

/**
 * 程式化重置篩選（用於 Copilot 連動）
 */
export function resetFiltersProgrammatic(db) {
  state.query = '';
  state.activeCategories.clear();
  state.activeTimeFilters.clear();
  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.value = '';
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach((chip) => chip.classList.remove('is-active'));
  emit(db);
}
