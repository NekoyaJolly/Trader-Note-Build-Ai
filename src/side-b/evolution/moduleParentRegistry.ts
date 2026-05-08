/**
 * ModuleParent Registry — フィルタ素材ライブラリ (Filter Evolution M4)。
 *
 * **設計書**: `docs/design/phase_filter_evolution_specification.md` §4
 *
 * 進化ループの crossover/mutation を「新戦略生成」ではなく「既存戦略の騙し
 * (false signal) 回避フィルタ追加」に再定義する設計の素材ライブラリ層。
 * M3 で再設計される crossover prompt が、親 A (= base setup) に追加できる
 * 「フィルタ部品」を ModuleParent として静的に提供する。
 *
 * **本 PR のスコープ (M4)**:
 * - ModuleParent 型 + registry を新設
 * - 静的選択ロジック (= 親 A 1 つに対して N 種類の ModuleParent 候補を返す)
 * - parentPoolPolicy / EvolutionLoop / CrossoverAgent に moduleEntries 経路を
 *   追加 (= interface 拡張のみ、prompt 改修は M3 で別 PR)
 *
 * **本 PR のスコープ外**:
 * - crossover prompt 自体の改修 (= M3)
 * - LLM が「親 A の負けトレードに対してどの ModuleParent を選ぶか」のロジック (= M3)
 * - 学習による ModuleParent 重み付け (= M4 MVP では静的、将来検討)
 */

/**
 * ModuleParent のカテゴリ。filter として戦略に追加するときの「何の機能群を
 * 使うか」を粗く分類する。
 *
 * カテゴリは設計書 §4.1 と一致 (= 5 種、将来 fundamentals を追加予定)。
 */
export type ModuleParentCategory =
  /** MTF Filter: 上位足トレンドや EMA との整合 (PR ⑤A〜⑤B 既存) */
  | 'mtf'
  /** TimeSession Filter: 時間帯 / 曜日 / ゴトー日 / 重要時間外 (PR ⑤D-1 既存) */
  | 'time_session'
  /** Pattern Filter: 直前ローソク足パターン回避 / 確認 (PR ②-1 既存) */
  | 'pattern'
  /** Market Structure Filter: ダウ理論 trend_state / pullback (DowTheoryLens 既存) */
  | 'market_structure'
  /** Volatility Filter: ATR / BB width / regime label (VolatilityRegimeLens 既存) */
  | 'volatility';

/**
 * ModuleParent: 戦略に追加できる「フィルタ部品」の仕様。
 *
 * 完成された戦略 DSL ではなく、**条件 1 つ分の素材**として定義する。crossover
 * agent が受け取り、親 A の DSL に AND 結合で追加する想定。
 */
export interface ModuleParent {
  /** registry 内 ID (= 一意、debug / observability 用) */
  readonly id: string;
  /** カテゴリ */
  readonly category: ModuleParentCategory;
  /**
   * 人間語の説明 (= LLM prompt にもそのまま渡す、騙し回避の意図含む)。
   * 例: "上位足 (1h) で uptrend のときだけ long を取り、レンジ騙しを除去する"
   */
  readonly description: string;
  /** lens 名 (= entry condition の `lens` フィールドにそのまま使う) */
  readonly lensName: string;
  /** feature key (= entry condition の `feature` フィールドにそのまま使う) */
  readonly featureKey: string;
  /**
   * 典型的な比較演算子 (= LLM が選ぶ候補、設計書 §4.2 のヒント)。
   * boolean feature なら ['is_true', 'is_false']、数値なら ['>', '<', '>=', '<=']。
   */
  readonly typicalOps: ReadonlyArray<'is_true' | 'is_false' | '>' | '<' | '>=' | '<=' | '=='>;
  /**
   * 典型値の参考ヒント (= LLM が値を決めるときの参考、最終決定は LLM)。
   * 例: "0.0008 〜 0.002 (= 通常レンジ)"、"['uptrend', 'downtrend']" 等。
   */
  readonly typicalValueHint?: string;
  /**
   * 推奨 regime (= 静的選択時のヒント、空なら全 regime で利用可)。
   * 例: ['breakout'] (= breakout 戦略との相性が良い)
   */
  readonly recommendedRegimes?: ReadonlyArray<string>;
}

