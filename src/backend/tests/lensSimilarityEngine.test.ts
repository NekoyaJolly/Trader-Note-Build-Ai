/**
 * レンズ類似度エンジン(src/shared/similarity/)のユニットテスト
 *
 * 検証観点(NOTE_SIMILARITY_FOUNDATION.md §6):
 * - 共通 lensId のみで比較し、欠損・プロファイル差で全体が 0 にならないこと
 * - enum の部分点(順序距離・類似表)、イベント比較、sentinel スキップ
 * - confidence 連動の重み、層重みプリセット(指標重視/バランス/状態重視)
 * - 比較不能時に score=0 ではなく「比較不能 + 理由コード」を返すこと
 * - しきい値発火と一致レベル(strong/medium/weak)
 */

import {
  LENS_SNAPSHOT_SCHEMA_VERSION,
  createNoteLensSnapshot,
  lensEntryFromLensFeature,
  parseNoteLensSnapshot,
  type LensSnapshotEntry,
  type NoteLensSnapshot,
} from '../../shared/similarity/lensSnapshotTypes';
import {
  compareFeatureValue,
  compareLensSnapshots,
  resolveMatchLevel,
} from '../../shared/similarity/similarityEngine';

/** テスト用スナップショットの組み立てヘルパ */
function snapshotWith(lenses: Record<string, LensSnapshotEntry>): NoteLensSnapshot {
  return createNoteLensSnapshot({
    symbol: 'USDJPY',
    timeframe: '15m',
    eventTime: new Date('2026-06-01T12:00:00Z'),
    lenses,
  });
}

/** confidence=1 のレンズエントリを作るヘルパ */
function entry(
  features: Record<string, number | string | boolean>,
  confidence = 1
): LensSnapshotEntry {
  return { lensVersion: '1.0.0', confidence, features };
}

describe('NoteLensSnapshot 正準型(生成・検証)', () => {
  test('createNoteLensSnapshot はスキーマ版と ISO eventTime を付与する', () => {
    const snapshot = snapshotWith({ pattern: entry({ doji: true }) });
    expect(snapshot.snapshotSchemaVersion).toBe(LENS_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.eventTime).toBe('2026-06-01T12:00:00.000Z');
  });

  test('parseNoteLensSnapshot はラウンドトリップできる', () => {
    const snapshot = snapshotWith({ pattern: entry({ doji: true }) });
    const parsed = parseNoteLensSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed).toEqual(snapshot);
  });

  test('parseNoteLensSnapshot は旧形式・破損データで null を返す(例外にしない)', () => {
    expect(parseNoteLensSnapshot(null)).toBeNull();
    expect(parseNoteLensSnapshot(undefined)).toBeNull();
    expect(parseNoteLensSnapshot([0.5, 0.5, 0.5])).toBeNull();
    expect(parseNoteLensSnapshot({ legacy: true })).toBeNull();
    // confidence が値域外
    expect(
      parseNoteLensSnapshot({
        snapshotSchemaVersion: '1.0.0',
        symbol: 'USDJPY',
        timeframe: '15m',
        eventTime: '2026-06-01T12:00:00Z',
        lenses: { pattern: { lensVersion: '1.0.0', confidence: 2, features: {} } },
      })
    ).toBeNull();
  });

  test('スキーマ版はメジャー一致のみ受理(マイナー差は通し、メジャー差は null)', () => {
    const base = {
      symbol: 'USDJPY',
      timeframe: '15m',
      eventTime: '2026-06-01T12:00:00Z',
      lenses: { pattern: { lensVersion: '1.0.0', confidence: 1, features: { doji: true } } },
    };
    // マイナー/パッチ差(加算的拡張)は解釈可能なので受理
    expect(parseNoteLensSnapshot({ ...base, snapshotSchemaVersion: '1.5.2' })).not.toBeNull();
    // メジャー差(破壊的変更)・不正形式は比較対象外に落とす
    expect(parseNoteLensSnapshot({ ...base, snapshotSchemaVersion: '2.0.0' })).toBeNull();
    expect(parseNoteLensSnapshot({ ...base, snapshotSchemaVersion: 'invalid' })).toBeNull();
  });

  test('lensEntryFromLensFeature は confidence 未申告を 1.0、逸脱値をクランプする', () => {
    expect(lensEntryFromLensFeature({ lensVersion: '1.0.0', features: {} }).confidence).toBe(1);
    expect(
      lensEntryFromLensFeature({ lensVersion: '1.0.0', features: {}, confidence: 1.5 }).confidence
    ).toBe(1);
    expect(
      lensEntryFromLensFeature({ lensVersion: '1.0.0', features: {}, confidence: -1 }).confidence
    ).toBe(0);
    expect(
      lensEntryFromLensFeature({ lensVersion: '1.0.0', features: {}, confidence: Number.NaN })
        .confidence
    ).toBe(0);
  });
});

