/* ============================================================
   全域設定：高德 API、機構分類、澳門地圖範圍
   ============================================================ */

/**
 * 高德地圖 JS API Key 與安全金鑰。
 *
 * 安全做法：高德 JS API 支援「網域名白名標」綁定，公開的 key 只能
 * 在指定網域使用，無法被盜用到其他網站。請在 高德開放平台 →
 * 應用管理 → 綁定網域 中加入你的部署網域（如 xxx.github.io）。
 *
 * 本地開發時填入你自己的 key；部署時改為正式 key。
 * 取得方式：https://lbs.amap.com/dev/
 */
export const AMAP_CONFIG = {
  key: '2d18f3c179911110648c3c63229da1a6',
  // securityJsCode：若 key 在高德後台綁定了網域且未開啟安全密鑰，留空即可。
  // 若開啟了安全密鑰，填入對應的 code。Web 服務類型 key 通常不需此欄。
  securityJsCode: '',
  version: '2.0',
};

/**
 * 澳門地圖初始視角。涵蓋澳門半島、氹仔、路環。
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
