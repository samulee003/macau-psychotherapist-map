/* ============================================================
   地圖模組：MapLibre GL + OSM/CARTO 光柵底圖
   ─ 免 API key、無網域白名單、底圖為 WGS-84 無座標偏移。
   ─ data.json 座標為 GCJ-02（高德 geocoding 產出），渲染前
     一律經 getWgsCoords() 轉為 WGS-84（見 geo.js）。
   ─ 對外介面與舊高德版完全相同：initMap / renderMarkers /
     onMarkerClick / highlightMarker / closeInfoWindow /
     fitToMarkers / showUserLocation / hideUserLocation。
   ============================================================ */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MACAO_VIEW, CATEGORIES } from './config.js';
import { getWgsCoords } from './geo.js';

let map = null;
let markerLayer = null;        // 目前顯示的 Marker 集合
let popup = null;              // 共用資訊窗
let onMarkerClickCb = null;    // 外部注入：marker 點擊回呼
let userMarker = null;         // 「離我最近」的使用者定位點

// 底圖：CARTO Positron（基於 OSM 的淺色底圖，凸顯 marker；
// 免 key，須保留 attribution）。CARTO 掛掉時瀏覽器只會缺磚，
// 不影響 marker 與其他功能。
const BASEMAP_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};

/**
 * 初始化地圖。
 * @param {HTMLElement} container 地圖容器 DOM
 */
export async function initMap(container) {
  if (!container) {
    throw new Error('找不到地圖容器元素');
  }

  map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: MACAO_VIEW.center,
    zoom: MACAO_VIEW.zoom,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }));

  popup = new maplibregl.Popup({
    offset: 38,
    closeButton: true,
    closeOnClick: true,
    maxWidth: '280px',
  });

  // 等待樣式就緒；個別底圖磚載入失敗不阻擋（marker 不依賴底圖），
  // 8 秒逾時亦放行讓其餘功能照常運作
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    map.on('load', done);
    setTimeout(done, 8000);
  });

  return map;
}

/**
 * 產生分類 marker 的 DOM 元素（SVG 圓點 pin + 類型色）。
 */
function makeMarkerElement(category) {
  const cat = CATEGORIES[category] || CATEGORIES.other;
  const el = document.createElement('div');
  el.className = 'map-marker';
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 12.5 21 13 21.5a1.4 1.4 0 0 0 2 0C15.5 35 28 23.5 28 14 28 6.27 21.73 0 14 0z"
        fill="${cat.color}" stroke="#fff" stroke-width="2"/>
      <circle cx="14" cy="14" r="5.5" fill="#fff"/>
    </svg>`;
  return el;
}

/**
 * 渲染地點 marker。
 * @param {Array} locations 要顯示的地點陣列
 * @param {Database} db 資料庫（用於資訊窗顯示治療師數）
 */
export function renderMarkers(locations, db) {
  if (!map) return;
  clearMarkers();

  markerLayer = [];
  for (const loc of locations) {
    const coords = getWgsCoords(loc);
    if (!coords) continue;

    const el = makeMarkerElement(loc.category);
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(coords)
      .addTo(map);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
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
    m.remove();
  }
  markerLayer = null;
}

/**
 * 顯示地點的資訊窗（彈窗）。點擊 marker 時觸發。
 */
function showInfoWindow(loc, db) {
  if (!map || !popup) return;
  const coords = getWgsCoords(loc);
  if (!coords) return;

  const therapists = db.getTherapistsByLocation(loc.id);
  const content = `
    <div class="iw">
      <div class="iw__title">${escapeHtml(loc.name)}</div>
      <div class="iw__address">${escapeHtml(loc.addressZh || '')}</div>
      <div class="iw__count">${therapists.length} 位註冊心理治療師</div>
    </div>`;

  popup.setLngLat(coords).setHTML(content).addTo(map);
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
  if (!map) return;
  const coords = getWgsCoords(loc);
  if (!coords) return;
  map.flyTo({ center: coords, zoom: 15, duration: 700 });
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
  if (popup) popup.remove();
}

/**
 * 顯示使用者目前位置（藍點）。座標為 WGS-84（Geolocation 原生值）。
 * @param {[number, number]} lngLat
 */
export function showUserLocation(lngLat) {
  if (!map) return;
  hideUserLocation();
  const el = document.createElement('div');
  el.className = 'map-user-dot';
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="10" fill="#2563eb" fill-opacity="0.2"/>
      <circle cx="11" cy="11" r="5.5" fill="#2563eb" stroke="#fff" stroke-width="2"/>
    </svg>`;
  userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat(lngLat)
    .addTo(map);
}

/** 移除使用者定位點 */
export function hideUserLocation() {
  if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }
}

/**
 * 讓地圖自動縮放到涵蓋所有可見 marker。
 * 當 markers 數量變化時呼叫（例如篩選後）。
 */
export function fitToMarkers(locations) {
  if (!map) return;
  const coordsList = (locations || []).map((l) => getWgsCoords(l)).filter(Boolean);

  if (coordsList.length === 0) {
    // 無可定位點，回到澳門全景
    map.flyTo({ center: MACAO_VIEW.center, zoom: MACAO_VIEW.zoom, duration: 600 });
    return;
  }
  if (coordsList.length === 1) {
    map.flyTo({ center: coordsList[0], zoom: 16, duration: 600 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const c of coordsList) bounds.extend(c);
  map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 600 });
}

/** 基本HTML跳脫，避免資料含特殊字元 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
