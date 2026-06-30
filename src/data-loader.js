/* ============================================================
   資料載入與索引：建立 therapist↔location 的雙向查詢索引
   ============================================================ */

/**
 * 載入 data.json 並建立查詢索引。
 * @returns {Promise<Database>} 結構化資料 + 查詢方法
 */
export async function loadData() {
  const res = await fetch('./data/data.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`無法載入資料（HTTP ${res.status}）`);
  }
  const raw = await res.json();
  return buildDatabase(raw);
}

/**
 * 將原始 JSON 轉為帶索引的 Database 物件。
 *
 * Database 提供以下查詢：
 * - getTherapistsByLocation(locationId)：某地點的所有治療師
 * - getLocationsByTherapist(therapistId)：某治療師的所有執業點
 * - getLocationById(id) / getTherapistById(id)
 * - locations / therapists / practices（原始陣列）
 */
export function buildDatabase(raw) {
  const therapists = raw.therapists || [];
  const locations = raw.locations || [];
  const practices = raw.practices || [];
  const meta = raw.meta || {};

  // 索引：id → 物件
  const therapistMap = new Map(therapists.map((t) => [t.id, t]));
  const locationMap = new Map(locations.map((l) => [l.id, l]));

  // 索引：locationId → therapistId[]
  const locToTherapists = new Map();
  // 索引：therapistId → locationId[]
  const therapistToLocs = new Map();

  for (const p of practices) {
    if (!locToTherapists.has(p.locationId)) locToTherapists.set(p.locationId, []);
    locToTherapists.get(p.locationId).push(p.therapistId);

    if (!therapistToLocs.has(p.therapistId)) therapistToLocs.set(p.therapistId, []);
    therapistToLocs.get(p.therapistId).push(p.locationId);
  }

  return {
    meta,
    therapists,
    locations,
    practices,

    getTherapistById(id) {
      return therapistMap.get(id) || null;
    },
    getLocationById(id) {
      return locationMap.get(id) || null;
    },
    /** 回傳某地點的所有治療師（已過濾不存在的） */
    getTherapistsByLocation(locationId) {
      const ids = locToTherapists.get(locationId) || [];
      return ids.map((id) => therapistMap.get(id)).filter(Boolean);
    },
    /** 回傳某治療師的所有執業地點（已過濾不存在的） */
    getLocationsByTherapist(therapistId) {
      const ids = therapistToLocs.get(therapistId) || [];
      return ids.map((id) => locationMap.get(id)).filter(Boolean);
    },
    /** 可定位的地點（有座標者） */
    getGeocodedLocations() {
      return locations.filter((l) => l.lng != null && l.lat != null);
    },
    /** 無法定位的地點（缺座標），仍要展示，不丟失 */
    getUnmappableLocations() {
      return locations.filter((l) => l.lng == null || l.lat == null);
    },
  };
}
