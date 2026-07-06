/* ============================================================
   AI 智能助理 (Copilot) v2 — 薄代理架構
   ============================================================
   v2 設計：
   - 預設「免 Key」：直接呼叫自家 /api/copilot 薄代理（Vercel
     serverless function 代管 DEEPSEEK_API_KEY），使用者無需設定任何金鑰。
   - 進階「自帶 Key」：使用者可在設定面板填入自己的 Deepseek Key，
     瀏覽器直連 Deepseek，不經代理。
   - Agent loop + 9 個工具 + 工具執行全在瀏覽器；代理只代轉請求。
   - 支援短期對話記憶（chatHistory 滾動窗口）。
   ============================================================ */

import { CATEGORIES } from './config.js';
import { getParsedHours, isOpenAt, opensOnWeekend, opensEvening } from './hours.js';

let database = null;
let controls = {};

// 記憶模組：儲存短期對話歷史
let chatHistory = [];

// 站台專屬設定：強制走自家薄代理（免 Key 模式）
const settings = {
  useOwnKey: false,
  apiKey: '',
  model: 'deepseek-chat'
};

/**
 * 初始化 Copilot 控制面板
 * @param {Database} db
 * @param {Object} ctrlControl 控制 UI 的回呼函式
 */
export function initCopilot(db, ctrlControl) {
  database = db;
  controls = ctrlControl;

  setupDom();
  bindEvents();
}

function setupDom() {
  const container = document.getElementById('copilot-sidebar-container');
  if (!container) return;

  container.innerHTML = `
    <!-- 輸入區域與控制按鈕 -->
    <div class="search-ai__input-row">
      <div class="search__wrapper">
        <span class="search-ai__sparkle" style="display: flex; align-items: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-primary);">
            <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
            <rect x="9" y="9" width="6" height="6"></rect>
            <line x1="9" y1="1" x2="9" y2="4"></line>
            <line x1="15" y1="1" x2="15" y2="4"></line>
            <line x1="9" y1="20" x2="9" y2="23"></line>
            <line x1="15" y1="20" x2="15" y2="23"></line>
            <line x1="20" y1="9" x2="23" y2="9"></line>
            <line x1="20" y1="15" x2="23" y2="15"></line>
            <line x1="1" y1="9" x2="4" y2="9"></line>
            <line x1="1" y1="15" x2="4" y2="15"></line>
          </svg>
        </span>
        <input
          id="chat-input"
          class="search__input"
          type="text"
          placeholder="搜尋或問問 AI 智能助理..."
          autocomplete="off"
          aria-label="輸入 AI 智能助理問題"
        />
        <button id="chat-send" class="search-ai__send-btn" aria-label="傳送">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
      <div class="search-ai__actions">
        <button id="chat-clear-btn" class="search-ai__action-btn" title="清除對話歷史" aria-label="清除對話歷史">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    </div>

    <!-- 建議提問與熱門搜尋（初始顯示；桌面 Spotlight 與手機覆蓋層共用） -->
    <div id="modal-suggested-tips" class="modal-tips">
      <div class="modal-tips__title">推薦詢問 AI 助理：</div>
      <ul class="modal-tips__list">
        <li class="modal-tips__item" data-query="我有焦慮情緒，官方有自我評估檢測或諮詢熱線嗎？">我有焦慮情緒，官方有自我評估檢測或諮詢熱線嗎？</li>
        <li class="modal-tips__item" data-query="衛生局社區衛生中心提供免費心理諮詢嗎？">衛生局社區衛生中心提供免費心理諮詢嗎？</li>
        <li class="modal-tips__item" data-query="幫我找星期六下午開診的心理中心">幫我找星期六下午開診的心理中心</li>
      </ul>
    </div>

    <!-- 搜尋結果快速預覽（輸入時顯示，桌面版專用） -->
    <div id="modal-search-results" class="modal-results" hidden></div>

    <!-- 對話記錄 -->
    <div id="chat-messages" class="chat-messages"></div>
    
    <!-- 搜尋結果筆數 -->
    <div id="search-results-count" class="search__count"></div>

    <!-- AI 免責聲明 -->
    <div class="search-ai__disclaimer">
      AI 助理回覆由人工智慧生成，僅供學習參考。最新與權威資訊請務必以衛生局官方登載為準。
    </div>
  `;


}

