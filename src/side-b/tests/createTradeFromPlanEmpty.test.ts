/**
 * Hotfix: createTradeFromPlan で scenarios 0 件を skipped 扱いにするテスト
 *
 * 以前: scenarios=0 → { success: false, error: 'プランにシナリオがありません' }
 * 修正後: scenarios=0 → { success: true, skipped: true, skipReason: ... }
 */

// planRepository をモック
jest.mock('../repositories', () => {
  const actual = jest.requireActual('../repositories');
  return {
    ...actual,
    planRepository: {
      findById: jest.fn(),
    },
  };
});

import { createTradeFromPlan } from '../services/virtualTradeService';
import { planRepository } from '../repositories';

describe('createTradeFromPlan: 空シナリオ処理 (hotfix)', () => {
  beforeEach(() => {
    (planRepository.findById as jest.Mock).mockReset();
  });

  it('プランが見つからないときは success=false を返す(既存仕様)', async () => {
    (planRepository.findById as jest.Mock).mockResolvedValue(null);
    const r = await createTradeFromPlan('missing-id');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/プランが見つかりません/);
  });

  it('scenarios が 空配列 のときは success=true, skipped=true を返す(hotfix)', async () => {
    (planRepository.findById as jest.Mock).mockResolvedValue({
      id: 'plan-1',
      scenarios: [],
    });
    const r = await createTradeFromPlan('plan-1');
    expect(r.success).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.skipReason).toMatch(/ノートレード判断/);
    expect(r.error).toBeUndefined();
    expect(r.trade).toBeUndefined();
  });

  it('scenarios が undefined のときも skipped で返る', async () => {
    (planRepository.findById as jest.Mock).mockResolvedValue({
      id: 'plan-2',
      scenarios: undefined,
    });
    const r = await createTradeFromPlan('plan-2');
    expect(r.success).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('scenarios はあるが指定 scenarioId が見つからないときは success=false(既存仕様)', async () => {
    (planRepository.findById as jest.Mock).mockResolvedValue({
      id: 'plan-3',
      scenarios: [
        {
          id: 'scenario-A',
          direction: 'long',
          entry: { price: 100, condition: '' },
          stopLoss: { price: 90 },
          takeProfit: { price: 120 },
        },
      ],
    });
    const r = await createTradeFromPlan('plan-3', 'scenario-B');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/シナリオが見つかりません/);
  });
});
