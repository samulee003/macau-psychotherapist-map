/* ============================================================
   AI 智能助理 (Copilot)：支援本地規則引擎與 Gemini API JSON 路由
   ============================================================ */

import { CATEGORIES } from './config.js';

let database = null;
let controls = {};
let geminiApiKey = localStorage.getItem('gemini_api_key') || '';

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
  // 注入展開按鈕與對話框容器
  const app = document.getElementById('app');
  if (!app) return;

  // 1. 浮動對話按鈕
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'chat-toggle';
  toggleBtn.className = 'chat-toggle';
  toggleBtn.setAttribute('aria-label', '打開 AI 助理');
  toggleBtn.setAttribute('title', '打開 AI 助理');
  toggleBtn.innerHTML = `
    <span class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    </span>
  `;

  // 2. 對話面板
  const panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.className = 'chat-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="chat-panel__header">
      <div class="chat-panel__title">
        <span class="chat-panel__sparkle">✨</span> AI 智能助理
      </div>
      <div class="chat-panel__header-actions">
        <button id="chat-settings-btn" class="chat-panel__settings-btn" title="設定 API 金鑰">🔑</button>
        <button id="chat-close" class="chat-panel__close" aria-label="關閉助理">&times;</button>
      </div>
    </div>

    <!-- 設定面板 -->
    <div id="chat-settings" class="chat-settings" hidden>
      <p class="chat-settings__desc">輸入您的 Gemini API 金鑰啟用 AI 語意地圖（金鑰僅存在您的瀏覽器）：</p>
      <div class="chat-settings__input-wrapper">
        <input type="password" id="gemini-key-input" placeholder="AIzaSy..." class="chat-settings__input" value="${geminiApiKey}">
        <button id="save-key-btn" class="btn btn--primary" style="padding:6px 12px;font-size:11px">儲存</button>
      </div>
      <p class="chat-settings__hint">💡 無金鑰時，會自動切換為本地離線版規則引擎。</p>
    </div>

    <!-- 對話記錄 -->
    <div id="chat-messages" class="chat-messages">
      <div class="chat-message chat-message--system">
        👋 你好！我是心理地圖的 AI 智能助理。你可以用自然語言直接問我，我會幫您操作地圖：
        <ul style="margin: 8px 0 0 16px; padding: 0; font-size:12px; line-height:1.6">
          <li>“幫我找培甯心理治療中心”</li>
          <li>“顯示所有社會服務機構”</li>
          <li>“現在地圖上共有多少位治療師？”</li>
        </ul>
      </div>
    </div>

    <!-- 快捷按鈕 -->
    <div class="chat-suggestions">
      <button class="chat-suggest-btn" data-input="找醫院">🏥 找醫院</button>
      <button class="chat-suggest-btn" data-input="顯示所有心理治療中心">🏢 心理治療中心</button>
      <button class="chat-suggest-btn" data-input="統計治療師人數">📊 統計人數</button>
    </div>

    <!-- 輸入區域 -->
    <div class="chat-panel__input-area">
      <input type="text" id="chat-input" placeholder="輸入您的問題...（例如：找大學）" class="chat-input">
      <button id="chat-send" class="chat-send-btn" aria-label="傳送">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  `;

  app.appendChild(toggleBtn);
  app.appendChild(panel);
}

function bindEvents() {
  const toggleBtn = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const settingsBtn = document.getElementById('chat-settings-btn');
  const settingsPanel = document.getElementById('chat-settings');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const keyInput = document.getElementById('gemini-key-input');
  const sendBtn = document.getElementById('chat-send');
  const chatInput = document.getElementById('chat-input');
  const suggestions = document.querySelectorAll('.chat-suggest-btn');

  // 切換助理面板
  toggleBtn?.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      chatInput.focus();
      toggleBtn.classList.add('is-active');
    } else {
      toggleBtn.classList.remove('is-active');
    }
  });

  closeBtn?.addEventListener('click', () => {
    panel.hidden = true;
    toggleBtn.classList.remove('is-active');
  });

  // 切換金鑰設定
  settingsBtn?.addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsBtn.classList.toggle('is-active');
  });

  // 儲存金鑰
  saveKeyBtn?.addEventListener('click', () => {
    geminiApiKey = keyInput.value.trim();
    localStorage.setItem('gemini_api_key', geminiApiKey);
    addMessage('system', geminiApiKey ? '🔑 金鑰已儲存，正式啟用 Gemini AI 智能路由！' : '🔑 金鑰已清除，切換回本地規則引導。');
    settingsPanel.hidden = true;
    settingsBtn.classList.remove('is-active');
  });

  // 發送訊息
  const triggerSend = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
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

/**
 * 記錄並滾動顯示單條聊天訊息
 */
function addMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const msg = document.createElement('div');
  msg.className = `chat-message chat-message--${sender}`;
  msg.innerHTML = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

/**
 * 處理使用者輸入的核心 Agent 邏輯
 */
async function handleUserMsg(text) {
  addMessage('user', escapeHtml(text));

  // 顯示載入動畫氣泡
  const container = document.getElementById('chat-messages');
  const loader = document.createElement('div');
  loader.className = 'chat-message chat-message--assistant chat-message--loading';
  loader.innerHTML = '<span class="loading-dots">思考中<span>.</span><span>.</span><span>.</span></span>';
  container.appendChild(loader);
  container.scrollTop = container.scrollHeight;

  try {
    let result = null;
    if (geminiApiKey) {
      // 1. 使用 Gemini AI 進行智能語意解析與 Action 路由 (Agentic Tool Calling)
      result = await requestGeminiAgent(geminiApiKey, text);
    } else {
      // 2. 退回本地輕量級規則路由引擎 (Local Rule-Based Routing)
      result = parseLocalAgent(text);
      // 附帶提示
      result.reply += '<br><small style="color:#94a3b8;display:block;margin-top:4px">💡（目前為本地離線模式，可在設定中配置 Gemini 金鑰以解鎖完整 AI 語意理解能力）</small>';
    }

    // 移除載入動畫氣泡
    loader.remove();

    // 執行 Agent 返回的控制指令
    executeAgentActions(result.actions || []);

    // 呈現 AI 的回答
    addMessage('assistant', result.reply);
  } catch (err) {
    console.error('Agent 執行失敗:', err);
    loader.remove();
    addMessage('assistant', `❌ 處理請求時發生錯誤：${escapeHtml(err.message)}<br><small style="color:#94a3b8;display:block;margin-top:4px">請確認您的 API 金鑰是否正確，或是否網路連線異常。</small>`);
  }
}

/**
 * 本地規則 Agent (Local Rule-Based Agent)
 */
function parseLocalAgent(text) {
  const t = text.toLowerCase();
  const result = { reply: '', actions: [] };

  // 1. 重置
  if (t.includes('全部') || t.includes('清除') || t.includes('重置') || t.includes('還原')) {
    result.reply = '已為您重置所有篩選條件，展示全部執業地點。';
    result.actions.push({ type: 'reset', value: true });
    return result;
  }

  // 2. 統計數據
  if (t.includes('統計') || t.includes('人數') || t.includes('多少人') || t.includes('多少位') || t.includes('規模')) {
    const stats = database.meta?.stats || { therapists: 90, locations: 41, practices: 108 };
    result.reply = `📊 目前地圖共收錄了 <strong>${stats.therapists}</strong> 位完全註冊的心理治療師（不計實習生），分佈在 <strong>${stats.locations}</strong> 個執業地點，共有 <strong>${stats.practices}</strong> 個執業關聯。`;
    return result;
  }

  // 3. 分類篩選
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

  // 4. 地名搜尋匹配
  for (const loc of database.locations) {
    if (t.includes(loc.name.toLowerCase()) || loc.name.toLowerCase().includes(t)) {
      result.reply = `已在地圖上為您找到 <strong>${escapeHtml(loc.name)}</strong>，並已為您開啟了詳情抽屜。`;
      result.actions.push({ type: 'select_location', value: loc.id });
      return result;
    }
  }

  // 5. 治療師搜尋匹配
  for (const th of database.therapists) {
    if (t.includes(th.nameZh) || (th.nameEn && t.includes(th.nameEn.toLowerCase()))) {
      result.reply = `已搜尋到治療師 <strong>${escapeHtml(th.nameZh)}</strong> (${th.licenseNo})。已為您篩選出其所在的執業地點。`;
      result.actions.push({ type: 'search', value: th.nameZh });
      return result;
    }
  }

  // 6. 模糊搜尋兜底
  result.reply = `已為您在數據庫中搜尋關鍵字：『<strong>${escapeHtml(text)}</strong>』。`;
  result.actions.push({ type: 'search', value: text });
  return result;
}

/**
 * 調用 Gemini API 進行 AI 智能路由與 Tool Calling
 */
async function requestGeminiAgent(apiKey, userMsg) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const locationsBrief = database.locations.map(l => ({
    id: l.id,
    name: l.name,
    address: l.addressZh,
    category: l.category
  }));

  const systemInstruction = `