function bindEvents() {
  const clearBtn = document.getElementById('chat-clear-btn');
  const sendBtn = document.getElementById('chat-send');
  const chatInput = document.getElementById('chat-input');

  // 簡易的防抖函數 (Debounce)
  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // 推薦提問點擊事件
  const tipsList = document.getElementById('modal-suggested-tips');
  tipsList?.addEventListener('click', (e) => {
    const item = e.target.closest('.modal-tips__item');
    if (item) {
      const query = item.dataset.query;
      if (chatInput) {
        chatInput.value = query;
        // 觸發輸入框的 input 事件以同步過濾
        const event = new Event('input', { bubbles: true });
        chatInput.dispatchEvent(event);
        // 直接發送
        triggerSend();
      }
    }
  });

  // 搜尋與 AI 助理連動：打字時即時過濾（防抖 250ms 防止頻繁重建 Marker 崩潰）
  const debouncedSearch = debounce((val) => {
    controls.setQuery(val);
  }, 250);

  chatInput?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    updateModalUiState(val);
    debouncedSearch(e.target.value);
  });
  // 清除對話歷史 (Memory)
  clearBtn?.addEventListener('click', () => {
    clearChatMemory();
    addMessage('system', '已清除對話歷史，助理記憶已重置。');
  });

  // 發送訊息
  const triggerSend = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    // 發送 AI 訊息前，也順便重置即時過濾（回歸正常對話控制模式）
    const event = new Event('input', { bubbles: true });
    chatInput.dispatchEvent(event);
    
    handleUserMsg(text);
  };

  sendBtn?.addEventListener('click', triggerSend);
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerSend();
    }
  });


}

function clearChatMemory() {
  chatHistory = [];
  const container = document.getElementById('chat-messages');
  if (container) {
    container.innerHTML = '';
    const parent = container.closest('.search-ai');
    if (parent) {
      parent.classList.remove('has-messages');
    }
  }
  const chatInput = document.getElementById('chat-input');
  updateModalUiState(chatInput ? chatInput.value.trim() : '');
}

export function formatAssistantMessage(text) {
  if (!text) return '';
  // 1. 先對原始輸入進行 HTML 跳脫以完全阻斷 XSS 漏洞
  let escaped = escapeHtml(text);
  // 2. 安全地支援 **粗體** Markdown
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // 3. 安全地支援換行
  escaped = escaped.replace(/\n/g, '<br>');
  return escaped;
}

function addMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const parent = container.closest('.search-ai');
  if (parent) {
    parent.classList.add('has-messages');
  }

  const msg = document.createElement('div');
  msg.className = `chat-message chat-message--${sender}`;
  msg.innerHTML = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;

  const chatInput = document.getElementById('chat-input');
  updateModalUiState(chatInput ? chatInput.value.trim() : '');
}

