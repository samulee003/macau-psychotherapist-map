/* ============================================================
   詳情面板：顯示地點完整資訊 + 治療師列表 + 導航
   ============================================================ */

import { CATEGORIES } from './config.js';
import { getParsedHours, isLocationOpenNow } from './hours.js';

const drawer = () => document.getElementById('detail-drawer');
const content = () => document.getElementById('detail-content');

/**
 * 顯示某地點的詳情抽屜。
 * @param {Location} loc
 * @param {Database} db
 */
export function showLocationDetail(loc, db) {
  if (!loc) return;
  const cat = CATEGORIES[loc.category] || CATEGORIES.other;
  const therapists = db.getTherapistsByLocation(loc.id);
  const amapUrl = buildAmapNavUrl(loc);
  const googleUrl = buildGoogleNavUrl(loc);

  // 營業狀態：只有能解析診時的地點才顯示（避免誤導）
  const parsedHours = getParsedHours(loc);
  const openBadge = parsedHours
    ? (isLocationOpenNow(loc)
        ? '<span class="detail__open-badge is-open">現在營業中</span>'
        : '<span class="detail__open-badge">目前非開診時間</span>')
    : '';

  const html = `
    <span class="detail__category" style="background:${cat.color}22;color:${cat.color}">
      ${cat.label}
    </span>
    <h2 class="detail__name">${escapeHtml(loc.name)}</h2>
    <div class="detail__address">${escapeHtml(loc.addressZh || '地址不詳')}</div>

    ${loc.phone ? row('電話', `<a href="tel:${escapeHtml(loc.phone.replace(/\s/g, ''))}" class="detail__tel-link">${escapeHtml(loc.phone)}</a>`) : ''}
    ${loc.hours ? row('時間', `${escapeHtml(loc.hours)} ${openBadge}`) : ''}

    <div class="detail__actions">
      ${amapUrl ? `<button class="btn btn--primary" id="nav-amap-btn">高德導航</button>` : ''}
      ${googleUrl ? `<button class="btn btn--ghost" id="nav-google-btn">Google 地圖</button>` : ''}
      <button class="btn btn--ghost" id="copy-addr-btn">複製地址</button>
      <button class="btn btn--ghost" id="share-loc-btn">分享連結</button>
    </div>

    <h3 class="detail__section-title">此處執業的心理治療師（${therapists.length}）</h3>
    <div class="therapist-list">
      ${
        therapists.length
          ? therapists.map(renderTherapist).join('')
          : '<p style="font-size:13px;color:#9ca3af;padding:8px 0">暫無關聯治療師資料</p>'
      }
    </div>`;

  content().innerHTML = html;
  drawer().hidden = false;

  // Vercel Analytics: 統計使用者最常查看的機構或中心
  if (window.va) {
    window.va('event', {
      name: 'view_location',
      data: {
        id: loc.id,
        name: loc.name,
        category: loc.category
      }
    });
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  // 綁定高德導航（嘗試喚起 App）
  const amapBtn = document.getElementById('nav-amap-btn');
  if (amapBtn) {
    amapBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const webUrl = loc.lng != null && loc.lat != null
        ? `https://uri.amap.com/marker?position=${loc.lng},${loc.lat}&name=${encodeURIComponent(loc.name)}&coordinate=gcj02&callnative=1`
        : buildAmapNavUrl(loc);

      if (isWeChat) {
        showWeChatToast(webUrl);
        return;
      }

      if (isMobile && loc.lng != null && loc.lat != null) {
        const schemeUrl = `amapuri://route/plan/?dlat=${loc.lat}&dlon=${loc.lng}&dname=${encodeURIComponent(loc.name)}&dev=0&t=0`;
        window.location.href = schemeUrl;
        
        const start = Date.now();
        setTimeout(() => {
          if (Date.now() - start < 2000) {
            window.open(webUrl, '_blank');
          }
        }, 1500);
      } else {
        window.open(webUrl, '_blank');
      }
    });
  }

  // 綁定 Google 地圖導航（嘗試喚起 App）
  const googleBtn = document.getElementById('nav-google-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const queryParts = [];
      if (loc.name && loc.name !== '（未知名稱）') {
        queryParts.push(loc.name);
      }
      if (loc.addressZh) {
        const cleanAddr = loc.addressZh.split('二樓')[0].split('2樓')[0].split('地下')[0].trim();
        if (cleanAddr) queryParts.push(cleanAddr);
      }
      const q = '澳門 ' + (queryParts.length > 0 ? queryParts.join(' ') : `${loc.lat},${loc.lng}`);
      const webUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

      if (isWeChat) {
        showWeChatToast(webUrl);
        return;
      }

      if (isMobile) {
        const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const schemeUrl = isiOS 
          ? `comgooglemaps://?q=${encodeURIComponent(q)}`
          : `geo:0,0?q=${encodeURIComponent(q)}`;
        
        window.location.href = schemeUrl;
        
        const start = Date.now();
        setTimeout(() => {
          if (Date.now() - start < 2000) {
            window.open(webUrl, '_blank');
          }
        }, 1500);
      } else {
        window.open(webUrl, '_blank');
      }
    });
  }

  // 綁定複製地址
  const copyBtn = document.getElementById('copy-addr-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyText(loc.addressZh || loc.name, copyBtn, '複製地址');
    });
  }

  // 綁定分享連結：複製指向此地點的深連結（#loc=<id>），
  // 供社工/老師/親友直接轉介特定機構
  const shareBtn = document.getElementById('share-loc-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const shareUrl = `${window.location.origin}${window.location.pathname}#loc=${encodeURIComponent(loc.id)}`;
      // 行動端優先使用系統分享面板
      if (navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        navigator.share({ title: loc.name, url: shareUrl }).catch(() => {
          copyText(shareUrl, shareBtn, '分享連結');
        });
      } else {
        copyText(shareUrl, shareBtn, '分享連結');
      }
    });
  }
}