你現在是澳門心理治療師地圖 (Macau Psychotherapist Map) 的 AI 智能助理。
你的目標是協助使用者解答疑問，並通過發送指令來控制地圖界面與過濾診所。
你必須只使用繁體中文(zh-Hant)回答。

【資料庫現狀】
- 完全註冊心理治療師：90位（無實習生，所有牌照都是 PI 開頭）
- 地點數量：41處
- 總執業關聯數：108個
- 地點列表：
${JSON.stringify(locationsBrief)}

【你可以執行的指令（行動）】
你可以通過在 JSON 的 "actions" 欄位中添加以下結構來控制前端 UI：
1. 分類過濾：{"type": "filter_category", "value": "hospital" | "med_center" | "psych_center" | "social" | "university" | "gov" | "all"}
2. 文字搜尋：{"type": "search", "value": "搜尋關鍵字"}
3. 選取地點並開起詳情與定位：{"type": "select_location", "value": "地點的 id（例如：loc_189fe1c5）"}
4. 重置篩選條件：{"type": "reset", "value": true}

【回傳格式要求】
你必須且只能回傳一個符合 JSON 規格的字串，格式如下：
{
  "reply": "你的繁體中文回答，簡要說明你執行了什麼操作。",
  "actions": [
    // 這裡放入你想要執行的指令列表（可以為空，也可以有多個，順序執行）
  ]
}

【行為規範】
- 如果使用者詢問某個機構，請從地點列表中找出最匹配的 id，並發送 "select_location" 指令！
- 如果使用者想尋找某個大類（如「醫院」、「社會服務機構」），請使用 "filter_category" 進行過濾！
- 如果使用者想要搜尋特定的個人（如「曾蔚然」）或特定字詞，請使用 "search" 指令！
- 如果使用者想要查看全部或重置，請使用 "reset" 指令！
- 不要虛構不存在的地點或治療師，請僅基於提供的列表進行分析。
- 始終保持親切、專業的口氣，並用繁體中文回答。
`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: userMsg }]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API 請求失敗 (HTTP ${response.status})`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("無效的 Gemini API 回應");

  return JSON.parse(text);
}

/**
 * 執行 Agent 所指派的 Actions (聯動地圖與篩選 UI)
 */
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
