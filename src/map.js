/* ============================================================
   地圖模組：高德 JS API 整合、marker 渲染、資訊窗、視角控制
   ============================================================ */

import AMapLoader from '@amap/amap-jsapi-loader';
import { AMAP_CONFIG, MACAO_VIEW, CATEGORIES } from './config.js';

let map = null;
let AMap = null;
let markerLayer = null;        // 目前顯示的 marker 集合
let infoWindow = null;
let onMarkerClickCb = null;    // 外部注入：marker 點擊回呼

/**
 * 初始化高德地圖。
 * @param {HTMLElement} container 地圖容器 DOM
 */
export async function initMap(container) {
  // 設定安全金鑰（高德 2.0 要求；若未啟用安全密鑰則不設）
  if (AMAP_CONFIG.securityJsCode) {
    window._AMapSecurityConfig = {
      securityJsCode: AMAP_CONFIG.securityJsCode,
    };
  }

  // 防禦：確保容器存在
  if (!container) {
    throw new Error('找不到地圖容器元素');
  }
  // 高德 SDK 偏好以「容器 id 字串」初始化（官方推薦寫法，避免 DOM 元素
  // 偵測的邊界問題）。取容器的 id；若無則回退用元素本身。
  const mapTarget = container.id || container;

  AMap = await AMapLoader.load({
    key: AMAP_CONFIG.key,
    version: AMAP_CONFIG.version,
    plugins: ['AMap.Scale', 'AMap.ToolBar'],
  });

  // 等待下一幀，確保瀏覽器已完成版面計算（避免極端時序下 container 未就緒）
  await new Promise((r) => requestAnimationFrame(() => r()));

  map = new AMap.Map(mapTarget, {
    zoom: MACAO_VIEW.zoom,
    center: MACAO_VIEW.center,
    mapStyle: 'amap://styles/whitesmoke', // 淺色底圖，凸顯 marker
    resizeEnable: true,
  });

  map.addControl(new AMap.Scale());
  // ToolBar 僅桌面顯示（行動裝置高德有原生手勢）
  map.addControl(new AMap.ToolBar({ position: 'RB', locate: false }));

  // 建立資訊窗（共用一個，點擊時填內容）
  infoWindow = new AMap.InfoWindow({
    offset: new AMap.Pixel(0, -32),
    closeWhenClickMap: true,
    autoMove: true,
  });

  return map;
}

/**
 * 產生分類 marker 的 SVG 圖示（圓點 + 類型色）。
 * 高德 Marker 的 icon 接受 data URI。
 */
function makeMarkerIcon(category) {
  const cat = CATEGORIES[category] || CATEGORIES.other;
  const color = cat.color;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 12.5 21 13 21.5a1.4 1.4 0 0 0 2 0C15.5 35 28 23.5 28 14 28 6.27 21.73 0 14 0z"
        fill="${color}" stroke="#fff" stroke-width="2"/>
      <circle cx="14" cy="14" r="5.5" fill="#fff"/>
    </svg>`;
  const uri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  return new AMap.Icon({
    image: uri,
    size: new AMap.Size(28, 36),
    imageSize: new AMap.Size(28, 36),
  });
}

/**
 * 渲染地點 marker。
 * @param {Array} locations 要顯示的地點陣列
 * @param {Database} db 資料庫（用於資訊窗顯示治療師數）
 */
export function renderMarkers(locations, db) {
  if (!map || !AMap) return;
  clearMarkers();

  markerLayer = [];
  for (const loc of locations) {
    if (loc.lng == null || loc.lat == null) continue;

    const marker = new AMap.Marker({
      position: [loc.lng, loc.lat],
      icon: makeMarkerIcon(loc.category),
      offset: new AMap.Pixel(-14, -36),
      map,
    });

    marker.on('click', () => {
      showInfoWindow(loc, db);
      if (onMarkerClickCb) onMarkerClickCb(loc.id);
    });

    marker._locationId = loc.id;
    markerLayer.push(marker);
  }
}

/** 清除目前所有 marker */
export function clearMarkers() {
  if (!markerLayer) return;
  for (const m of markerLayer) {
    map.remove(m);
  }
  markerLayer = null;
}

/**
 * 顯示地點的資訊窗（彈窗）。點擊 marker 時觸發。
 */
function showInfoWindow(loc, db) {
  const cat = CATEGORIES[loc.category] || CATEGORIES.other;
  const therapists = db.getTherapistsByLocation(loc.id);

  const content = `
    <div class="iw">
      <div class="iw__title">${escapeHtml(loc.name)}</div>
      <div class="iw__address">${escapeHtml(loc.addressZh || '')}</div>
      <div class="iw__count">${therapists.length} 位註冊心理治療師</div>
      <div class="iw__hint">點擊查看詳情</div>
    </div>`;

  infoWindow.setContent(content);
  infoWindow.open(map, [loc.lng, loc.lat]);
}

/**
 * 註冊 marker 點擊回呼（供 main.js 聯動側欄與詳情面板）。
 */
export function onMarkerClick(cb) {
  onMarkerClickCb = cb;
}

/**
 * 聚焦到某地點：移動地圖、開啟資訊窗。
 */
export function focusLocation(loc, db) {
  if (!map || loc.lng == null) return;
  map.setZoomAndCenter(15, [loc.lng, loc.lat]);
  showInfoWindow(loc, db);
}

/**
 * 高亮某 marker（側欄點擊時）：放大地圖並聚焦。
 */
export function highlightMarker(locationId, db) {
  const loc = db.getLocationById(locationId);
  if (loc) focusLocation(loc, db);
}

/** 關閉資訊窗 */
export function closeInfoWindow() {
  if (infoWindow) infoWindow.close();
}

/**
 * 讓地圖自動縮放到涵蓋所有可見 marker。
 * 當 markers 數量變化時呼叫（例如篩選後）。
 */
export function fitToMarkers(locations) {
  if (!map || !AMap) return;
  const pts = locations.filter((l) => l.lng != null).map((l) => [l.lng, l.lat]);
  if (pts.length === 0) {
    // 無可定位點，回到澳門全景
    map.setZoomAndCenter(MACAO_VIEW.zoom, MACAO_VIEW.center);
    return;
  }
  if (pts.length === 1) {
    map.setZoomAndCenter(16, pts[0]);
    return;
  }
  map.setFitView(pts.map((p) => new AMap.LngLat(p[0], p[1])), false, [60, 60, 60, 60]);
}

/** 基本HTML跳脫，避免資料含特殊字元 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
