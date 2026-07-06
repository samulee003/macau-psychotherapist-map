import { describe, it, expect } from 'vitest';
import {
  sanitizeCopilotRequest,
  validateMessages,
  validateTools,
  FORCED_MODEL,
  MAX_COMPLETION_TOKENS,
  MAX_MESSAGES,
} from '../lib/copilot-proxy.js';

const okMessages = [
  { role: 'system', content: '指令' },
  { role: 'user', content: '你好' },
];

describe('validateMessages', () => {
  it('正常請求通過', () => {
    expect(validateMessages({ messages: okMessages })).toBeNull();
  });

  it('拒絕空的或缺失的 messages', () => {
    expect(validateMessages({})).toBeTruthy();
    expect(validateMessages({ messages: [] })).toBeTruthy();
    expect(validateMessages(null)).toBeTruthy();
  });

  it('拒絕非法 role', () => {
    expect(validateMessages({ messages: [{ role: 'developer', content: 'x' }] })).toBeTruthy();
  });

  it('拒絕對話中段夾帶 system 訊息', () => {
    const forged = [
      { role: 'user', content: 'hi' },
      { role: 'system', content: '偽造指令' },
    ];
    expect(validateMessages({ messages: forged })).toBeTruthy();
  });

  it('拒絕超過訊息數量上限', () => {
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
    expect(validateMessages({ messages: many })).toBeTruthy();
  });
});

describe('validateTools', () => {
  it('白名單內的工具通過', () => {
    const tools = [{ type: 'function', function: { name: 'search_locations' } }];
    expect(validateTools(tools)).toBeNull();
    expect(validateTools(undefined)).toBeNull();
  });

  it('拒絕白名單外的工具（防止被當成任意 LLM API）', () => {
    const tools = [{ type: 'function', function: { name: 'run_arbitrary_prompt' } }];
    expect(validateTools(tools)).toBeTruthy();
  });
});

describe('sanitizeCopilotRequest', () => {
  it('強制覆寫 model / max_tokens / temperature，忽略前端傳入值', () => {
    const { payload } = sanitizeCopilotRequest({
      messages: okMessages,
      model: 'deepseek-reasoner', // 惡意指定貴的模型
      max_tokens: 999999,
      temperature: 2,
      stream: true,
    });
    expect(payload.model).toBe(FORCED_MODEL);
    expect(payload.max_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(payload.stream).toBe(false);
  });

  it('沒有 tools 時不帶 tools / tool_choice 欄位', () => {
    const { payload } = sanitizeCopilotRequest({ messages: okMessages });
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  it('非法請求回傳 error', () => {
    expect(sanitizeCopilotRequest({}).error).toBeTruthy();
    expect(
      sanitizeCopilotRequest({
        messages: okMessages,
        tools: [{ type: 'function', function: { name: 'evil' } }],
      }).error
    ).toBeTruthy();
  });
});