async function handleUserMsg(text) {
  // 對使用者提問進行跳脫後顯示
  addMessage('user', escapeHtml(text));

  const container = document.getElementById('chat-messages');
  const loader = document.createElement('div');
  loader.className = 'chat-message chat-message--assistant chat-message--loading';
  loader.innerHTML = '<span class="loading-dots">思考中<span>.</span><span>.</span><span>.</span></span>';
  container.appendChild(loader);
  container.scrollTop = container.scrollHeight;

  try {
    let result = null;

    try {
      // 嘗試 AI（自家代理或自帶 Key 直連）
      result = await runDeepseekAgentLoop(text);

      // 成功獲得 API 回應後，將當前對話輪次寫入 Memory (歷史記錄)
      // 為避免記憶膨脹，只存純文字回覆（reply）
      chatHistory.push({ role: 'user', content: text });
      chatHistory.push({ role: 'assistant', content: result.reply });

      // 限制記憶深度，保留最新 10 條訊息 (5 個完整往返) 以防 Token 溢出
      if (chatHistory.length > 10) {
        chatHistory.shift();
        chatHistory.shift();
      }
      
      // 格式化 AI 回覆（XSS 防護 + Markdown 解析）
      result.reply = formatAssistantMessage(result.reply);
    } catch (apiErr) {
      console.warn('AI API 呼叫失敗，將降級為本地規則引擎:', apiErr);
      // 降級為本地規則引擎作為 Fallback
      const localResult = parseLocalAgent(text);
      const formattedLocal = formatAssistantMessage(localResult.reply);
      result = {
        reply: `${formattedLocal}<br><small style="color:#94a3b8;display:block;margin-top:4px">已切換至本地離線搜尋模式（AI 服務目前不可用）</small>`,
        actions: localResult.actions
      };
    }

    loader.remove();
    executeAgentActions(result.actions || []);
    addMessage('assistant', result.reply);
  } catch (err) {
    console.error('Agent 執行失敗:', err);
    loader.remove();
    addMessage('assistant', `處理請求時發生錯誤：${escapeHtml(err.message)}<br><small style="color:#94a3b8;display:block;margin-top:4px">AI 服務暫時無法使用。您仍可使用地圖的搜尋與篩選功能查找資料。</small>`);
  }
}

function parseLocalAgent(text) {
  const t = text.toLowerCase();
  const result = { reply: '', actions: [] };

  if (t.includes('全部') || t.includes('清除') || t.includes('重置') || t.includes('還原')) {
    result.reply = '已為您重置所有篩選條件，展示全部執業地點。';
    result.actions.push({ type: 'reset', value: true });
    chatHistory = []; // 清空記憶
    return result;
  }

  if (t.includes('統計') || t.includes('人數') || t.includes('多少人') || t.includes('多少位') || t.includes('規模')) {
    const stats = database.meta?.stats || { therapists: database.therapists.length, locations: database.locations.length, practices: database.practices.length };
    result.reply = `目前地圖共收錄了 <strong>${stats.therapists}</strong> 位完全註冊的心理治療師（不計實習生），分佈在 <strong>${stats.locations}</strong> 個執業地點，共有 <strong>${stats.practices}</strong> 個執業關聯。`;
    return result;
  }

  const catMatches = [
    { key: 'hospital', keywords: ['醫院', 'hospital'] },
    { key: 'med_center', keywords: ['醫療中心', '診所', '綜合治療中心', '綜合診療所', '綜合診所'] },
    { key: 'psych_center', keywords: ['心理治療中心', '心理中心', '心理輔導'] },
    { key: 'social', keywords: ['社會服務', '協會', '總會', '團契', '怡樂軒', '薈穗社'] },
    { key: 'university', keywords: ['大學', '大學大馬路', '澳大', '學院'] },
    { key: 'gov', keywords: ['市政署', '社工局', '衛生局', '公共醫療', '政府'] }
  ];

  for (const m of catMatches) {
    if (m.keywords.some(k => t.includes(k))) {
      const catLabel = getCategoryLabel(m.key);
      result.reply = `已為您篩選出 <strong>${catLabel}</strong> 類別的執業點。`;
      result.actions.push({ type: 'filter_category', value: m.key });
      return result;
    }
  }

  for (const loc of database.locations) {
    if (t.includes(loc.name.toLowerCase()) || loc.name.toLowerCase().includes(t)) {
      result.reply = `已在地圖上為您找到 <strong>${escapeHtml(loc.name)}</strong>，並已為您開啟了詳情抽屜。`;
      result.actions.push({ type: 'select_location', value: loc.id });
      return result;
    }
  }

  for (const th of database.therapists) {
    if (t.includes(th.nameZh) || (th.nameEn && t.includes(th.nameEn.toLowerCase()))) {
      result.reply = `已搜尋到治療師 <strong>${escapeHtml(th.nameZh)}</strong> (${th.licenseNo})。已為您篩選出其所在的執業地點。`;
      result.actions.push({ type: 'search', value: th.nameZh });
      return result;
    }
  }

  result.reply = `已為您在數據庫中搜尋關鍵字：『<strong>${escapeHtml(text)}</strong>』。`;
  result.actions.push({ type: 'search', value: text });
  return result;
}