describe('compareLensSnapshots — 基本動作(§6.1)', () => {
  test('完全一致のスナップショットはスコア 1.0 / strong / triggered', () => {
    const lenses = {
      pattern: entry({ doji: true, pinbar: false }),
      'ind:rsi#p14': entry({ rsi_zone: 'oversold', rsi_value: 0.25, rsi_divergence: 'bull' }),
    };
    const result = compareLensSnapshots(snapshotWith(lenses), snapshotWith(lenses));
    expect(result.comparable).toBe(true);
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.level).toBe('strong');
    expect(result.triggered).toBe(true);
  });

  test('共通レンズが無い場合は比較不能(no_common_lenses)で score=null', () => {
    const note = snapshotWith({ 'ind:rsi#p14': entry({ rsi_value: 0.5 }) });
    const market = snapshotWith({ 'ind:rsi#p7': entry({ rsi_value: 0.5 }) });
    const result = compareLensSnapshots(note, market);
    expect(result.comparable).toBe(false);
    expect(result.score).toBeNull();
    expect(result.triggered).toBe(false);
    expect(result.skipReason).toBe('no_common_lenses');
  });

  test('共通レンズが全て confidence=0 の場合は no_comparable_lenses', () => {
    const note = snapshotWith({ pattern: entry({ doji: true }, 0) });
    const market = snapshotWith({ pattern: entry({ doji: true }, 1) });
    const result = compareLensSnapshots(note, market);
    expect(result.comparable).toBe(false);
    expect(result.skipReason).toBe('no_comparable_lenses');
  });

  test('片側にしか無いレンズはスキップされ、共通レンズだけで比較される(欠損に強い)', () => {
    const note = snapshotWith({
      pattern: entry({ doji: true }),
      'ind:macd#f12s26g9': entry({ macd_cross: 'bull' }),
    });
    const market = snapshotWith({
      pattern: entry({ doji: true }),
    });
    const result = compareLensSnapshots(note, market);
    expect(result.comparable).toBe(true);
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].lensId).toBe('pattern');
  });

  test('カタログ未定義の数値キーは比較されず、bool キーのみフォールバック比較される', () => {
    const note = snapshotWith({
      unknown_lens: entry({ some_flag: true, some_number: 0.1, some_text: 'a' }),
    });
    const market = snapshotWith({
      unknown_lens: entry({ some_flag: true, some_number: 0.9, some_text: 'b' }),
    });
    const result = compareLensSnapshots(note, market);
    expect(result.comparable).toBe(true);
    // bool 一致のみ寄与 → 1.0(数値・文字列の差は無視される)
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.breakdown[0].comparedKeys).toBe(1);
    expect(result.breakdown[0].skippedKeys).toBe(2);
  });
});

