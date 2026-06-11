/**
 * NotificationPreferenceService (Phase β-2a) のユニットテスト
 *
 * 検証観点:
 * - mergePreferences: note > user > システム既定 の項目別マージ (正常系/境界値)
 * - effectiveThreshold: しきい値と一致レベル帯下限の大きい方 (§6.4)
 * - resolveForNotes: 1 クエリでの一括解決とノート別マッピング
 * - upsertPreference: note スコープの所有チェック (異常系)
 */
import { describe, it, expect, jest } from '@jest/globals';
import type { PrismaClient, NotificationPreference } from '@prisma/client';
import {
  NotificationPreferenceService,
  mergePreferences,
  systemDefaultPreference,
} from '../../services/notification/notificationPreferenceService';

/** テスト用の設定行スタブ (マージに使うフィールドのみ意味を持つ) */
function makePref(
  over: Partial<Pick<NotificationPreference, 'threshold' | 'minMatchLevel' | 'cooldownMinutes'>>
): Pick<NotificationPreference, 'threshold' | 'minMatchLevel' | 'cooldownMinutes'> {
  return {
    threshold: null,
    minMatchLevel: null,
    cooldownMinutes: null,
    ...over,
  };
}

describe('mergePreferences (Phase β-2a)', () => {
  it('設定なしはシステム既定 (= 従来挙動) になる', () => {
    const merged = mergePreferences(null, null);
    expect(merged).toEqual(systemDefaultPreference());
    // 既定: threshold 0.75 / weak 帯下限 0.7 → 有効しきい値 0.75
    expect(merged.effectiveThreshold).toBe(0.75);
    expect(merged.minMatchLevel).toBe('weak');
  });

  it('note スコープが user スコープより優先される (項目別)', () => {
    const merged = mergePreferences(
      makePref({ threshold: 0.85 }),
      makePref({ threshold: 0.6, cooldownMinutes: 120 })
    );
    // threshold は note 側、cooldown は note に無いので user 側が効く (部分上書き)
    expect(merged.threshold).toBe(0.85);
    expect(merged.cooldownMs).toBe(120 * 60 * 1000);
  });

  it('minMatchLevel の帯下限がしきい値を持ち上げる (§6.4 一致レベル)', () => {
    const merged = mergePreferences(makePref({ threshold: 0.6, minMatchLevel: 'strong' }), null);
    // strong 帯下限 0.9 > threshold 0.6 → 有効しきい値は 0.9
    expect(merged.effectiveThreshold).toBe(0.9);
    expect(merged.threshold).toBe(0.6);
  });

  it('しきい値が帯下限より高ければしきい値が効く (境界値)', () => {
    const merged = mergePreferences(makePref({ threshold: 0.95, minMatchLevel: 'medium' }), null);
    // threshold 0.95 > medium 帯下限 0.8
    expect(merged.effectiveThreshold).toBe(0.95);
  });
});

describe('NotificationPreferenceService.resolveForNotes (Phase β-2a)', () => {
  it('note / user スコープを 1 クエリで取得しノート別にマージする', async () => {
    const rows = [
      { scope: 'note', noteId: 'note-1', userId: 'user-a', threshold: 0.9, minMatchLevel: null, cooldownMinutes: null },
      { scope: 'user', noteId: null, userId: 'user-a', threshold: 0.8, minMatchLevel: null, cooldownMinutes: 30 },
    ];
    const findMany = jest.fn<() => Promise<typeof rows>>().mockResolvedValue(rows);
    const prismaMock = { notificationPreference: { findMany } } as unknown as PrismaClient;
    const service = new NotificationPreferenceService(prismaMock);

    const resolved = await service.resolveForNotes([
      { id: 'note-1', userId: 'user-a' },
      { id: 'note-2', userId: 'user-a' },
      { id: 'note-3', userId: null },
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    // note-1: note スコープの threshold 0.9 + user スコープの cooldown 30 分
    expect(resolved.get('note-1')?.threshold).toBe(0.9);
    expect(resolved.get('note-1')?.cooldownMs).toBe(30 * 60 * 1000);
    // note-2: note スコープなし → user スコープの threshold 0.8
    expect(resolved.get('note-2')?.threshold).toBe(0.8);
    // note-3: userId なし (レガシー) → システム既定
    expect(resolved.get('note-3')).toEqual(systemDefaultPreference());
  });

  it('対象ノートが空なら DB に問い合わせない', async () => {
    const findMany = jest.fn();
    const prismaMock = { notificationPreference: { findMany } } as unknown as PrismaClient;
    const service = new NotificationPreferenceService(prismaMock);

    const resolved = await service.resolveForNotes([]);

    expect(resolved.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('NotificationPreferenceService.upsertPreference (Phase β-2a)', () => {
  it('scope=note で他ユーザーのノートを指定するとエラー (異常系・所有チェック)', async () => {
    const prismaMock = {
      tradeNote: {
        findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    const service = new NotificationPreferenceService(prismaMock);

    await expect(
      service.upsertPreference('user-a', { scope: 'note', noteId: 'others-note', threshold: 0.9 })
    ).rejects.toThrow('ノートが見つかりませんでした');
  });
});
