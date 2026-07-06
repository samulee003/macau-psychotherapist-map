import { describe, it, expect } from 'vitest';
import { parseHours, isOpenAt, opensOnWeekend, opensEvening } from '../src/hours.js';

// 建立指定星期與時刻的 Date（2026-07-05 是星期日）
function at(day, hh, mm) {
  const base = new Date(2026, 6, 5 + day); // day: 0=日, 1=一 …
  base.setHours(hh, mm, 0, 0);
  return base;
}

describe('parseHours', () => {
  it('解析單日單時段', () => {
    const g = parseHours('星期六 13:00-20:00');
    expect(g).toEqual([{ days: [6], ranges: [[780, 1200]] }]);
  });

  it('解析日期範圍與多時段', () => {
    const g = parseHours('星期一至星期五 09:00-13:00,15:00-19:00');
    expect(g).toHaveLength(1);
    expect(g[0].days).toEqual([1, 2, 3, 4, 5]);
    expect(g[0].ranges).toEqual([
      [540, 780],
      [900, 1140],
    ]);
  });

  it('「星期一至星期日」展開為整週', () => {
    const g = parseHours('星期一至星期日 10:00-21:00');
    expect(g[0].days).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('知道開診日但無具體時段（預約制）', () => {
    const g = parseHours('星期一至星期六 預約');
    expect(g[0].days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g[0].ranges).toEqual([]);
  });

  it('無法解析的文字回傳 null', () => {
    expect(parseHours('')).toBeNull();
    expect(parseHours(null)).toBeNull();
    expect(parseHours('暫未提供資料')).toBeNull();
    expect(parseHours('由工作單位安排診症時間')).toBeNull();
  });
});

describe('isOpenAt', () => {
  const g = parseHours('星期一至星期五 09:00-13:00,15:00-19:00');

  it('營業時段內為 true', () => {
    expect(isOpenAt(g, at(1, 10, 0))).toBe(true); // 星期一 10:00
    expect(isOpenAt(g, at(5, 18, 59))).toBe(true); // 星期五 18:59
  });

  it('午休與收診後為 false', () => {
    expect(isOpenAt(g, at(1, 13, 30))).toBe(false); // 午休
    expect(isOpenAt(g, at(1, 19, 0))).toBe(false); // 收診（不含迄）
  });

  it('非開診日為 false', () => {
    expect(isOpenAt(g, at(6, 10, 0))).toBe(false); // 星期六
    expect(isOpenAt(g, at(0, 10, 0))).toBe(false); // 星期日
  });

  it('null 解析結果為 false', () => {
    expect(isOpenAt(null, at(1, 10, 0))).toBe(false);
  });
});

describe('opensOnWeekend', () => {
  it('星期六有開診為 true', () => {
    expect(opensOnWeekend(parseHours('星期六 09:00-13:00'))).toBe(true);
  });

  it('一至日整週開診包含週末', () => {
    expect(opensOnWeekend(parseHours('星期一至星期日 09:00-19:00'))).toBe(true);
  });

  it('預約制但知道星期六開診亦為 true', () => {
    expect(opensOnWeekend(parseHours('星期一至星期六 預約'))).toBe(true);
  });

  it('平日為 false', () => {
    expect(opensOnWeekend(parseHours('星期一至星期五 09:00-18:00'))).toBe(false);
    expect(opensOnWeekend(null)).toBe(false);
  });
});

describe('opensEvening', () => {
  it('18:00 後仍開診為 true', () => {
    expect(opensEvening(parseHours('星期六 13:00-20:00'))).toBe(true);
    expect(opensEvening(parseHours('星期四至星期五 18:00-19:00'))).toBe(true);
  });

  it('18:00 準時收診為 false', () => {
    expect(opensEvening(parseHours('星期一至星期五 09:00-18:00'))).toBe(false);
    expect(opensEvening(null)).toBe(false);
  });
});