describe('compareLensSnapshots — 層重みプリセット(§6.3)', () => {
  // 状態層 = 完全一致(1.0)、指標層 = 完全不一致(0.0)の構図を作る
  const note = snapshotWith({
    pattern: entry({ doji: true }),
    'ind:rsi#p14': entry({ rsi_value: 0 }),
  });
  const market = snapshotWith({
    pattern: entry({ doji: true }),
    'ind:rsi#p14': entry({ rsi_value: 1 }),
  });

  test('既定(指標重視)は状態 0.35 / 指標 0.65 で集計される', () => {
    const result = compareLensSnapshots(note, market);
    expect(result.preset).toBe('indicator_focused');
    expect(result.score).toBeCloseTo(0.35, 5);
  });

  test('バランスは 0.5/0.5、状態重視は 0.65/0.35 で集計される', () => {
    expect(compareLensSnapshots(note, market, { preset: 'balanced' }).score).toBeCloseTo(0.5, 5);
    expect(compareLensSnapshots(note, market, { preset: 'state_focused' }).score).toBeCloseTo(
      0.65,
      5
    );
  });

  test('片層しか無い場合は存在する層だけで再正規化される', () => {
    const stateOnlyNote = snapshotWith({ pattern: entry({ doji: true }) });
    const stateOnlyMarket = snapshotWith({ pattern: entry({ doji: true }) });
    const result = compareLensSnapshots(stateOnlyNote, stateOnlyMarket);
    // 指標層が無くても状態層 1.0 がそのままスコアになる(0.35 に潰れない)
    expect(result.score).toBeCloseTo(1, 5);
  });

  test('lensWeightOverrides=0 でレンズを比較から外せる', () => {
    const result = compareLensSnapshots(note, market, {
      lensWeightOverrides: { 'ind:rsi#p14': 0 },
    });
    expect(result.score).toBeCloseTo(1, 5);
  });

  test('lensWeightOverrides の Infinity/NaN は無効としてレンズごと除外(スコアが NaN 化しない)', () => {
    const infinityResult = compareLensSnapshots(note, market, {
      lensWeightOverrides: { 'ind:rsi#p14': Number.POSITIVE_INFINITY },
    });
    expect(infinityResult.score).toBeCloseTo(1, 5);
    const nanResult = compareLensSnapshots(note, market, {
      lensWeightOverrides: { 'ind:rsi#p14': Number.NaN },
    });
    expect(nanResult.score).toBeCloseTo(1, 5);
  });

  test('confidence が低いレンズの寄与は自動的に下がる(w *= min(conf))', () => {
    // 状態層内: 一致レンズ(conf 1.0)と不一致レンズ(conf 0.1)
    const noteSnapshot = snapshotWith({
      pattern: entry({ doji: true }),
      dow_theory: entry({ pullback_active: false }, 0.1),
    });
    const marketSnapshot = snapshotWith({
      pattern: entry({ doji: true }),
      dow_theory: entry({ pullback_active: true }, 1),
    });
    const result = compareLensSnapshots(noteSnapshot, marketSnapshot);
    // (1*1 + 0*0.1) / 1.1 ≈ 0.909
    expect(result.score).toBeCloseTo(1 / 1.1, 3);
  });
});

describe('compareLensSnapshots — しきい値・一致レベル(§6.4)', () => {
  const note = snapshotWith({ 'ind:rsi#p14': entry({ rsi_value: 0.5 }) });

  test.each([
    [0.5, 1.0, 'strong'],
    [0.45, 0.95, 'strong'],
    [0.35, 0.85, 'medium'],
    [0.25, 0.75, 'weak'],
    [0.0, 0.5, 'none'],
  ])('市場側 rsi_value=%p → スコア %p / レベル %p', (marketValue, expectedScore, expectedLevel) => {
    const market = snapshotWith({ 'ind:rsi#p14': entry({ rsi_value: marketValue }) });
    const result = compareLensSnapshots(note, market);
    expect(result.score).toBeCloseTo(expectedScore, 5);
    expect(result.level).toBe(expectedLevel);
  });

  test('threshold オプションが発火判定に効く', () => {
    const market = snapshotWith({ 'ind:rsi#p14': entry({ rsi_value: 0.3 }) });
    // スコア 0.8
    expect(compareLensSnapshots(note, market, { threshold: 0.75 }).triggered).toBe(true);
    expect(compareLensSnapshots(note, market, { threshold: 0.85 }).triggered).toBe(false);
  });

  test('resolveMatchLevel は境界値ちょうどで上のレベルになる', () => {
    expect(resolveMatchLevel(0.9)).toBe('strong');
    expect(resolveMatchLevel(0.8)).toBe('medium');
    expect(resolveMatchLevel(0.7)).toBe('weak');
    expect(resolveMatchLevel(0.69)).toBe('none');
  });
});