/** 複製文字並在按鈕上顯示回饋 */
function copyText(text, btn, restoreLabel) {
  const onDone = () => {
    if (btn) {
      btn.textContent = '已複製';
      setTimeout(() => (btn.textContent = restoreLabel), 1500);
    }
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(onDone)
      .catch((err) => {
        console.error('Failed to copy via Clipboard API: ', err);
        fallbackCopy(text, btn, restoreLabel);
      });
  } else {
    fallbackCopy(text, btn, restoreLabel);
  }
}

function renderTherapist(t) {
  // 優先使用中文名，無中文名則使用英文名，只保留其一以維護隱私；同時展示其執業牌照號碼
  const name = t.nameZh || t.nameEn || '（未具名）';
  return `
    <div class="therapist-card">
      <div class="therapist-card__name">
        ${escapeHtml(name)}
        ${t.licenseNo ? `<span class="therapist-card__license">${escapeHtml(t.licenseNo)}</span>` : ''}
      </div>
    </div>`;
}

function row(label, value) {
  return `
    <div class="detail__row">
      <span class="detail__row-label">${label}</span>
      <span class="detail__row-value">${value}</span>
    </div>`;
}

/**
 * 構建高德導航 URI。
 * 由於 data.json 中的坐標已是由高德 API 產出的 GCJ-02 坐標，
 * 導航時不能指定 coordinate=wgs84，否則高德會進行二次偏移導致導航不準。
 */