// =================================================================
// Registry 定義
// =================================================================

/**
 * フィルタ素材の registry。
 *
 * 各カテゴリから代表的な 1〜2 種を選び、計 8 種で開始する。将来は registry
 * を branch ごとに拡張する想定。各エントリは「親 A に AND 追加できるシンプル
 * な条件 1 つ」の形に統一されている (= LLM が組み合わせやすくするため)。
 *
 * **Why immutable + 固定**: M4 MVP では静的選択。動的生成 / 学習 weight は
 * 将来 PR (= M3 観察データを踏まえて判断)。
 *
 * 各エントリも `Object.freeze` 済み (= 配列の shallow freeze だけだと entry の
 * プロパティが実行時変更可能になり「immutable」の建前が崩れるため、deep freeze
 * 相当を確保する)。
 */
export const MODULE_PARENT_REGISTRY: readonly ModuleParent[] = Object.freeze(
  (
    [
  // === MTF Filter ===
  {
    id: 'mtf-htf-trend-aligned',
    category: 'mtf',
    description:
      '上位足 (例: 1h) のトレンドと方向が一致しているときだけ entry。レンジ相場での騙しを除去する。',
    lensName: 'ohlcv@1h',
    featureKey: 'close',
    typicalOps: ['>', '<'],
    typicalValueHint: '上位足の EMA50 / EMA200 等 (= compareTarget 経路で他 indicator と比較)',
    recommendedRegimes: ['trending_with_pullback', 'breakout'],
  },
  // === TimeSession Filter ===
  {
    id: 'time-session-overlap-only',
    category: 'time_session',
    description:
      'ロンドン/NY オーバーラップ時間帯 (= 流動性が高い 13-16 UTC) でのみ entry。低流動性時間の騙しを除去。',
    lensName: 'time_session',
    featureKey: 'overlap_london_ny',
    typicalOps: ['is_true'],
    recommendedRegimes: ['breakout', 'trending_with_pullback'],
  },
  {
    id: 'time-session-avoid-friday-close',
    category: 'time_session',
    description:
      '金曜引け前 (= 週末ポジション避け) を除外。週末ギャップリスクと薄い流動性での騙しを除去。',
    lensName: 'time_session',
    featureKey: 'is_friday_close',
    typicalOps: ['is_false'],
  },
  // === Pattern Filter ===
  // PatternLens の features は CandlePatternId (= shared/patterns registry の id)
  // を直接 key として持つ。reversal 系で代表的な engulfing を採用。
  {
    id: 'pattern-engulfing-bull-confirm-for-long',
    category: 'pattern',
    description:
      'long entry の直前に強気エンガルフィング (= engulfing_bull) が確認されているか。reversal 戦略の早撃ち騙しを除去。',
    lensName: 'pattern',
    featureKey: 'engulfing_bull',
    typicalOps: ['is_true'],
    recommendedRegimes: ['reversal'],
  },
  {
    id: 'pattern-engulfing-bear-confirm-for-short',
    category: 'pattern',
    description:
      'short entry の直前に弱気エンガルフィング (= engulfing_bear) が確認されているか。reversal 戦略の早撃ち騙しを除去。',
    lensName: 'pattern',
    featureKey: 'engulfing_bear',
    typicalOps: ['is_true'],
    recommendedRegimes: ['reversal'],
  },
  // === Market Structure Filter (Dow Theory) ===
  {
    id: 'market-structure-trend-aligned',
    category: 'market_structure',
    description:
      'ダウ理論の trend_state が方向と一致 (long なら uptrend、short なら downtrend) のときだけ entry。レンジ騙しを除去。',
    lensName: 'dow_theory',
    featureKey: 'trend_state',
    typicalOps: ['=='],
    typicalValueHint: "['uptrend', 'downtrend', 'unclear']",
    recommendedRegimes: ['trending_with_pullback', 'breakout'],
  },
  {
    id: 'market-structure-no-pullback',
    category: 'market_structure',
    description:
      'pullback 中ではないときだけ entry (= 押し目買いの押し中ではなく、押し目から戻り始めた局面のみ)。早期 entry 騙しを除去。',
    lensName: 'dow_theory',
    featureKey: 'pullback_active',
    typicalOps: ['is_false'],
    recommendedRegimes: ['trending_with_pullback'],
  },
  // === Volatility Filter ===
  // VolatilityRegimeLens.classifyRegime の出力値 (BB幅 percentile による分類):
  //   contracting (<20%) / low (<40%) / normal (<60%) / elevated (<80%) / expanding (>=80%) / unknown
  {
    id: 'volatility-normal-regime-only',
    category: 'volatility',
    description:
      'ボラティリティが normal (= BB 幅 40-60 percentile) のときだけ entry。低ボラのレンジ騙し / 高ボラのスパイク騙しを両方除去。',
    lensName: 'volatility_regime',
    featureKey: 'regime_label',
    typicalOps: ['=='],
    typicalValueHint: "['contracting', 'low', 'normal', 'elevated', 'expanding'] のうち通常 'normal'",
  },
    ] satisfies readonly ModuleParent[]
  ).map((entry) => Object.freeze(entry)),
);

