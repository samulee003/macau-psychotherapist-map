import { describe, it, expect } from 'vitest';
import { buildDatabase } from '../src/data-loader.js';

const raw = {
  meta: { collectedAt: '2026-07-01' },
  therapists: [
    { id: 'T1', nameZh: '陳醫生', licenseNo: 'PI-0001' },
    { id: 'T2', nameZh: '黃醫生', licenseNo: 'PI-0002' },
  ],
  locations: [
    { id: 'L1', name: '乙中心', category: 'psych_center', lng: 113.55, lat: 22.16 },
    { id: 'L2', name: '甲診所', category: 'med_center', lng: null, lat: null },
  ],
  practices: [
    { therapistId: 'T1', locationId: 'L1' },
    { therapistId: 'T2', locationId: 'L1' },
    { therapistId: 'T1', locationId: 'L2' },
  ],
};

describe('buildDatabase', () => {
  const db = buildDatabase(raw);

  it('建立雙向索引', () => {
    expect(db.getTherapistsByLocation('L1').map((t) => t.id).sort()).toEqual(['T1', 'T2']);
    expect(db.getLocationsByTherapist('T1').map((l) => l.id).sort()).toEqual(['L1', 'L2']);
  });

  it('id 查詢', () => {
    expect(db.getLocationById('L2').name).toBe('甲診所');
    expect(db.getTherapistById('T9')).toBeNull();
  });

  it('區分可定位與不可定位地點', () => {
    expect(db.getGeocodedLocations().map((l) => l.id)).toEqual(['L1']);
    expect(db.getUnmappableLocations().map((l) => l.id)).toEqual(['L2']);
  });

  it('地點按名稱筆劃排序（客觀、不偏私）', () => {
    const names = db.locations.map((l) => l.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
  });
});
