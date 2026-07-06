/* ============================================================
   全域設定：機構分類、澳門地圖範圍
   ─ 地圖底圖為 MapLibre + OSM/CARTO，前端不需要任何地圖 API key。
   ─ 高德 Web 服務 key（採集腳本 geocoding 用）只存在於
     GitHub Secrets / 環境變數，與前端無關。
   ============================================================ */

/**
 * 澳門地圖初始視角（WGS-84）。涵蓋澳門半島、氹仔、路環。
 * 首次渲染後 fitToMarkers 會自動縮放到全部打點，此值僅為底圖起點。
 */
export const MACAO_VIEW = {
  center: [113.5480, 22.1610],
  zoom: 12.5,
};

/**
 * 機構分類定義。
 * label：篩選器顯示名稱；color：marker 與配色（與 styles.css --cat-* 對應）。
 */
export const CATEGORIES = {
  hospital: { label: '醫院', color: '#d64545' },
  med_center: { label: '醫療中心', color: '#e8893a' },
  psych_center: { label: '心理治療中心', color: '#2c6e7f' },
  social: { label: '社會服務機構', color: '#5b8c5a' },
  university: { label: '大學', color: '#7a5ca0' },
  gov: { label: '政府機構', color: '#6b7280' },
  other: { label: '其他', color: '#9ca3af' },
};

/** 分類中文標籤快速查 */
export const CATEGORY_LABELS = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])
);

/** 高德 Web 服務 geocoding（採集腳本用，非前端）的網域 */
export const GEOCODE_BASE = 'https://restapi.amap.com/v3/geocode/geo';