// =================================================================
// 選別ロジック
// =================================================================

export interface SelectModuleParentsOptions {
  /** 親候補の regime (= recommendedRegimes に基づくフィルタリングに使う) */
  readonly regime: string;
  /** 取得したい ModuleParent 件数 (= count >= 1) */
  readonly count: number;
  /**
   * 静的選択の seed (= テスト時の決定性を保つ用、optional)。
   * 未指定なら registry の先頭から count 件を返す。
   */
  readonly rotationOffset?: number;
}

/**
 * ModuleParent を静的選択する (M4 MVP)。
 *
 * 選別ルール:
 * 1. `recommendedRegimes` が指定されている entry は、`regime` に該当するもののみ採用候補
 * 2. `recommendedRegimes` が未指定の entry は全 regime で採用候補
 * 3. 上記候補から `rotationOffset` の位置を起点に round-robin で `count` 件返す
 * 4. 候補が `count` に満たなければ全 candidate で round-robin
 *
 * **Why ラウンドロビン**: M4 MVP では「使われていない素材を均等に試す」方針。
 * 学習による重み付け (= validationConfirmed に届いた child が使った素材を優先)
 * は将来 PR で別途対応する。
 *
 * **Why 静的**: LLM は「どの候補を選ぶか」ではなく「親 A の負けに対してどう
 * 組み合わせるか」を発見する役割に集中させる (= CLAUDE.md 原則 3)。
 */
export function selectModuleParents(options: SelectModuleParentsOptions): ModuleParent[] {
  const { regime } = options;
  // count を非負整数に正規化 (= 負数 / 小数 / NaN 入力をガード)
  const safeCount = Math.max(0, Math.floor(Number.isFinite(options.count) ? options.count : 0));
  if (safeCount <= 0) return [];

  // regime に合致する candidates を抽出
  const candidates = MODULE_PARENT_REGISTRY.filter((m) => {
    if (!m.recommendedRegimes || m.recommendedRegimes.length === 0) return true;
    return m.recommendedRegimes.includes(regime);
  });

  // 候補が空なら全 registry にフォールバック (= regime 未指定 / 想定外 regime)
  const pool = candidates.length > 0 ? candidates : MODULE_PARENT_REGISTRY;

  // rotationOffset を非負整数に正規化 (= JS の `%` は負数を返し得る、配列は小数 index 不可)
  const rawOffset = options.rotationOffset ?? 0;
  const safeOffset = Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0;
  // ((offset % len) + len) % len で必ず 0..len-1 に収める
  const normalizedOffset = ((safeOffset % pool.length) + pool.length) % pool.length;

  // round-robin で count 件返す
  const out: ModuleParent[] = [];
  for (let i = 0; i < safeCount; i++) {
    const idx = (normalizedOffset + i) % pool.length;
    out.push(pool[idx]);
  }
  return out;
}

/**
 * registry の全エントリを返す (= テスト / debug 用)。
 */
export function getAllModuleParents(): readonly ModuleParent[] {
  return MODULE_PARENT_REGISTRY;
}

/**
 * カテゴリ別に entry を取得する (= debug / observability 用)。
 */
export function getModuleParentsByCategory(category: ModuleParentCategory): ModuleParent[] {
  return MODULE_PARENT_REGISTRY.filter((m) => m.category === category);
}
