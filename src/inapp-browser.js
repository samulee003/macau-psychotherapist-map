/* ============================================================
   App 內置瀏覽器（In-App Browser）偵測與提示
   ------------------------------------------------------------
   Threads / Instagram / 微信 / Facebook / LINE 等 App 的內置
   WebView 對多點觸控手勢的攔截機制與系統瀏覽器不同，常導致地圖
   無法用手指縮放。由於網頁端無法強制這些 App 切換到外部瀏覽器，
   此模組會在偵測到這類環境時，顯示一個可關閉的頂部提示橫幅，
   引導使用者透過 App 選單「在瀏覽器中開啟」。
   ============================================================ */

const DISMISS_KEY = 'inapp-browser-banner-dismissed';

const UA_PATTERNS = [
  { key: 'wechat', test: /MicroMessenger/i, label: '微信' },
  { key: 'threads', test: /Threads/i, label: 'Threads' },
  { key: 'instagram', test: /Instagram/i, label: 'Instagram' },
  { key: 'facebook', test: /FBAN|FBAV/i, label: 'Facebook' },
  { key: 'line', test: /Line\//i, label: 'LINE' },
];

function detectInAppBrowser(userAgent) {
  return UA_PATTERNS.find((p) => p.test.test(userAgent)) || null;
}

/**
 * 初始化 App 內置瀏覽器提示橫幅。
 * 在偵測到 Threads / Instagram / 微信 / Facebook / LINE 等內置瀏覽器時，
 * 顯示提示（同一 session 關閉後不再重複顯示）。
 */
export function initInAppBrowserBanner() {
  const banner = document.getElementById('inapp-browser-banner');
  if (!banner) return;

  if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

  const matched = detectInAppBrowser(navigator.userAgent);
  if (!matched) return;

  const text = document.getElementById('inapp-banner-text');
  if (text) {
    text.textContent = `偵測到您正在使用${matched.label}內置瀏覽器，地圖縮放等功能可能受限。建議點擊右上角選單，選擇「在瀏覽器中開啟」以獲得完整體驗。`;
  }

  banner.hidden = false;

  const closeBtn = document.getElementById('inapp-banner-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.hidden = true;
      sessionStorage.setItem(DISMISS_KEY, '1');
    });
  }

  const copyBtn = document.getElementById('inapp-banner-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = window.location.href;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard API 在部分內置瀏覽器可能受限，退回提示使用者手動複製
        window.prompt('請手動複製以下連結，並在外部瀏覽器中開啟：', url);
        return;
      }
      const original = copyBtn.textContent;
      copyBtn.textContent = '已複製';
      setTimeout(() => {
        copyBtn.textContent = original;
      }, 2000);
    });
  }
}