function buildAmapNavUrl(loc) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isMobile) {
    if (loc.lng != null && loc.lat != null) {
      // 行動端：使用 marker 標記點 URI，可自動調起高德地圖原生 App
      return `https://uri.amap.com/marker?position=${loc.lng},${loc.lat}&name=${encodeURIComponent(loc.name)}&coordinate=gcj02&callnative=1`;
    }
    if (loc.addressZh) {
      return `https://uri.amap.com/search?query=${encodeURIComponent('澳門 ' + loc.name)}`;
    }
  } else {
    // 電腦網頁端：直接使用高德搜索連結，自動定位在澳門並在側邊欄展示該機構，避免了因沒有導航起點而默認退回北京的問題
    const queryParts = [];
    if (loc.name && loc.name !== '（未知名稱）') {
      queryParts.push(loc.name);
    }
    if (loc.addressZh) {
      const cleanAddr = loc.addressZh.split('二樓')[0].split('2樓')[0].split('地下')[0].trim();
      if (cleanAddr) queryParts.push(cleanAddr);
    }
    const q = '澳門 ' + queryParts.join(' ');
    return `https://www.amap.com/search?query=${encodeURIComponent(q)}`;
  }
  return '';
}

/**
 * 構建 Google Maps 導航 URI。
 * 由於高德坐標 (GCJ-02) 與 Google 澳門地圖使用的 WGS-84 存在偏差，
 * 直接傳遞座標會導致偏差。因此優先使用「機構名稱 + 地址」進行關鍵字檢索，
 * 這樣 Google Maps 能精準匹配其 POI 數據，且能直接展示該機構的地標卡片，體驗最佳。
 */
function buildGoogleNavUrl(loc) {
  const queryParts = [];
  if (loc.name && loc.name !== '（未知名稱）') {
    queryParts.push(loc.name);
  }
  if (loc.addressZh) {
    // 移除地址中可能干擾 Google 搜索的詳細門牌室號
    const cleanAddr = loc.addressZh.split('二樓')[0].split('2樓')[0].split('地下')[0].trim();
    if (cleanAddr) queryParts.push(cleanAddr);
  }
  
  if (queryParts.length > 0) {
    // 加上「澳門」前綴限制範圍
    const q = '澳門 ' + queryParts.join(' ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  
  if (loc.lng != null && loc.lat != null) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
  }
  return '';
}

export function hideDetail() {
  drawer().hidden = true;
  // 清除深連結 hash（若有），避免重新整理時又打開已關閉的詳情
  if (window.location.hash.startsWith('#loc=')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

/** 綁定關閉按鈕 */
export function initDetail() {
  const closeBtn = document.getElementById('drawer-close');
  if (closeBtn) closeBtn.addEventListener('click', hideDetail);
}

function fallbackCopy(text, btn, restoreLabel) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (btn && successful) {
      btn.textContent = '已複製';
      setTimeout(() => (btn.textContent = restoreLabel), 1500);
    }
  } catch (err) {
    console.error('Fallback copy failed: ', err);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showWeChatToast(webUrl) {
  let overlay = document.getElementById('wechat-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'wechat-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(15, 23, 42, 0.75)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '10000';
    overlay.style.padding = '24px';
    overlay.style.boxSizing = 'border-box';
    
    overlay.innerHTML = `
      <div style="background: #ffffff; padding: 28px 24px; border-radius: 16px; max-width: 320px; width: 100%; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center;">
        <h4 style="margin: 0 0 8px; color: #2c6e7f; font-size: 16px; font-weight: 700; letter-spacing: -0.025em;">跳轉提示</h4>
        <p style="margin: 0 0 20px; color: #64748b; font-size: 13px; line-height: 1.5;">微信內置瀏覽器無法直接打開地圖 App，建議點擊右上角選擇<strong>「在瀏覽器中打開」</strong>以喚起 App。</p>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button id="wechat-btn-web" style="background: #2c6e7f; color: #ffffff; border: none; padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s; width: 100%;">在微信內瀏覽網頁地圖</button>
          <button id="wechat-btn-close" style="background: #f1f5f9; color: #64748b; border: none; padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%;">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  
  overlay.style.display = 'flex';
  
  document.getElementById('wechat-btn-web').onclick = () => {
    overlay.style.display = 'none';
    window.location.href = webUrl;
  };
  
  document.getElementById('wechat-btn-close').onclick = () => {
    overlay.style.display = 'none';
  };
}
