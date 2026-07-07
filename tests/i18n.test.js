import { describe, it, expect } from 'vitest';
import { t, getLang, getDictionaries, SUPPORTED_LANGS } from '../src/i18n.js';

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
