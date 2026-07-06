import { describe, it, expect } from 'vitest';
import { wgs84ToGcj02, distanceMeters, formatDistance } from '../src/geo.js';

describe('wgs84ToGcj02', () => {
  it('澳門地區的偏移量在合理範圍（數十至數百公尺級）', () => {
    // 澳門半島中心附近
    const [lng, lat] = wgs84ToGcj02(113.5439, 22.1987);
    const shift = distanceMeters(113.5439, 22.1987, lng, lat);
    expect(shift).toBeGreaterThan(10);
    expect(shift).toBeLessThan(1000);
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
