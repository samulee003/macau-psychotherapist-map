/* ============================================================
   搜尋與篩選：依關鍵字 + 分類過濾地點，並與地圖/列表聯動
   ============================================================ */

import { CATEGORIES } from './config.js';

/** 目前生效的篩選狀態 */
const state = {
  query: '',
  activeCategories: new Set(), // 空集合 = 不篩選（全部）
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
 * 設定搜尋關鍵字。
 */
export function setQuery(query, db) {
  state.query = (query || '').trim().toLowerCase();
  emit(db);
}

/**
 * 套用目前篩選狀態，回傳符合的地點陣列。
 */
export function applyFilters(db) {
  const q = state.query;
  const cats = state.activeCategories;

  return db.locations.filter((loc) => {
    // 分類篩選
    if (cats.size > 0 && !cats.has(loc.category)) return false;

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
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach((chip) => chip.classList.remove('is-active'));
  emit(db);
}
