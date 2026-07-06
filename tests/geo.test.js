import { describe, it, expect } from 'vitest';
import { wgs84ToGcj02, gcj02ToWgs84, getWgsCoords, distanceMeters, formatDistance } from '../src/geo.js';

describe('wgs84ToGcj02', () => {
  it('澳門地區的偏移量在合理範圍（數十至數百公尺級）', () => {
    // 澳門半島中心附近
    const [lng, lat] = wgs84ToGcj02(113.5439, 22.1987);
    const shift = distanceMeters(113.5439, 22.1987, lng, lat);
    expect(shift).toBeGreaterThan(10);
    expect(shift).toBeLessThan(1000);
  });
});

describe('gcj02ToWgs84', () => {
  it('往返轉換誤差小於 1 公尺（OSM 底圖顯示精度足夠）', () => {
    const orig = [113.5439, 22.1987];
    const gcj = wgs84ToGcj02(orig[0], orig[1]);
    const back = gcj02ToWgs84(gcj[0], gcj[1]);
    expect(distanceMeters(orig[0], orig[1], back[0], back[1])).toBeLessThan(1);
  });
});

describe('getWgsCoords', () => {
  it('轉換結果記憶化在 location 物件上', () => {
    const loc = { lng: 113.55, lat: 22.16 };
    const first = getWgsCoords(loc);
    expect(getWgsCoords(loc)).toBe(first); // 同一個陣列參照
    expect(first[0]).not.toBe(loc.lng); // 有實際偏移
  });

  it('缺座標回傳 null', () => {
    expect(getWgsCoords({ lng: null, lat: null })).toBeNull();
  });
});

describe('distanceMeters', () => {
  it('相同座標距離為 0', () => {
    expect(distanceMeters(113.55, 22.16, 113.55, 22.16)).toBe(0);
  });

  it('澳門半島到路氹約數公里', () => {
    // 澳門半島 (22.1987) → 路氹城 (22.145) 直線約 6 公里
    const d = distanceMeters(113.5439, 22.1987, 113.5591, 22.1455);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(8000);
  });
});

describe('formatDistance', () => {
  it('一公里內顯示公尺', () => {
    expect(formatDistance(850)).toBe('850 公尺');
  });

  it('超過一公里顯示公里（一位小數）', () => {
    expect(formatDistance(1234)).toBe('1.2 公里');
  });

  it('無效輸入回傳空字串', () => {
    expect(formatDistance(null)).toBe('');
    expect(formatDistance(Infinity)).toBe('');
  });
});
