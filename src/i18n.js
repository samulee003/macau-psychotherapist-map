/* ============================================================
   i18n：繁體中文（預設）/ 葡文 / 英文
   ─ 葡文為澳門官方語言；UI 介面文案三語切換，
     資料本身（機構名、地址、診時）維持中文原文。
   ─ t(key, params)：取當前語言字串，{x} 佔位符替換，
     缺譯時回退繁中。
   ─ Node 環境（單元測試）安全：不在 import 時碰 DOM/localStorage。
   ============================================================ */

const STORAGE_KEY = 'mptm-lang';
export const SUPPORTED_LANGS = ['zh', 'pt', 'en'];

const DICT = {
  zh: {
    app_title_html: '澳門註冊心理治療師<br>執業地點地圖',
    search_trigger_placeholder: '搜尋機構、地址或治療師…',
    mh_title: '官方心理健康服務',
    mh_selftest: '自我狀態快測',
    mh_caritas: '明愛生命熱線',
    mh_ias: '社工局心理熱線',
    mh_mobile_label: '官方心理支援：',
    mh_selftest_short: '自我快測',
    mh_caritas_short: '明愛熱線',
    mh_ias_short: '社工局熱線',
    filters_type: '機構類型',
    filters_time: '服務時段',
    list_title: '執業地點',
    nearby: '附近優先',
    nearby_short: '附近',
    sorting_note: '（排序依名稱筆劃或距離，不具任何推薦或評分排名意義）',
    footer_source: '來源：',
    footer_collected: '採集：',
    footer_contact: '聯絡與修正：',
    disclaimer_generic: '本網站非官方機構，資料僅供參考，可能延遲或不完整，不構成醫療建議或轉介。',
    mobile_search_placeholder: '搜尋機構、地址或治療師…',
    desktop_search_placeholder: '搜尋機構、地址或治療師…',
    desktop_search_hint: '輸入機構名稱、地址或治療師姓名即可篩選；↑↓ 選取、Enter 定位、Esc 關閉。',
    loading_data: '載入資料中…',
    loading_failed: '資料載入失敗：',
    no_results_list: '沒有符合條件的地點',
    therapist_count: '{n} 位心理治療師',
    cannot_locate: '無法定位',
    all: '全部',
    open_now_badge: '營業中',
    modal_results_title: '執業地點快速預覽 ({n} 個結果)',
    modal_therapists_title: '符合的治療師 ({n} 位)',
    modal_results_filter: '看執業點',
    matched_therapists: '符合：{names}',
    matched_more: ' 等 {n} 位',
    modal_results_locate: '定位',
    modal_results_badge: '{n}位治療師',
    modal_results_empty: '沒有找到符合的執業地點，請換個關鍵字試試。',
    map_error_title: '地圖服務暫時無法載入',
    map_error_desc: '可能是您的網絡連接受限或底圖服務暫時繁忙。您仍可透過列表、搜尋、篩選或 AI 助理檢索資源。',
    map_error_detail: '錯誤詳情：',
    map_error_retry: '重新整理網頁',
    map_error_fallback: '無法連線至地圖服務',
    geo_unsupported: '您的瀏覽器不支援定位功能。',
    geo_failed: '無法取得您的位置。請確認已允許定位權限，或改用搜尋/篩選查找。',
    cat_hospital: '醫院',
    cat_med_center: '醫療中心',
    cat_psych_center: '心理治療中心',
    cat_social: '社會服務機構',
    cat_university: '大學',
    cat_gov: '政府機構',
    cat_other: '其他',
    tf_open_now: '現在營業',
    tf_weekend: '週末開診',
    tf_evening: '夜間開診',
    detail_nav_amap: '高德導航',
    detail_nav_google: 'Google 地圖',
    detail_copy_addr: '複製地址',
    detail_share: '分享連結',
    detail_copied: '已複製',
    detail_addr_unknown: '地址不詳',
    detail_phone: '電話',
    detail_hours: '時間',
    detail_open_now: '現在營業中',
    detail_closed_now: '目前非開診時間',
    detail_therapists_here: '此處執業的心理治療師（{n}）',
    detail_no_therapists: '暫無關聯治療師資料',
    detail_unnamed: '（未具名）',
    iw_count: '{n} 位註冊心理治療師',
    wechat_title: '跳轉提示',
    wechat_desc: '微信內置瀏覽器無法直接打開地圖 App，建議點擊右上角選擇「在瀏覽器中打開」以喚起 App。',
    wechat_open_web: '在微信內瀏覽網頁地圖',
    wechat_cancel: '取消',
    dist_m: '{n} 公尺',
    dist_km: '{n} 公里',
  },

  pt: {
    app_title_html: 'Mapa dos Psicoterapeutas<br>Registados de Macau',
    search_trigger_placeholder: 'Pesquisar instituição, morada ou terapeuta…',
    mh_title: 'Serviços oficiais de saúde mental',
    mh_selftest: 'Autoavaliação',
    mh_caritas: 'Linha Cáritas',
    mh_ias: 'Linha IAS',
    mh_mobile_label: 'Apoio oficial:',
    mh_selftest_short: 'Autoavaliação',
    mh_caritas_short: 'Cáritas',
    mh_ias_short: 'IAS',
    filters_type: 'Tipo de instituição',
    filters_time: 'Horário',
    list_title: 'Locais de exercício',
    nearby: 'Perto de mim',
    nearby_short: 'Perto',
    sorting_note: '(Ordenação por nome ou distância; não constitui recomendação nem classificação)',
    footer_source: 'Fonte: ',
    footer_collected: 'Recolha: ',
    footer_contact: 'Contacto e correcções: ',
    disclaimer_generic: 'Este sítio não é oficial. Os dados servem apenas de referência, podem estar desactualizados ou incompletos e não constituem aconselhamento médico.',
    mobile_search_placeholder: 'Pesquisar instituição, morada ou terapeuta…',
    desktop_search_placeholder: 'Pesquisar instituição, morada ou terapeuta…',
    desktop_search_hint: 'Escreva instituição, morada ou terapeuta para filtrar; ↑↓ para escolher, Enter para localizar, Esc para fechar.',
    loading_data: 'A carregar dados…',
    loading_failed: 'Falha ao carregar dados: ',
    no_results_list: 'Nenhum local corresponde aos critérios',
    therapist_count: '{n} psicoterapeuta(s)',
    cannot_locate: 'Sem localização',
    all: 'Todos',
    open_now_badge: 'Aberto',
    modal_results_title: 'Pré-visualização de locais ({n} resultados)',
    modal_therapists_title: 'Terapeutas correspondentes ({n})',
    modal_results_filter: 'Ver locais',
    matched_therapists: 'Corresponde: {names}',
    matched_more: ' e mais {n}',
    modal_results_locate: 'Localizar',
    modal_results_badge: '{n} terapeuta(s)',
    modal_results_empty: 'Nenhum local encontrado. Tente outra palavra-chave.',
    map_error_title: 'Mapa temporariamente indisponível',
    map_error_desc: 'A ligação pode estar limitada ou o serviço de mapas ocupado. Pode continuar a usar a lista, a pesquisa, os filtros ou o assistente IA.',
    map_error_detail: 'Detalhes do erro: ',
    map_error_retry: 'Recarregar a página',
    map_error_fallback: 'Não foi possível ligar ao serviço de mapas',
    geo_unsupported: 'O seu navegador não suporta geolocalização.',
    geo_failed: 'Não foi possível obter a sua localização. Verifique as permissões ou use a pesquisa/filtros.',
    cat_hospital: 'Hospital',
    cat_med_center: 'Centro médico',
    cat_psych_center: 'Centro de psicoterapia',
    cat_social: 'Instituição de serviço social',
    cat_university: 'Universidade',
    cat_gov: 'Organismo público',
    cat_other: 'Outros',
    tf_open_now: 'Aberto agora',
    tf_weekend: 'Fim-de-semana',
    tf_evening: 'Horário nocturno',
    detail_nav_amap: 'Navegar (Amap)',
    detail_nav_google: 'Google Maps',
    detail_copy_addr: 'Copiar morada',
    detail_share: 'Partilhar ligação',
    detail_copied: 'Copiado',
    detail_addr_unknown: 'Morada desconhecida',
    detail_phone: 'Telefone',
    detail_hours: 'Horário',
    detail_open_now: 'Aberto agora',
    detail_closed_now: 'Fechado neste momento',
    detail_therapists_here: 'Psicoterapeutas neste local ({n})',
    detail_no_therapists: 'Sem terapeutas associados',
    detail_unnamed: '(sem nome)',
    iw_count: '{n} psicoterapeuta(s) registado(s)',
    wechat_title: 'Aviso',
    wechat_desc: 'O navegador do WeChat não permite abrir apps de mapas. Escolha "Abrir no navegador" no canto superior direito.',
    wechat_open_web: 'Abrir o mapa web no WeChat',
    wechat_cancel: 'Cancelar',
    dist_m: '{n} m',
    dist_km: '{n} km',
  },

  en: {
    app_title_html: 'Macau Registered<br>Psychotherapist Map',
    search_trigger_placeholder: 'Search institution, address or therapist…',
    mh_title: 'Official mental health services',
    mh_selftest: 'Self-assessment',
    mh_caritas: 'Caritas hotline',
    mh_ias: 'IAS hotline',
    mh_mobile_label: 'Official support:',
    mh_selftest_short: 'Self-test',
    mh_caritas_short: 'Caritas',
    mh_ias_short: 'IAS',
    filters_type: 'Institution type',
    filters_time: 'Opening hours',
    list_title: 'Practice locations',
    nearby: 'Near me',
    nearby_short: 'Near',
    sorting_note: '(Sorted by name or distance; implies no recommendation or ranking)',
    footer_source: 'Source: ',
    footer_collected: 'Collected: ',
    footer_contact: 'Contact & corrections: ',
    disclaimer_generic: 'This is not an official site. Data is for reference only, may be delayed or incomplete, and is not medical advice or a referral.',
    mobile_search_placeholder: 'Search institution, address or therapist…',
    desktop_search_placeholder: 'Search institution, address or therapist…',
    desktop_search_hint: 'Type an institution, address or therapist to filter; ↑↓ to select, Enter to locate, Esc to close.',
    loading_data: 'Loading data…',
    loading_failed: 'Failed to load data: ',
    no_results_list: 'No locations match the filters',
    therapist_count: '{n} psychotherapist(s)',
    cannot_locate: 'No coordinates',
    all: 'All',
    open_now_badge: 'Open',
    modal_results_title: 'Location preview ({n} results)',
    modal_therapists_title: 'Matching therapists ({n})',
    modal_results_filter: 'View venues',
    matched_therapists: 'Match: {names}',
    matched_more: ' and {n} more',
    modal_results_locate: 'Locate',
    modal_results_badge: '{n} therapist(s)',
    modal_results_empty: 'No matching locations. Try another keyword.',
    map_error_title: 'Map temporarily unavailable',
    map_error_desc: 'Your connection may be restricted or the basemap service busy. The list, search, filters and AI assistant still work.',
    map_error_detail: 'Error details: ',
    map_error_retry: 'Reload page',
    map_error_fallback: 'Could not reach the map service',
    geo_unsupported: 'Your browser does not support geolocation.',
    geo_failed: 'Could not get your location. Check permissions, or use search/filters instead.',
    cat_hospital: 'Hospital',
    cat_med_center: 'Medical centre',
    cat_psych_center: 'Psychotherapy centre',
    cat_social: 'Social service organisation',
    cat_university: 'University',
    cat_gov: 'Government body',
    cat_other: 'Other',
    tf_open_now: 'Open now',
    tf_weekend: 'Weekend',
    tf_evening: 'Evening',
    detail_nav_amap: 'Navigate (Amap)',
    detail_nav_google: 'Google Maps',
    detail_copy_addr: 'Copy address',
    detail_share: 'Share link',
    detail_copied: 'Copied',
    detail_addr_unknown: 'Address unknown',
    detail_phone: 'Phone',
    detail_hours: 'Hours',
    detail_open_now: 'Open now',
    detail_closed_now: 'Closed now',
    detail_therapists_here: 'Psychotherapists here ({n})',
    detail_no_therapists: 'No associated therapists',
    detail_unnamed: '(unnamed)',
    iw_count: '{n} registered psychotherapist(s)',
    wechat_title: 'Notice',
    wechat_desc: 'WeChat’s in-app browser blocks map apps. Tap the top-right menu and choose "Open in browser".',
    wechat_open_web: 'Open web map in WeChat',
    wechat_cancel: 'Cancel',
    dist_m: '{n} m',
    dist_km: '{n} km',
  },
};

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

