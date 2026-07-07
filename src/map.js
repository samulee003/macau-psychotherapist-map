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
import { t } from './i18n.js';

let map = null;
let markerLayer = null;        // 目前顯示的 DOM Marker 集合
let popup = null;              // 共用資訊窗
let onMarkerClickCb = null;    // 外部注入：marker 點擊回呼
let userMarker = null;         // 「離我最近」的使用者定位點

// 聚合（cluster）狀態：41 個地點大半集中在澳門半島，低縮放時
// pin 會疊成一團無法點選。用 MapLibre 的 GeoJSON cluster 引擎計算
// 聚合，再以 DOM marker 呈現（單點 = SVG pin、聚合 = 數字圓點），
// 避免 symbol 圖層對 glyphs 服務的依賴。
const CLUSTER_SOURCE_ID = 'locations-cluster';
let clusterSourceReady = false;
let currentLocations = [];     // renderMarkers 傳入的地點（含座標）
let currentDb = null;
let locationById = new Map();

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
    // style.load 只等樣式 JSON（內嵌，必定快速），不等底圖磚 —
    // 磚被牆/離線時聚合與 marker 仍要照常運作
    if (map.isStyleLoaded()) {
      setupClusterSource();
      done();
    } else {
      map.on('style.load', () => {
        setupClusterSource();
        done();
      });
    }
    setTimeout(done, 8000);
  });

  return map;
}

/**
 * 建立聚合資料來源（須在 style.load 後）。
 * 若樣式始終未就緒（極端情境），維持無聚合的平鋪 marker。
 */
function setupClusterSource() {
  if (!map || clusterSourceReady || map.getSource(CLUSTER_SOURCE_ID)) return;
  map.addSource(CLUSTER_SOURCE_ID, {
    type: 'geojson',
    data: buildFeatureCollection(currentLocations),
    cluster: true,
    clusterRadius: 45,
    clusterMaxZoom: 14, // z15 起完全散開；focusLocation 的 zoom=15 恰可見單點
  });
  // 隱形 layer：沒有 layer 引用的 source，MapLibre 不會載入其 tile，
  // querySourceFeatures 會永遠回空陣列。半徑 0 的 circle layer 只為
  // 觸發聚合計算，實際呈現全靠 DOM marker。
  map.addLayer({
    id: `${CLUSTER_SOURCE_ID}-ghost`,
    type: 'circle',
    source: CLUSTER_SOURCE_ID,
    paint: { 'circle-radius': 0, 'circle-opacity': 0 },
  });
  clusterSourceReady = true;

  // 視角變動或聚合計算完成時，同步 DOM marker
  map.on('moveend', updateVisibleMarkers);
  map.on('sourcedata', (e) => {
    if (e.sourceId === CLUSTER_SOURCE_ID && map.isSourceLoaded(CLUSTER_SOURCE_ID)) {
      updateVisibleMarkers();
    }
  });
  updateVisibleMarkers();
}

function buildFeatureCollection(locations) {
  return {
    type: 'FeatureCollection',
    features: (locations || [])
      .map((loc) => {
        const coords = getWgsCoords(loc);
        if (!coords) return null;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords },
          properties: { id: loc.id, category: loc.category },
        };
      })
      .filter(Boolean),
  };
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
 * 渲染地點 marker（聚合感知）。
 * @param {Array} locations 要顯示的地點陣列
 * @param {Database} db 資料庫（用於資訊窗顯示治療師數）
 */
export function renderMarkers(locations, db) {
  currentLocations = locations || [];
  currentDb = db;
  locationById = new Map(currentLocations.map((l) => [l.id, l]));
  if (!map) return;

  if (clusterSourceReady) {
    map.getSource(CLUSTER_SOURCE_ID).setData(buildFeatureCollection(currentLocations));
    updateVisibleMarkers();
  } else {
    renderFlatMarkers();
  }
}

/** 無聚合 fallback：每個地點一個 pin（style 未載入時使用） */
function renderFlatMarkers() {
  clearMarkers();
  markerLayer = [];
  for (const loc of currentLocations) {
    const coords = getWgsCoords(loc);
    if (!coords) continue;
    markerLayer.push(addPinMarker(loc, coords));
  }
}

/**
 * 依聚合引擎目前的計算結果同步 DOM marker：
 * 聚合 → 數字圓點（點擊放大展開）；單點 → SVG pin。
 */
function updateVisibleMarkers() {
  if (!map || !clusterSourceReady) return;

  const features = map.querySourceFeatures(CLUSTER_SOURCE_ID);
  clearMarkers();
  markerLayer = [];

  const seen = new Set();
  for (const f of features) {
    const props = f.properties;
    if (props.cluster) {
      if (seen.has(`c${props.cluster_id}`)) continue;
      seen.add(`c${props.cluster_id}`);
      markerLayer.push(addClusterMarker(f));
    } else {
      if (seen.has(props.id)) continue;
      seen.add(props.id);
      const loc = locationById.get(props.id);
      if (loc) markerLayer.push(addPinMarker(loc, f.geometry.coordinates));
    }
  }
}

/** 單一地點的 SVG pin marker */
function addPinMarker(loc, coords) {
  const el = makeMarkerElement(loc.category);
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat(coords)
    .addTo(map);

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    showInfoWindow(loc, currentDb);
    if (onMarkerClickCb) onMarkerClickCb(loc.id);
  });

  marker._locationId = loc.id;
  return marker;
}

/** 聚合圓點 marker：顯示數量，點擊放大到展開層級 */
function addClusterMarker(feature) {
  const count = feature.properties.point_count;
  const clusterId = feature.properties.cluster_id;
  const coords = feature.geometry.coordinates;

  const el = document.createElement('div');
  el.className = 'map-cluster';
  if (count >= 10) el.classList.add('map-cluster--lg');
  el.textContent = String(count);

  const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat(coords)
    .addTo(map);

  el.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const zoom = await map.getSource(CLUSTER_SOURCE_ID).getClusterExpansionZoom(clusterId);
      map.flyTo({ center: coords, zoom: zoom + 0.3, duration: 500 });
    } catch {
      map.flyTo({ center: coords, zoom: map.getZoom() + 2, duration: 500 });
    }
  });

  return marker;
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
 * 手機版不顯示 — 底部詳情抽屜會同步開啟，popup 只會與抽屜
 * 資訊重複並遮擋上半屏地圖。
 */
function showInfoWindow(loc, db) {
  if (!map || !popup) return;
  if (window.matchMedia('(max-width: 768px)').matches) return;
  const coords = getWgsCoords(loc);
  if (!coords) return;

  const therapists = db.getTherapistsByLocation(loc.id);
  const content = `
    <div class="iw">
      <div class="iw__title">${escapeHtml(loc.name)}</div>
      <div class="iw__address">${escapeHtml(loc.addressZh || '')}</div>
      <div class="iw__count">${t('iw_count', { n: therapists.length })}</div>
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
