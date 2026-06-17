/**
 * aiHealth (AI 呼び出し health signal) の単体テスト。
 *
 * 「クォータ枯渇が静かに起きて全 AI が落ちても、ログは正常風で数日後に発覚」を防ぐための
 * 基盤なので、(1) 失敗理由の分類 と (2) down/degraded 判定・連続失敗リセット を担保する。
 */

import {
  classifyAiFailure,
  recordAiSuccess,
  recordAiFailure,
  getAiHealthSnapshot,
  resetAiHealth,
} from '../agent/aiHealth';

describe('classifyAiFailure', () => {
  it('429 + insufficient_quota → quota', () => {
    expect(
      classifyAiFailure(429, 'You exceeded your current quota, please check your plan and billing details'),
    ).toBe('quota');
  });

  it('429 + 純粋なレート制限文言 → rate_limit', () => {
    expect(classifyAiFailure(429, 'Rate limit exceeded, retry later')).toBe('rate_limit');
  });

  it('403 + OpenRouter key limit → quota (キー上限超過はクォータ系)', () => {
    expect(classifyAiFailure(403, 'Key limit exceeded (total limit)')).toBe('quota');
  });

  it('403 (権限) → auth', () => {
    expect(classifyAiFailure(403, 'forbidden')).toBe('auth');
  });

  it('401 → auth', () => {
    expect(classifyAiFailure(401, 'invalid api key')).toBe('auth');
  });

  it('status=null (接続失敗) → network', () => {
    expect(classifyAiFailure(null, 'fetch failed')).toBe('network');
  });

  it('5xx → server', () => {
    expect(classifyAiFailure(500, 'internal error')).toBe('server');
    expect(classifyAiFailure(503, 'unavailable')).toBe('server');
  });

  it('408/504 → timeout', () => {
    expect(classifyAiFailure(408, 'request timeout')).toBe('timeout');
    expect(classifyAiFailure(504, 'gateway timeout')).toBe('timeout');
  });

  it('その他 4xx → other', () => {
    expect(classifyAiFailure(400, 'bad request')).toBe('other');
  });
});

describe('aiHealth レジストリ', () => {
  beforeEach(() => resetAiHealth());

  it('初期状態は idle', () => {
    expect(getAiHealthSnapshot().status).toBe('idle');
  });

  it('成功を記録すると ok / lastSuccessAt が入る', () => {
    recordAiSuccess({ model: 'anthropic/claude-sonnet-4.6' });
    const s = getAiHealthSnapshot();
    expect(s.status).toBe('ok');
    expect(s.success).toBe(1);
    expect(s.total).toBe(1);
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.consecutiveFailures).toBe(0);
  });

  it('連続5失敗で down + 理由別カウント', () => {
    for (let i = 0; i < 5; i++) {
      recordAiFailure({ status: 429, body: 'insufficient_quota', model: 'gpt-5.4-mini' });
    }
    const s = getAiHealthSnapshot();
    expect(s.status).toBe('down');
    expect(s.consecutiveFailures).toBe(5);
    expect(s.failuresByReason.quota).toBe(5);
    expect(s.lastFailureReason).toBe('quota');
  });

  it('1回成功で down からは脱する (連続失敗リセット) が、recent が回復するまでは degraded', () => {
    for (let i = 0; i < 5; i++) {
      recordAiFailure({ status: 429, body: 'insufficient_quota', model: 'gpt-5.4-mini' });
    }
    expect(getAiHealthSnapshot().status).toBe('down');

    recordAiSuccess({ model: 'anthropic/claude-sonnet-4.6' });
    const afterOne = getAiHealthSnapshot();
    expect(afterOne.consecutiveFailures).toBe(0);
    expect(afterOne.status).not.toBe('down'); // down からは脱した
    expect(afterOne.status).toBe('degraded'); // ただし直近は失敗だらけ → まだ degraded

    // 成功を重ねて失敗率が 50% を下回れば ok に戻る (5 失敗 + 計 7 成功 = 5/12 ≈ 42%)
    for (let i = 0; i < 6; i++) recordAiSuccess({ model: 'm' });
    expect(getAiHealthSnapshot().status).toBe('ok');
  });

  it('直近の失敗率が高いと degraded (連続5未満でも)', () => {
    // 成功 3 / 失敗 3 を交互 → 連続失敗は 1 (最後が失敗) だが失敗率 50% → degraded
    recordAiSuccess({ model: 'm' });
    recordAiFailure({ status: 429, body: 'rate limit', model: 'm' });
    recordAiSuccess({ model: 'm' });
    recordAiFailure({ status: 429, body: 'rate limit', model: 'm' });
    recordAiSuccess({ model: 'm' });
    recordAiFailure({ status: 429, body: 'rate limit', model: 'm' });
    const s = getAiHealthSnapshot();
    expect(s.consecutiveFailures).toBe(1);
    expect(s.status).toBe('degraded');
    expect(s.failuresByReason.rate_limit).toBe(3);
  });
});
