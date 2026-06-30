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
 */
function buildAmapNavUrl(loc) {
  if (loc.lng != null && loc.lat != null) {
    return `https://uri.amap.com/navigation?to=${loc.lng},${loc.lat},${encodeURIComponent(loc.name)}&mode=walk&coordinate=wgs84&callnative=1`;
  }
  if (loc.addressZh) {
    return `https://uri.amap.com/navigation?to=${encodeURIComponent(loc.addressZh)}&mode=walk&callnative=1`;
  }
  return '';
}

/**
 * 構建 Google Maps 導航 URI。
 */
function buildGoogleNavUrl(loc) {
  if (loc.lng != null && loc.lat != null) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  }
  if (loc.addressZh) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.addressZh)}`;
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
