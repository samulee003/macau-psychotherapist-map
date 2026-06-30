/* ============================================================
   詳情面板：顯示地點完整資訊 + 治療師列表 + 導航
   ============================================================ */

import { CATEGORIES, CATEGORY_LABELS } from './config.js';

const drawer = () => document.getElementById('detail-drawer');
const content = () => document.getElementById('detail-content');

/**
 * 顯示某地點的詳情抽屜。
 * @param {Location} loc
 * @param {Database} db
 */
export function showLocationDetail(loc, db) {
  if (!loc) return;
  const cat = CATEGORIES[loc.category] || CATEGORIES.other;
  const therapists = db.getTherapistsByLocation(loc.id);
  const amapUrl = buildAmapNavUrl(loc);
  const googleUrl = buildGoogleNavUrl(loc);

  const html = `
    <span class="detail__category" style="background:${cat.color}22;color:${cat.color}">
      ${cat.icon} ${cat.label}
    </span>
    <h2 class="detail__name">${escapeHtml(loc.name)}</h2>
    <div class="detail__address">📍 ${escapeHtml(loc.addressZh || '地址不詳')}</div>

    ${loc.phone ? row('電話', escapeHtml(loc.phone)) : ''}
    ${loc.hours ? row('時間', escapeHtml(loc.hours)) : ''}

    <div class="detail__actions">
      ${amapUrl ? `<a class="btn btn--primary" href="${amapUrl}" target="_blank" rel="noopener">🧭 高德導航</a>` : ''}
      ${googleUrl ? `<a class="btn btn--ghost" href="${googleUrl}" target="_blank" rel="noopener">🗺️ Google 地圖</a>` : ''}
      <button class="btn btn--ghost" id="copy-addr-btn">📋 複製地址</button>
    </div>

    <h3 class="detail__section-title">此處執業的心理治療師（${therapists.length}）</h3>
    <div class="therapist-list">
      ${
        therapists.length
          ? therapists.map(renderTherapist).join('')
          : '<p style="font-size:13px;color:#9ca3af;padding:8px 0">暫無關聯治療師資料</p>'
      }
    </div>`;

  content().innerHTML = html;
  drawer().hidden = false;

  // 綁定複製地址
  const copyBtn = document.getElementById('copy-addr-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(loc.addressZh || loc.name);
      copyBtn.textContent = '✓ 已複製';
      setTimeout(() => (copyBtn.textContent = '📋 複製地址'), 1500);
    });
  }
}

function renderTherapist(t) {
  return `
    <div class="therapist-card">
      <div class="therapist-card__name">
        ${escapeHtml(t.nameZh || '（未具名）')}
        ${t.licenseNo ? `<span class="therapist-card__license">${escapeHtml(t.licenseNo)}</span>` : ''}
      </div>
      ${t.nameEn ? `<div class="therapist-card__name-en">${escapeHtml(t.nameEn)}</div>` : ''}
    </div>`;
}

function row(label, value) {
  return `
    <div class="detail__row">
      <span class="detail__row-label">${label}</span>
      <span class="detail__row-value">${value}</span>
    </div>`;
}

/**
 * 構建高德導航 URI。
 * 由於 data.json 中的坐標已是由高德 API 產出的 GCJ-02 坐標，
 * 導航時不能指定 coordinate=wgs84，否則高德會進行二次偏移導致導航不準。
 */
function buildAmapNavUrl(loc) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isMobile) {
    if (loc.lng != null && loc.lat != null) {
      // 行動端：使用 marker 標記點 URI，可自動調起高德地圖原生 App
      return `https://uri.amap.com/marker?position=${loc.lng},${loc.lat}&name=${encodeURIComponent(loc.name)}&coordinate=gcj02&callnative=1`;
    }
    if (loc.addressZh) {
      return `https://uri.amap.com/search?query=${encodeURIComponent('澳門 ' + loc.name)}`;
    }
  } else {
    // 電腦網頁端：直接使用高德搜索連結，自動定位在澳門並在側邊欄展示該機構，避免了因沒有導航起點而默認退回北京的問題
    const queryParts = [];
    if (loc.name && loc.name !== '（未知名稱）') {
      queryParts.push(loc.name);
    }
    if (loc.addressZh) {
      const cleanAddr = loc.addressZh.split('二樓')[0].split('2樓')[0].split('地下')[0].trim();
      if (cleanAddr) queryParts.push(cleanAddr);
    }
    const q = '澳門 ' + queryParts.join(' ');
    return `https://www.amap.com/search?query=${encodeURIComponent(q)}`;
  }
  return '';
}

/**
 * 構建 Google Maps 導航 URI。
 * 由於高德坐標 (GCJ-02) 與 Google 澳門地圖使用的 WGS-84 存在偏差，
 * 直接傳遞座標會導致偏差。因此優先使用「機構名稱 + 地址」進行關鍵字檢索，
 * 這樣 Google Maps 能精準匹配其 POI 數據，且能直接展示該機構的地標卡片，體驗最佳。
 */
function buildGoogleNavUrl(loc) {
  const queryParts = [];
  if (loc.name && loc.name !== '（未知名稱）') {
    queryParts.push(loc.name);
  }
  if (loc.addressZh) {
    // 移除地址中可能干擾 Google 搜索的詳細門牌室號
    const cleanAddr = loc.addressZh.split('二樓')[0].split('2樓')[0].split('地下')[0].trim();
    if (cleanAddr) queryParts.push(cleanAddr);
  }
  
  if (queryParts.length > 0) {
    // 加上「澳門」前綴限制範圍
    const q = '澳門 ' + queryParts.join(' ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  
  if (loc.lng != null && loc.lat != null) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  }
  return '';
}

export function hideDetail() {
  drawer().hidden = true;
}

/** 綁定關閉按鈕 */
export function initDetail() {
  const closeBtn = document.getElementById('drawer-close');
  if (closeBtn) closeBtn.addEventListener('click', hideDetail);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
