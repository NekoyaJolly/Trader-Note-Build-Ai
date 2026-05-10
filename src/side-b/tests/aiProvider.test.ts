/**
 * AIProvider のリクエストボディ構築テスト
 *
 * 検証対象:
 * - response_format オプションの転送
 * - reasoning_effort の対象モデル判定 (gpt-5系 / o系)
 * - config.ai.reasoningEffort のフォールバック
 * - options.reasoningEffort による上書き
 *
 * モック戦略: global.fetch を jest.fn() で差し替え、送信された body を検証する。
 */

import { AIProvider } from '../agent/aiProvider';

global.fetch = jest.fn();

function mockFetchOnce(): void {
  // OpenAIChatCompletionResponseSchema を満たす完全なレスポンス
  // (id / object / created / model / choices[].index は必須)
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1700000000,
      model: 'mocked',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  });
}

function lastRequestBody(): Record<string, unknown> {
  const calls = (global.fetch as jest.Mock).mock.calls;
  const lastCall = calls[calls.length - 1];
  const init = lastCall[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe('AIProvider request body', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  describe('response_format', () => {
    it('options.responseFormat 未指定時は body に含めない', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }]);
      expect(lastRequestBody()).not.toHaveProperty('response_format');
    });

    it('json_object を指定すると body.response_format に転送される', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }], {
        responseFormat: { type: 'json_object' },
      });
      expect(lastRequestBody().response_format).toEqual({ type: 'json_object' });
    });
  });

  describe('reasoning_effort', () => {
    it('非 reasoning モデル (gpt-4o-mini) では送信されない', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }], { reasoningEffort: 'high' });
      expect(lastRequestBody()).not.toHaveProperty('reasoning_effort');
    });

    it('非 reasoning モデル (anthropic/claude-sonnet-4.6) では送信されない', async () => {
      mockFetchOnce();
      const provider = new AIProvider({
        apiKey: 'test',
        model: 'anthropic/claude-sonnet-4.6',
        baseURL: 'https://openrouter.ai/api/v1',
      });
      await provider.chat([{ role: 'user', content: 'hi' }], { reasoningEffort: 'high' });
      expect(lastRequestBody()).not.toHaveProperty('reasoning_effort');
    });

    it('gpt-5-mini で options.reasoningEffort が body.reasoning_effort に転送される', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-5-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }], { reasoningEffort: 'low' });
      expect(lastRequestBody().reasoning_effort).toBe('low');
    });

    it('gpt-5-mini で options 未指定時は config.ai.reasoningEffort 既定値が使われる (= high)', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-5-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }]);
      expect(lastRequestBody().reasoning_effort).toBe('high');
    });

    it('o3-mini も reasoning モデルとして判定される', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'o3-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }]);
      expect(lastRequestBody().reasoning_effort).toBe('high');
    });

    it('OpenRouter 経由の openai/gpt-5-mini も reasoning モデルとして判定される', async () => {
      mockFetchOnce();
      const provider = new AIProvider({
        apiKey: 'test',
        model: 'openai/gpt-5-mini',
        baseURL: 'https://openrouter.ai/api/v1',
      });
      await provider.chat([{ role: 'user', content: 'hi' }]);
      expect(lastRequestBody().reasoning_effort).toBe('high');
    });

    it('gpt-5.1 (バージョン入りエイリアス) も判定される', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-5.1-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }]);
      expect(lastRequestBody().reasoning_effort).toBe('high');
    });
  });

  describe('既存挙動の回帰確認', () => {
    it('OpenAI 直 + gpt-5系: temperature を送らず max_completion_tokens を使う', async () => {
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-5-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }], { maxTokens: 1024, temperature: 0.7 });
      const body = lastRequestBody();
      expect(body).not.toHaveProperty('temperature');
      expect(body.max_completion_tokens).toBe(1024);
      expect(body).not.toHaveProperty('max_tokens');
    });

    it('OpenAI 直 + gpt-4o-mini (非 reasoning): temperature と max_tokens を従来通り送る (回帰防止 #149)', async () => {
      // PR #149 Copilot レビュー (3): baseURL のみで切替判定すると gpt-4o-mini 直叩きが壊れる問題の回帰テスト
      mockFetchOnce();
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' });
      await provider.chat([{ role: 'user', content: 'hi' }], { maxTokens: 1024, temperature: 0.7 });
      const body = lastRequestBody();
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(1024);
      expect(body).not.toHaveProperty('max_completion_tokens');
    });

    it('OpenRouter 経由: temperature と max_tokens を従来通り送る', async () => {
      mockFetchOnce();
      const provider = new AIProvider({
        apiKey: 'test',
        model: 'anthropic/claude-sonnet-4.6',
        baseURL: 'https://openrouter.ai/api/v1',
      });
      await provider.chat([{ role: 'user', content: 'hi' }], { maxTokens: 1024, temperature: 0.5 });
      const body = lastRequestBody();
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(1024);
      expect(body).not.toHaveProperty('max_completion_tokens');
    });
  });

  describe('レスポンス Zod 検証 (PR #149 Copilot レビュー (4))', () => {
    it('レスポンス形式が壊れている場合、明確なエラーを throw する', async () => {
      // type assertion だと undefined 連鎖で隠れていた壊れたレスポンス
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unexpected: 'shape' }),
      });
      const provider = new AIProvider({ apiKey: 'test', model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' });
      await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/レスポンス形式エラー/);
    });
  });
});