/* ============================================================
   原生函數調用 (Native Function Calling) 工具定義與調度器
   ─ 用於 Deepseek 的 Agentic 模式：LLM 可多步調用工具並觀察結果
   ============================================================ */

/**
 * Deepseek 原生函數調用可用的工具清單。
 * 分為兩類：
 *   - 資料查詢工具：回傳結構化資料給 LLM 觀察（不直接操控 UI）
 *   - UI 行動工具：收集成 actions，最後統一執行
 */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_dataset_overview',
      description: '取得整個資料庫的統計概覽：治療師總數、地點總數、各分類的地點數量、執業關聯總數。用於回答「有多少」「統計」「規模」等問題。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_locations',
      description: '以關鍵字搜尋執業地點（比對機構名稱與地址），回傳符合的地點清單（含 id、名稱、地址、分類）。用於查詢特定機構資訊。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜尋關鍵字（機構名稱或地址片段）' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_therapists',
      description: '以關鍵字搜尋心理治療師（比對中文姓名、外文姓名、牌照號），回傳符合的治療師及其執業地點。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜尋關鍵字（姓名或牌照號）' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_location_detail',
      description: '以地點 id 查詢某地點的完整資訊：名稱、地址、電話、診症時間、分類，以及在此執業的所有治療師清單。',
      parameters: {
        type: 'object',
        properties: {
          location_id: { type: 'string', description: '地點 id（如 loc_189fe1c5）' }
        },
        required: ['location_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_therapist_detail',
      description: '以治療師 id 查詢某治療師的完整資訊：姓名、牌照號、外文名，以及其所有執業地點清單。',
      parameters: {
        type: 'object',
        properties: {
          therapist_id: { type: 'string', description: '治療師 id（如 T_be324e50）' }
        },
        required: ['therapist_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_open_locations',
      description: '依開診時段查詢執業地點：now=此刻營業中、weekend=週末（星期六/日）有開診、evening=夜間（18:00 後）有開診。回傳符合的地點清單（含 id、名稱、分類、完整診時文字），可再依 hours 文字進一步判斷具體時段。診時未公開或無法解析的地點不會出現在結果中。',
      parameters: {
        type: 'object',
        properties: {
          when: { type: 'string', enum: ['now', 'weekend', 'evening'], description: '時段條件' }
        },
        required: ['when']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'filter_category',
      description: '【UI 行動】在介面上篩選特定機構分類並高亮對應篩選鈕。可選值：hospital、med_center、psych_center、social、university、gov、all。',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['hospital', 'med_center', 'psych_center', 'social', 'university', 'gov', 'all'], description: '要篩選的分類 key' }
        },
        required: ['category']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_map',
      description: '【UI 行動】在搜尋欄填入關鍵字，對機構名稱、地址、治療師姓名進行模糊過濾並更新地圖。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要填入搜尋欄的關鍵字' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'select_location',
      description: '【UI 行動】讓地圖平滑飛越至指定地點，並開啟該地點的詳細資訊面板。需先以 search_locations 或 get_location_detail 確認 id。',
      parameters: {
        type: 'object',
        properties: {
          location_id: { type: 'string', description: '要選取的地點 id' }
        },
        required: ['location_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reset_filters',
      description: '【UI 行動】清除所有搜尋字詞與分類篩選，重置地圖視角，還原全部打點。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }
];

/**
 * 執行單一工具呼叫。
 * - 查詢類工具：回傳 JSON 字串供 LLM 觀察。
 * - UI 行動類工具：將 action 推入 pendingActions，回傳確認訊息。
 */
function dispatchTool(name, args, pendingActions) {
  const a = args || {};
  switch (name) {
    case 'get_dataset_overview': {
      const stats = database.meta?.stats || {
        therapists: database.therapists.length,
        locations: database.locations.length,
        practices: database.practices.length
      };
      const byCategory = {};
      for (const loc of database.locations) {
        byCategory[loc.category] = (byCategory[loc.category] || 0) + 1;
      }
      return JSON.stringify({
        therapists: stats.therapists,
        locations: stats.locations,
        practices: stats.practices,
        locationsByCategory: byCategory,
        collectedAt: database.meta?.collectedAt || '未知'
      });
    }
    case 'search_locations': {
      const kw = (a.keyword || '').trim().toLowerCase();
      if (!kw) return JSON.stringify({ results: [], note: '未提供關鍵字' });
      const results = database.locations
        .filter(l =>
          (l.name || '').toLowerCase().includes(kw) ||
          (l.addressZh || '').toLowerCase().includes(kw)
        )
        .map(l => ({ id: l.id, name: l.name, address: l.addressZh, category: l.category }));
      return JSON.stringify({ results });
    }
    case 'search_therapists': {
      const kw = (a.keyword || '').trim().toLowerCase();
      if (!kw) return JSON.stringify({ results: [], note: '未提供關鍵字' });
      const results = database.therapists
        .filter(t =>
          (t.nameZh || '').toLowerCase().includes(kw) ||
          (t.nameEn || '').toLowerCase().includes(kw) ||
          (t.licenseNo || '').toLowerCase().includes(kw)
        )
        .map(t => {
          const locs = database.getLocationsByTherapist(t.id).map(l => ({ id: l.id, name: l.name }));
          return { id: t.id, nameZh: t.nameZh, nameEn: t.nameEn, licenseNo: t.licenseNo, locations: locs };
        });
      return JSON.stringify({ results });
    }
    case 'get_location_detail': {
      const loc = database.getLocationById(a.location_id);
      if (!loc) return JSON.stringify({ error: '找不到此地點 id' });
      const therapists = database.getTherapistsByLocation(loc.id).map(t => ({
        nameZh: t.nameZh, nameEn: t.nameEn, licenseNo: t.licenseNo
      }));
      return JSON.stringify({
        id: loc.id, name: loc.name, address: loc.addressZh,
        category: loc.category, phone: loc.phone || '', hours: loc.hours || '',
        therapistCount: therapists.length, therapists
      });
    }
    case 'get_therapist_detail': {
      const t = database.getTherapistById(a.therapist_id);
      if (!t) return JSON.stringify({ error: '找不到此治療師 id' });
      const locs = database.getLocationsByTherapist(t.id).map(l => ({
        id: l.id, name: l.name, address: l.addressZh, category: l.category
      }));
      return JSON.stringify({
        id: t.id, nameZh: t.nameZh, nameEn: t.nameEn,
        licenseNo: t.licenseNo, status: t.status, locations: locs
      });
    }
    case 'find_open_locations': {
      const when = a.when;
      const now = new Date();
      const results = database.locations
        .filter((l) => {
          const parsed = getParsedHours(l);
          if (!parsed) return false;
          if (when === 'now') return isOpenAt(parsed, now);
          if (when === 'weekend') return opensOnWeekend(parsed);
          if (when === 'evening') return opensEvening(parsed);
          return false;
        })
        .map((l) => ({ id: l.id, name: l.name, category: l.category, hours: l.hours || '' }));
      return JSON.stringify({ when, count: results.length, results });
    }
    case 'filter_category':
      pendingActions.push({ type: 'filter_category', value: a.category });
      return JSON.stringify({ confirmed: true, action: 'filter_category', category: a.category });
    case 'search_map':
      pendingActions.push({ type: 'search', value: a.query });
      return JSON.stringify({ confirmed: true, action: 'search', query: a.query });
    case 'select_location': {
      const loc = database.getLocationById(a.location_id);
      if (!loc) return JSON.stringify({ error: '找不到此地點 id，無法選取' });
      pendingActions.push({ type: 'select_location', value: a.location_id });
      return JSON.stringify({ confirmed: true, action: 'select_location', locationId: a.location_id, name: loc.name });
    }
    case 'reset_filters':
      pendingActions.push({ type: 'reset', value: true });
      return JSON.stringify({ confirmed: true, action: 'reset' });
    default:
      return JSON.stringify({ error: `未知工具：${name}` });
  }
}

function getSystemInstruction() {
  // 精簡地點索引：只給 id|名稱|分類，電話/診時/地址由查詢工具按需取得，
  // 大幅降低每輪請求的 token 消耗
  const locationsIndex = database.locations
    .map(l => `${l.id}|${l.name}|${l.category}`)
    .join('\n');

  // v2：統計數字動態讀取，避免資料更新後硬編碼過時
  const stats = database.meta?.stats || {
    therapists: database.therapists.length,
    locations: database.locations.length,
    practices: database.practices.length
  };

  return `
你現在是澳門心理治療師地圖 (Macau Psychotherapist Map) 的 AI 智能助理。
你的目標是協助使用者解答疑問，並通過調用工具來控制地圖界面與過濾診所。
你必須只使用繁體中文(zh-Hant)回答。
你擁有「對話歷史記憶」，能看到先前的對話歷史與執行的指令。

【資料庫現狀】
- 完全註冊心理治療師：${stats.therapists}位（無實習生，所有牌照都是 PI 開頭）
- 地點數量：${stats.locations}處
- 總執業關聯數：${stats.practices}個
- 資料採集日期：${database.meta?.collectedAt || '未知'}
- 地點索引（格式：id|名稱|分類）。電話、地址、診症時間請調用 get_location_detail 查詢，不要憑索引猜測：
${locationsIndex}

【操作地圖與 UI 的指南】
當你需要進行以下操作時，請務必調用對應的工具：
1. 篩選某個機構分類：調用 filter_category
2. 模糊搜尋地圖上的文字：調用 search_map
3. 在地圖上選取特定地點、開啟詳情抽屜並定位：調用 select_location（需要提供地點 id）
4. 重置篩選條件、還原全部打點：調用 reset_filters
5. 查「現在營業 / 週末開診 / 夜間開診」的地點：調用 find_open_locations（結果含完整診時文字，可再細判具體時段）
6. 查某地點的電話、地址、診時、治療師名單：調用 get_location_detail

【回傳格式要求】
請以友善、自然的繁體中文回覆使用者，**不要回傳 any JSON 格式的內容**。你的最終回覆會直接以 HTML/Markdown 形式在聊天視窗中展示給使用者看。
當你調用了 UI 行動工具（例如 select_location）後，請在最終回覆中親切地告訴使用者你已經在畫面上為他們選取或篩選了該地點。

【行為規範】
- 如果使用者在上一次提問之後問「它的電話是多少」或「在哪裡」，請根據對話歷史判斷指的是哪一家機構，並調用 "select_location"！
- 不要虛構任何不存在的醫療機構，始終基於事實回覆。
- **個人隱私保護規則**：當你向使用者介紹或列出心理治療師的姓名時，請優先展示其「中文姓名」，若無中文姓名才展示其「英文/外文姓名」，你【必須絕對禁止同時展示中文與外文姓名】，但你可以展示其執業牌照號碼（如 PI-XXXX），以方便市民進行官方即時查詢。
- **絕對禁止使用任何 Emoji (Absolute Ban)**：為了保持醫療諮詢的嚴肅性、專業度與介面的高級感（Anti-Slop），你必須在回覆中【完全禁止使用任何表情符號 (Emoji)】，包括但不限於 😊, 🏥, 🧠, 💬, 📞 等。你的整個回覆內容中不得出現任何一個 Emoji。所有列表、項目、標題與段落必須使用純文字與 Markdown 符號（如 - 或 1.）進行排版，絕不能有表情符號。

【常見市民查詢解答指引】
1. **官方心理自我評測與求助管道**：
   - 當使用者提到焦慮、抑鬱、失眠、心理困擾或壓力時，請主動提供衛生局的**「自我心理狀態快測」**網址：[https://www.ssm.gov.mo/portal1/mentalhealth/kzJY9ECgaLx4vv83tK3eA?lang=ch](https://www.ssm.gov.mo/portal1/mentalhealth/kzJY9ECgaLx4vv83tK3eA?lang=ch)。
   - 情緒危機緊急求助：告知使用者可撥打**明愛 24 小時生命熱線：2852 5222**，或**社會工作局 24 小時心理諮詢熱線：2826 1126**，或前往仁伯爵綜合醫院（山頂醫院）急診。
2. **四級聯防精神衛生服務模式與地圖匹配限制**：
   若市民詢問公立或政府心理服務，請向其介紹澳門「四級聯防、四環緊扣」服務，但【必須特別注意地圖資料庫的匹配限制】：
   - **地圖資料限制**：由於地圖主要收錄「私人醫務活動」的心理治療師執業地點，因此【地圖上不包含各公立社區衛生中心】（如黑沙環衛生中心、氹仔衛生中心等）。你【絕對不能】為社區衛生中心調用 \`select_location\` 工具，應引導市民直接攜帶身份證前往其所屬轄區的社區衛生中心掛號，預約第三級的「心理保健門診」服務。
   - **第一、二級 (社區支援/專項服務)**：由民間社團（如地圖上的「婦聯心理治療中心」）提供，此類機構已收錄於地圖中，你可以調用 \`select_location\` 為其定位。
   - **第四級 (專科醫療)**：仁伯爵綜合醫院（山頂醫院）精神科，提供專科治療。地圖中收錄了代表山頂醫院的「澳門公共醫療機構」（若憲馬路 339 號），你可以調用 \`select_location\` 為其定位。
3. **週末/假日開診**：
   - 調用 \`find_open_locations\`（when=weekend）取得週末有開診的機構，需要更細的時段（如「星期六下午」）時根據回傳的 hours 文字再判斷。向使用者列出這些機構，並主動調用 \`select_location\` 幫使用者定位其中一間。
4. **夜間服務（晚上 18:00 後）**：
   - 調用 \`find_open_locations\`（when=evening）取得夜間仍開診的機構，向使用者列出並說明各自的收診時間。
5. **學生/青少年支援**：
   - 大專院校（category: university，如澳門大學等）設有學生專屬的心理輔導中心。社會服務機構（category: social，如「薈穗社」）也針對青少年藥物依賴或心理健康提供支援。

【重要安全提示】
AI 助理的回覆僅供參考，不代替任何醫療診斷或治療。如遇嚴重情緒困擾，應主動尋求專業醫療或致電明愛生命熱線 2852 5222 或社工局熱線 2826 1126 諮詢。
`;
}

/**
 * Deepseek 原生函數調用 Agentic 迴圈。
 *
 * 這是真正的 Agent 模式：LLM 可多步調用工具、觀察工具回傳的資料，
 * 再決定下一步。流程：
 *   1. 組裝 messages（system + 歷史記憶 + 最新使用者訊息）
 *   2. 呼叫 Deepseek（經自家薄代理 /api/copilot，或自帶 Key 直連），帶上 tools 定義
 *   3. 若回應含 tool_calls → 逐一執行工具（查詢類回傳資料、UI 類收集 action），
 *      把工具結果以 role=tool 附加回 messages，回到步驟 2（最多 MAX_STEPS 輪）
 *   4. 若回應為最終文字 → 取出 reply，連同收集到的 actions 一併回傳
 *
 * v2 端點切換：
 *   - 預設（免 Key）：POST /api/copilot（薄代理代管 Key）
 *   - 自帶 Key：POST https://api.deepseek.com/v1/chat/completions（瀏覽器直連）
 *
 * 記憶（chatHistory）只參與「使用者意圖」的上下文連貫；工具呼叫的
 * 中間過程（tool_calls / tool results）不寫入長期記憶，避免記憶膨脹。
 */
async function runDeepseekAgentLoop(userMsg) {
  const MAX_STEPS = 6; // 最多 6 輪工具調用，防止無限迴圈
  const modelName = settings.model || 'deepseek-chat';

  // v2：根據是否自帶 Key 決定端點與 Authorization
  const useOwnKey = settings.useOwnKey && settings.apiKey;
  const endpoint = useOwnKey
    ? 'https://api.deepseek.com/v1/chat/completions'
    : '/api/copilot';
  const headers = { 'Content-Type': 'application/json' };
  if (useOwnKey) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
  }

  const systemInstruction = getSystemInstruction();

  // 以「歷史記憶 + 當前訊息」為起點；工具中間結果會動態附加在此陣列
  const messages = [
    { role: 'system', content: systemInstruction },
    ...chatHistory.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMsg }
  ];

  const pendingActions = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI 服務請求失敗 (HTTP ${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('無效的 AI 服務回應');

    const msg = choice.message;
    // 將這一輪的 assistant 訊息（含可能的 tool_calls）納入上下文
    messages.push(msg);

    // 沒有 tool_calls → 最終回覆，結束迴圈
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      let reply = msg.content || '（已為您處理完畢。）';

      // JSON 解析 Fallback 確保相容性
      try {
        const trimmed = reply.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          const parsed = JSON.parse(trimmed);
          if (parsed.reply) {
            reply = parsed.reply;
            if (Array.isArray(parsed.actions)) {
              for (const act of parsed.actions) {
                pendingActions.push(act);
              }
            }
          }
        }
      } catch (e) {
        // 解析失敗，保留原始 reply 內容
      }

      return { reply, actions: pendingActions };
    }

    // 有 tool_calls → 逐一執行工具，並把結果以 role=tool 回填
    for (const call of msg.tool_calls) {
      const fnName = call.function?.name;
      let fnArgs = {};
      try {
        fnArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (e) {
        fnArgs = {};
      }
      const toolResult = dispatchTool(fnName, fnArgs, pendingActions);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolResult
      });
    }
    // 繼續下一輪，讓 LLM 觀察工具結果後決定是否再呼叫工具或給出最終回覆
  }

  // 超過最大步數仍未給出最終回覆：回傳已收集的行動 + 提示
  return {
    reply: '已完成查詢與操作（達到工具調用步數上限）。' +
      (pendingActions.length ? ' 已執行的操作將顯示於地圖上。' : ''),
    actions: pendingActions
  };
}

