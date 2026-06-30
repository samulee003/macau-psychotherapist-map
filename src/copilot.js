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

let database = null;
let controls = {};

// 記憶模組：儲存短期對話歷史
let chatHistory = [];

// 設定：useOwnKey 為 true 時走「自帶 Key 直連」，否則走「自家薄代理（免 Key）」
const settings = {
  useOwnKey: localStorage.getItem('copilot_use_own_key') === 'true',
  apiKey: localStorage.getItem('copilot_api_key') || '',
  model: localStorage.getItem('copilot_model') || ''
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
        <button id="chat-clear-btn" class="search-ai__action-btn" title="清除對話歷史">🗑️</button>
        <button id="chat-settings-btn" class="search-ai__action-btn" title="進階設定">⚙️</button>
      </div>
    </div>

    <!-- 進階設定面板 -->
    <div id="chat-settings" class="chat-settings" hidden>
      <p class="chat-settings__desc" style="font-size:11px; margin-bottom: 6px;">
        預設透過站台伺服器代為呼叫，您無需任何設定。若有自定義 Key 可在此切換為自帶金鑰直連模式。
      </p>
      <div class="chat-settings__field">
        <label class="chat-settings__label">
          <input type="checkbox" id="use-own-key-toggle" ${settings.useOwnKey ? 'checked' : ''}>
          使用自帶 API 金鑰
        </label>
      </div>

      <div id="own-key-group" class="chat-settings__field" ${settings.useOwnKey ? '' : 'hidden'}>
        <label class="chat-settings__label" for="ai-key-input">API 金鑰 (API Key)：</label>
        <input type="password" id="ai-key-input" placeholder="輸入您的 Deepseek API 金鑰" class="chat-settings__input">

        <label class="chat-settings__label" for="ai-model-input" style="margin-top:8px">模型名稱 (Model)：</label>
        <input type="text" id="ai-model-input" placeholder="deepseek-chat" class="chat-settings__input">
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:8px">
        <button id="save-key-btn" class="btn btn--primary" style="padding:4px 8px;font-size:11px">儲存設定</button>
      </div>
    </div>

    <!-- 對話記錄 -->
    <div id="chat-messages" class="chat-messages">
      <div class="chat-message chat-message--system">
        👋 你好！我是心理地圖 AI 智能助理。您可以直接在此對話、搜尋或進行篩選。
        <ul style="margin: 8px 0 0 16px; padding: 0; font-size:11.5px; line-height:1.6">
          <li>“幫我找培甯心理治療中心”</li>
          <li>“顯示所有社會服務機構”</li>
          <li>“現在地圖上共有多少位治療師？”</li>
        </ul>
      </div>
    </div>

    <!-- 快捷按鈕 -->
    <div class="chat-suggestions">
      <button class="chat-suggest-btn" data-input="找醫院">🏥 醫院</button>
      <button class="chat-suggest-btn" data-input="顯示所有心理治療中心">🧠 心理中心</button>
      <button class="chat-suggest-btn" data-input="統計治療師人數">📊 統計人數</button>
    </div>
    
    <!-- 搜尋結果筆數 -->
    <div id="search-results-count" class="search__count"></div>
  `;

  // 用程式碼動態邏輯賦值，以防從 localStorage 讀取受污染的設定產生 DOM XSS 漏洞
  const keyInput = document.getElementById('ai-key-input');
  if (keyInput) keyInput.value = settings.apiKey;
  const modelInput = document.getElementById('ai-model-input');
  if (modelInput) modelInput.value = settings.model;
}

function bindEvents() {
  const clearBtn = document.getElementById('chat-clear-btn');
  const settingsBtn = document.getElementById('chat-settings-btn');
  const settingsPanel = document.getElementById('chat-settings');
  const useOwnKeyToggle = document.getElementById('use-own-key-toggle');
  const ownKeyGroup = document.getElementById('own-key-group');
  const keyInput = document.getElementById('ai-key-input');
  const modelInput = document.getElementById('ai-model-input');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const sendBtn = document.getElementById('chat-send');
  const chatInput = document.getElementById('chat-input');
  const suggestions = document.querySelectorAll('.chat-suggest-btn');
  // 搜尋與 AI 助理連動：打字時即時過濾
  chatInput?.addEventListener('input', (e) => {
    controls.setQuery(e.target.value);
  });
  // 清除對話歷史 (Memory)
  clearBtn?.addEventListener('click', () => {
    clearChatMemory();
    addMessage('system', '🧹 已清除對話歷史，助理記憶已重置。');
  });

  // 切換進階設定
  settingsBtn?.addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsBtn.classList.toggle('is-active');
  });

  // 「自帶金鑰」勾選連動
  useOwnKeyToggle?.addEventListener('change', () => {
    ownKeyGroup.hidden = !useOwnKeyToggle.checked;
  });

  // 儲存設定
  saveKeyBtn?.addEventListener('click', () => {
    settings.useOwnKey = useOwnKeyToggle.checked;
    settings.apiKey = keyInput.value.trim();
    settings.model = modelInput.value.trim();

    localStorage.setItem('copilot_use_own_key', String(settings.useOwnKey));
    localStorage.setItem('copilot_api_key', settings.apiKey);
    localStorage.setItem('copilot_model', settings.model);

    addMessage('system', settings.useOwnKey
      ? (settings.apiKey ? '🔑 已切換為自帶金鑰模式（瀏覽器直連 Deepseek）。' : '⚠ 已勾選自帶金鑰但未填入 Key，將仍使用站台預設模式。')
      : '✅ 已切換回站台預設模式（免設定金鑰）。'
    );
    settingsPanel.hidden = true;
    settingsBtn.classList.remove('is-active');
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

  // 快捷按鈕
  suggestions.forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.input;
      if (text) handleUserMsg(text);
    });
  });
}

function clearChatMemory() {
  chatHistory = [];
  const container = document.getElementById('chat-messages');
  if (container) {
    container.innerHTML = `
      <div class="chat-message chat-message--system">
        👋 你好！我是心理地圖 AI 智能助理。您可以直接在此對話、搜尋或進行篩選。
        <ul style="margin: 8px 0 0 16px; padding: 0; font-size:11.5px; line-height:1.6">
          <li>“幫我找培甯心理治療中心”</li>
          <li>“顯示所有社會服務機構”</li>
          <li>“現在地圖上共有多少位治療師？”</li>
        </ul>
      </div>
    `;
  }
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

  const msg = document.createElement('div');
  msg.className = `chat-message chat-message--${sender}`;
  msg.innerHTML = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
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
        reply: `${formattedLocal}<br><small style="color:#94a3b8;display:block;margin-top:4px">⚠️ 已切換至本地離線搜尋模式（AI 服務目前不可用）</small>`,
        actions: localResult.actions
      };
    }

    loader.remove();
    executeAgentActions(result.actions || []);
    addMessage('assistant', result.reply);
  } catch (err) {
    console.error('Agent 執行失敗:', err);
    loader.remove();
    addMessage('assistant', `❌ 處理請求時發生錯誤：${escapeHtml(err.message)}<br><small style="color:#94a3b8;display:block;margin-top:4px">AI 服務暫時無法使用。您仍可使用地圖的搜尋與篩選功能查找資料。</small>`);
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
    result.reply = `📊 目前地圖共收錄了 <strong>${stats.therapists}</strong> 位完全註冊的心理治療師（不計實習生），分佈在 <strong>${stats.locations}</strong> 個執業地點，共有 <strong>${stats.practices}</strong> 個執業關聯。`;
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
  const locationsBrief = database.locations.map(l => ({
    id: l.id,
    name: l.name,
    address: l.addressZh,
    category: l.category
  }));

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
- 地點列表：
${JSON.stringify(locationsBrief)}

【操作地圖與 UI 的指南】
當你需要進行以下操作時，請務必調用對應的工具：
1. 篩選某個機構分類：調用 filter_category
2. 模糊搜尋地圖上的文字：調用 search_map
3. 在地圖上選取特定地點、開啟詳情抽屜並定位：調用 select_location（需要提供地點 id，你可以先以 search_locations 查詢 id）
4. 重置篩選條件、還原全部打點：調用 reset_filters

【回傳格式要求】
請以友善、自然的繁體中文回覆使用者，**不要回傳任何 JSON 格式的內容**。你的最終回覆會直接以 HTML/Markdown 形式在聊天視窗中展示給使用者看。
當你調用了 UI 行動工具（例如 select_location）後，請在最終回覆中親切地告訴使用者你已經在畫面上為他們選取或篩選了該地點。

【行為規範】
- 如果使用者在上一次提問之後問「它的電話是多少」或「在哪裡」，請根據對話歷史判斷指的是哪一家機構，並調用 "select_location"！
- 不要虛構任何不存在的醫療機構，始終基於事實回覆。
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