let currentLang = 'zh';
if (hasDom) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED_LANGS.includes(saved)) currentLang = saved;
  } catch {
    // localStorage 不可用（私隱模式等）時維持預設
  }
  // 開機即同步 <html lang>（setLang 只在切換時執行，重載時走這裡）
  if (currentLang !== 'zh') {
    document.documentElement.lang = currentLang;
  }
}

const changeListeners = [];

export function getLang() {
  return currentLang;
}

/**
 * 切換語言：持久化、更新 <html lang>、套用 data-i18n DOM、
 * 通知註冊的重繪回呼（main.js 用它重建列表與篩選 chips）。
 */
export function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang) || lang === currentLang) return;
  currentLang = lang;
  if (hasDom) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // 忽略
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-HK' : lang;
    applyI18nDom();
    document.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === lang);
    });
  }
  for (const cb of changeListeners) cb(lang);
}

/** 註冊語言變更回呼 */
export function onLangChange(cb) {
  changeListeners.push(cb);
}

/**
 * 取字串。缺譯回退繁中；{x} 佔位符以 params 替換。
 * 注意：params 值不做 HTML 跳脫，呼叫端負責先 escapeHtml。
 */
export function t(key, params) {
  let s = DICT[currentLang]?.[key] ?? DICT.zh[key];
  if (s == null) return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/**
 * 套用靜態 DOM 翻譯：
 * - [data-i18n]            → textContent
 * - [data-i18n-html]       → innerHTML（僅限字典內自有字串）
 * - [data-i18n-placeholder]→ placeholder 屬性
 * - [data-i18n-aria]       → aria-label 屬性
 */
export function applyI18nDom(root = document) {
  if (!hasDom) return;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}

/** 取字典物件（測試用：檢查各語言鍵完整性） */
export function getDictionaries() {
  return DICT;
}