function executeAgentActions(actions) {
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'filter_category':
          controls.selectCategory(action.value);
          break;
        case 'search':
          controls.setQuery(action.value);
          break;
        case 'select_location':
          const loc = database.getLocationById(action.value);
          if (loc) {
            controls.showLocationDetail(loc);
          }
          break;
        case 'reset':
          controls.resetFilters();
          break;
        default:
          console.warn('未知的 Agent Action:', action);
      }
    } catch (e) {
      console.error('執行 Action 失敗:', action, e);
    }
  }
}

function getCategoryLabel(key) {
  return CATEGORIES[key]?.label || key;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 更新搜尋/AI 面板元件顯示狀態（桌面 Spotlight 與手機 AI 覆蓋層共用）。
 * 用於切換：Suggested Tips -> Search Results -> Chat Messages
 * 手機版也顯示推薦提問 — 否則 AI 覆蓋層初始是一整屏空白。
 */
export function updateModalUiState(query) {
  const tips = document.getElementById('modal-suggested-tips');
  const results = document.getElementById('modal-search-results');
  const chat = document.getElementById('chat-messages');

  const hasMessages = chat && chat.children.length > 0;

  if (hasMessages) {
    // 1. 處於 AI 對話狀態：只顯示對話內容
    if (tips) tips.hidden = true;
    if (results) results.hidden = true;
    if (chat) chat.style.display = 'flex';
  } else if (query) {
    // 2. 處於搜尋過濾狀態：只顯示搜尋結果快速預覽
    if (tips) tips.hidden = true;
    if (results) results.hidden = false;
    if (chat) chat.style.display = 'none';
  } else {
    // 3. 初始空狀態：只顯示推薦提問 Tips
    if (tips) tips.hidden = false;
    if (results) results.hidden = true;
    if (chat) chat.style.display = 'none';
  }
}
