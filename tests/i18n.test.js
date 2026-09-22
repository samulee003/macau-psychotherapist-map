import { describe, it, expect } from 'vitest';
import { t, getLang, getDictionaries, SUPPORTED_LANGS, personName, placeName, placeAddress, formatHours } from '../src/i18n.js';

describe('i18n 字典完整性', () => {
  const dicts = getDictionaries();
  const zhKeys = Object.keys(dicts.zh).sort();

  it('支援繁中/葡/英三語', () => {
    expect(SUPPORTED_LANGS).toEqual(['zh', 'pt', 'en']);
    expect(Object.keys(dicts).sort()).toEqual(['en', 'pt', 'zh']);
  });

  it.each(['pt', 'en'])('%s 的鍵與繁中完全一致（無缺譯、無多餘鍵）', (lang) => {
    expect(Object.keys(dicts[lang]).sort()).toEqual(zhKeys);
  });

  it('所有字串非空', () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, val] of Object.entries(dicts[lang])) {
        expect(val, `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('帶佔位符的鍵在三語中佔位符一致', () => {
    const placeholders = (s) => (s.match(/\{[a-z]+\}/g) || []).sort();
    for (const key of zhKeys) {
      const zhPh = placeholders(dicts.zh[key]);
      for (const lang of ['pt', 'en']) {
        expect(placeholders(dicts[lang][key]), `${lang}.${key}`).toEqual(zhPh);
      }
    }
  });
});

describe('t()', () => {
  it('Node 環境預設繁中', () => {
    expect(getLang()).toBe('zh');
    expect(t('all')).toBe('全部');
  });

  it('佔位符替換', () => {
    expect(t('therapist_count', { n: 3 })).toBe('3 位心理治療師');
    expect(t('dist_m', { n: 850 })).toBe('850 公尺');
  });

  it('未知鍵回傳鍵名本身', () => {
    expect(t('nonexistent_key_xyz')).toBe('nonexistent_key_xyz');
  });
});

describe('語言切換時顯示的資料', () => {
  const therapist = { nameZh: '施文安', nameEn: 'ANTÓNIO AUGUSTO SIMÕES' };
  const loc = {
    name: '鏡湖醫院',
    namePt: 'HOSPITAL KIANG WU',
    addressZh: '澳門鏡湖馬路33號',
    addressPt: 'ESTRADA DO REPOUSO, N.OS 33, MACAU',
  };

  it('繁中顯示中文姓名與機構', () => {
    expect(personName(therapist, 'zh')).toBe('施文安');
    expect(placeName(loc, 'zh')).toBe('鏡湖醫院');
    expect(placeAddress(loc, 'zh')).toBe('澳門鏡湖馬路33號');
    expect(formatHours('星期一至星期六 12:30-19:30', 'zh')).toBe('星期一至星期六 12:30-19:30');
  });

  it('英文顯示外文姓名、葡文機構名，並翻譯診時', () => {
    expect(personName(therapist, 'en')).toBe('ANTÓNIO AUGUSTO SIMÕES');
    expect(placeName(loc, 'en')).toBe('HOSPITAL KIANG WU');
    expect(placeAddress(loc, 'en')).toBe('ESTRADA DO REPOUSO, N.OS 33, MACAU');
    expect(formatHours('星期一至星期六 12:30-19:30 / 星期日及公眾假期休息', 'en'))
      .toBe('Mon–Sat 12:30-19:30 / Sun and public holidays closed');
  });

  it('葡文翻譯診時，沒有葡文機構名時退回中文', () => {
    expect(formatHours('預約', 'pt')).toBe('por marcação');
    expect(placeName({ name: '盈校醫療中心' }, 'pt')).toBe('盈校醫療中心');
  });
});