describe('compareFeatureValue — 型別ルール(§6.2)', () => {
  test('順序 enum は順序距離に応じた部分点(完全一致のみにしない)', () => {
    const comparator = {
      kind: 'orderedEnum',
      order: ['contracting', 'low', 'normal', 'elevated', 'expanding'],
    } as const;
    expect(compareFeatureValue(comparator, 'low', 'low')).toBeCloseTo(1, 5);
    expect(compareFeatureValue(comparator, 'low', 'normal')).toBeCloseTo(0.75, 5);
    expect(compareFeatureValue(comparator, 'contracting', 'expanding')).toBeCloseTo(0, 5);
  });

  test('順序 enum の skipValues(unknown 等)はキーごとスキップ(null)', () => {
    const comparator = {
      kind: 'orderedEnum',
      order: ['early', 'middle', 'late'],
      skipValues: ['unknown'],
    } as const;
    expect(compareFeatureValue(comparator, 'unknown', 'late')).toBeNull();
  });

  test('カテゴリ enum は類似表 → 一致/不一致の順でフォールバック', () => {
    const comparator = {
      kind: 'categoricalEnum',
      table: { uptrend: { range: 0.3 } },
    } as const;
    expect(compareFeatureValue(comparator, 'uptrend', 'uptrend')).toBe(1);
    expect(compareFeatureValue(comparator, 'uptrend', 'range')).toBeCloseTo(0.3, 5);
    expect(compareFeatureValue(comparator, 'uptrend', 'downtrend')).toBe(0);
  });

  test('イベント比較: 同方向=1 / none同士=0.5 / 逆方向=0 / none×方向=0.25', () => {
    const comparator = { kind: 'event' } as const;
    expect(compareFeatureValue(comparator, 'bull', 'bull')).toBe(1);
    expect(compareFeatureValue(comparator, 'none', 'none')).toBe(0.5);
    expect(compareFeatureValue(comparator, 'bull', 'bear')).toBe(0);
    expect(compareFeatureValue(comparator, 'none', 'bear')).toBe(0.25);
  });

  test('normalizedLinear の sentinel はスキップ、cap 超過は飽和', () => {
    const comparator = { kind: 'normalizedLinear', cap: 20, sentinel: -1 } as const;
    expect(compareFeatureValue(comparator, -1, 5)).toBeNull();
    expect(compareFeatureValue(comparator, 5, -1)).toBeNull();
    expect(compareFeatureValue(comparator, 10, 10)).toBeCloseTo(1, 5);
    expect(compareFeatureValue(comparator, 0, 20)).toBeCloseTo(0, 5);
    // 25 と 40 はどちらも cap 飽和で 1.0 扱い → 類似 1
    expect(compareFeatureValue(comparator, 25, 40)).toBeCloseTo(1, 5);
  });

  test('cyclic(UTC 時刻等)は周回をまたいだ近さを評価する', () => {
    const comparator = { kind: 'cyclic', modulo: 24 } as const;
    expect(compareFeatureValue(comparator, 23, 1)).toBeCloseTo(1 - 2 / 12, 5);
    expect(compareFeatureValue(comparator, 0, 12)).toBeCloseTo(0, 5);
    expect(compareFeatureValue(comparator, 9, 9)).toBeCloseTo(1, 5);
  });

  test('cyclic の奇数 modulo(曜日等)でも最遠点で類似度が 0 になる', () => {
    const comparator = { kind: 'cyclic', modulo: 7 } as const;
    // 月曜(1) vs 木曜(4): 整数値の最遠距離 3 → 0
    expect(compareFeatureValue(comparator, 1, 4)).toBeCloseTo(0, 5);
    // 土曜(6) vs 日曜(0): 周回距離 1 → 1 - 1/3
    expect(compareFeatureValue(comparator, 6, 0)).toBeCloseTo(1 - 1 / 3, 5);
  });

  test('型不一致(数値 vs 文字列等)は例外を投げずスキップ(null)', () => {
    expect(compareFeatureValue({ kind: 'linear', min: 0, max: 1 }, 'x', 0.5)).toBeNull();
    expect(compareFeatureValue({ kind: 'bool' }, 'true', true)).toBeNull();
    expect(compareFeatureValue({ kind: 'event' }, 'up', 'bull')).toBeNull();
    expect(
      compareFeatureValue({ kind: 'linear', min: 0, max: 1 }, Number.NaN, 0.5)
    ).toBeNull();
  });
});
