/* ============================================================
   地理工具：距離計算與座標系轉換
   ─ data.json 的座標由高德 geocoding 產出，屬 GCJ-02 座標系；
     地圖底圖（MapLibre + OSM）與瀏覽器 Geolocation 都是 WGS-84。
     顯示與距離計算前必須把資料座標轉為 WGS-84（gcj02ToWgs84），
     否則澳門地區有數十至數百米偏差。
   ─ 例外：高德導航 URL（detail.js）仍需原始 GCJ-02 座標，
     勿把 data.json 的座標就地覆寫。
   ============================================================ */

import { t } from './i18n.js';

const PI = Math.PI;
const A = 6378245.0; // 克拉索夫斯基橢球長半軸
const EE = 0.00669342162296594323; // 偏心率平方

function transformLat(lng, lat) {
  let ret =
    -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((lat / 12.0) * PI) + 320 * Math.sin((lat * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(lng, lat) {
  let ret =
    300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((lng / 12.0) * PI) + 300.0 * Math.sin((lng / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02（標準公開演算法）。澳門在轉換適用範圍內。
 * @returns {[number, number]} [lng, lat]
 */
export function wgs84ToGcj02(lng, lat) {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/**
 * GCJ-02 → WGS-84（迭代反算：正向轉換無封閉逆式，
 * 以殘差修正迭代 3 輪即收斂到公分級，遠高於底圖顯示精度）。
 * @returns {[number, number]} [lng, lat]
 */
export function gcj02ToWgs84(lng, lat) {
  let wlng = lng;
  let wlat = lat;
  for (let i = 0; i < 3; i++) {
    const [glng, glat] = wgs84ToGcj02(wlng, wlat);
    wlng += lng - glng;
    wlat += lat - glat;
  }
  return [wlng, wlat];
}

/**
 * 取地點的 WGS-84 座標（記憶化掛在 location 物件上）。
 * data.json 的 lng/lat 為 GCJ-02，顯示於 OSM 底圖或與
 * Geolocation 座標比較前須經此轉換。
 * @param {Object} loc data.json 的 location
 * @returns {[number, number]|null}
 */
export function getWgsCoords(loc) {
  if (loc.lng == null || loc.lat == null) return null;
  if (!loc._wgs) {
    loc._wgs = gcj02ToWgs84(loc.lng, loc.lat);
  }
  return loc._wgs;
}

/**
 * Haversine 距離（公尺）。兩點需在同一座標系。
 */
export function distanceMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const toRad = (d) => (d * PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 距離顯示：850 公尺 / 1.2 公里（單位文案走 i18n） */
export function formatDistance(meters) {
  if (meters == null || !isFinite(meters)) return '';
  if (meters < 1000) return t('dist_m', { n: Math.round(meters) });
  return t('dist_km', { n: (meters / 1000).toFixed(1) });
}
