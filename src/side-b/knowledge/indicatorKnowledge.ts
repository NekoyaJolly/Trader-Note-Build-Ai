/**
 * インジケーター知識モジュール
 *
 * 目的: Side-B AIに戦略立案の基礎知識を提供する3階層システム
 *
 * Layer 1: CORE_TRADING_RULES
 *   → システムプロンプトに常駐。絶対に守るべきルールと優先順位。
 *
 * Layer 2: INDICATOR_CONTEXT + getRelevantIndicatorContext()
 *   → buildPrompt() で自動注入。渡されたインジケーターに関連する知識のみ。
 *
 * Layer 3: (将来) ツール経由で過去ノートやバックテスト結果を参照。
 */

import type { JsonValue } from '../../utils/jsonValue';

/**
 * `getRelevantIndicatorContext` などのコンテキスト生成関数が受け取る
 * インジケーター値の型。値の中身までは見ずキー名で分岐するため、
 * JSON 互換の値型 (`JsonValue | undefined`) で広めに受ける。
 */
export type IndicatorContextValue = JsonValue | undefined;

// ===========================================
// Layer 1: コアトレーディングルール
// ===========================================

/**
 * システムプロンプトに注入するコアルール。
 * 短く、確実に遵守してもらう「絶対ルール」のみ。
 */
export const CORE_TRADING_RULES = `
## トレーディング判断品質ルール

### 単独判断の禁止
どのインジケーター・レンズも単独で売買判断の根拠にしてはならない。最低2系統(異なるカテゴリ)の合意を要求する。

### 採用理由の明示義務
使用したインジケーター/レンズについて、なぜそれを選んだかを必ず明記する。同時に、使わなかった主要なインジケーター/レンズについてもなぜ使わなかったかを明記する。

### オッカムの剃刀の原則
同じトレード判断を異なる指標の組み合わせで説明できる場合、最も少ない指標数で説明できる仮説を優先する。複雑な組み合わせは、より単純な説明が不可能である時のみ採用する。

### 矛盾の取り扱い
インジケーター同士が矛盾する場合、それは「見送りの理由」ではなく「解釈が必要な市場状態」として扱う。「この矛盾が示す市場状態は何か」を必ず言語化する。

### 多重検定問題への自覚
多数のインジケーター・レンズの中から組み合わせを試せば、偶然有意に見えるものが必ず出現する。あなたが見つけたパターンが偶然ではないと示せる理由(過去の再現事例、市場構造からの説明、等)を述べられない場合、そのパターンをエッジとして採用してはならない。

### 「エントリーしない」判断の価値
全てのトレードに参加する必要はない。条件が揃わない場合に見送る判断は、悪い判断よりはるかに価値が高い。

### 禁止事項
- ADXの値だけでトレンド方向を判断すること(ADXは強度のみ)
- ATRの値だけで方向性を判断すること(ATRは大きさのみ)
- 1回のバックテスト結果でエッジを確定すること(N=1は棄却)
- 「なんとなくそう思う」「チャートパターンが綺麗」等、言語化不能な理由で判断すること

### 12次元特徴量の意味
0-100の正規化スコアで市場状態を表現する共通言語。
- トレンド系(4次元): 強度、方向(0=強下降,50=横,100=強上昇)、MA配列、価格位置
- モメンタム系(3次元): RSI、MACDモメンタム、ダイバージェンス(0=なし,100=強い)
- ボラティリティ系(3次元): レベル、BB幅、傾向(拡大方向なら高い)
- 価格構造系(2次元): サポート近接(100=直近)、レジスタンス近接(100=直近)
`.trim();

// ===========================================
// Layer 2: インジケーターコンテキスト
// ===========================================

/**
 * 各インジケーターの要約コンテキスト。
 * indicators/ のmdファイルから「読み方のポイント」「禁止事項」を凝縮。
 * buildPrompt() で使うインジケーターに応じて自動注入される。
 */
export const INDICATOR_CONTEXT: Record<string, string> = {
    // --- トレンド系 ---
    sma: [
        'SMA: トレンド方向の判定主軸。',
        '短期>中期>長期=上昇トレンド（ゴールデンクロス配列）。',
        '価格とSMAの乖離率でトレンド過熱を判断。',
        '他インジケーターとの矛盾時はSMAの方向を優先。',
    ].join(' '),

    ema: [
        'EMA: SMAより反応が早いトレンド指標。',
        '短期EMA(9,21)でエントリータイミング精度向上。',
        'SMAと同じ方向ならトレンド確認強化。',
        'レンジ相場では頻繁にクロスが発生するため注意。',
    ].join(' '),

    dema: [
        'DEMA: ラグを軽減した高速移動平均。',
        '短期間設定(5未満)はノイズが多い。',
        'レンジ相場でのクロスはダマシが多い。',
        'トレンド系指標と組み合わせて使用すること。',
    ].join(' '),

    tema: [
        'TEMA: 最小ラグの超高速移動平均。',
        '短期間設定(10未満)はノイズが非常に多い。',
        '必ずADX等のトレンドフィルターと組み合わせること。',
    ].join(' '),

    adx: [
        'ADX: トレンドの「強さ」のみを測定（方向は示さない）。',
        'ADX>25=トレンドあり、ADX<20=レンジ相場。',
        '+DI>−DI=上昇圧力優勢、−DI>+DI=下降圧力優勢。',
        'ADX下落=トレンド反転ではなく弱化のみ。',
        'ADXのクロスオーバー(25上抜け等)は遅延あり。',
    ].join(' '),

    aroon: [
        'Aroon: トレンドの強さと方向を判断。',
        'Up=100: 直近で最高値発生。Down=100: 直近で最安値発生。',
        '両方が高い=激しいレンジ、両方が低い=方向感なし。',
        'クロスだけでなく、両線の絶対値レベルも確認すること。',
        'SMAトレンド方向と併用して確認。',
    ].join(' '),

    psar: [
        'PSAR: トレンド方向とトレーリングストップレベル。',
        'レンジ相場では頻繁に反転しダマシが多い。',
        '必ずADXなどのトレンドフィルターと併用。',
        'AF設定を大きくしすぎるとノイズ増加。',
    ].join(' '),

    supertrend: [
        'Supertrend: ATRベースのトレンドフォロー。',
        'レンジ相場ではダマシが発生→ADXと併用推奨。',
        '反転シグナル直後は確認を待つ。',
        'multiplierを小さくしすぎるとノイズ増加。',
    ].join(' '),

    ichimoku: [
        '一目均衡表: 総合トレンド分析（雲、転換線、基準線、遅行線）。',
        'デフォルト設定(9,26,52)は日足用→時間軸に合わせて調整。',
        '雲の中での売買は方向感がないため避ける。',
        '三役好転/逆転は強いシグナルだが遅延あり。',
    ].join(' '),

    // --- モメンタム系 ---
    rsi: [
        'RSI: 過熱判定(買われすぎ/売られすぎ)。',
        '70超=買われすぎ、30未満=売られすぎ。',
        '強トレンド中は80-20まで拡張して判断。',
        'RSI単独での逆張りは禁止。トレンド方向と併用。',
        'ダイバージェンス(価格と逆行)はトレンド転換の兆候。',
    ].join(' '),

    macd: [
        'MACD: トレンド変化の兆候検出。',
        'クロスを絶対シグナルとして扱わず補助的に使用。',
        'ヒストグラムの拡大/縮小でモメンタムの加速/減速を判断。',
        'ゼロライン上=強気圏、下=弱気圏。',
        'SMA/EMAの方向と併用して判断。',
    ].join(' '),

    stochastic: [
        'Stochastic: 価格の相対位置で過熱判定。',
        '80超=買われすぎ、20未満=売られすぎ。',
        '強トレンド中は80/20に張り付くため逆張りシグナルとして機能しにくい。',
        'SMAトレンド方向と矛盾時は見送り推奨。',
    ].join(' '),

    cci: [
        'CCI: 平均価格からの乖離度。',
        '±100はトレンドの強さを示す（買われすぎ/売られすぎではない）。',
        '逆張りではなく順張り指標として使用。',
        'SMAトレンド方向と併用して確認。',
    ].join(' '),

    roc: [
        'ROC: 価格変化率。',
        '値が大きい=買われすぎではない（単純な変化率）。',
        '急激な価格変動時は値が極端になるため注意。',
        'SMAトレンド方向と併用。',
    ].join(' '),

    williamsR: [
        'Williams %R: 買われすぎ/売られすぎ（反転型スケール）。',
        '-20以上=買われすぎ、-80以下=売られすぎ。',
        '強トレンド中は張り付くため逆張り不可。',
        'Stochasticと実質同じ→両方同時に使う意味は薄い。',
    ].join(' '),

    // --- ボラティリティ系 ---
    bb: [
        'BB(ボリンジャーバンド): ボラティリティと価格位置。',
        'バンドタッチ=即反転ではない（トレンド中はバンドウォーク）。',
        'スクイーズ(幅縮小)=大きな動きの前兆。',
        'RSIとの矛盾フラグ時はエントリー見送り推奨。',
    ].join(' '),

    atr: [
        'ATR: ボラティリティ測定（方向性は示さない）。',
        'ストップロス距離やポジションサイズの参考値。',
        '値の大小は「どれくらい動くか」を示し「どちらに動くか」は不明。',
    ].join(' '),

    kc: [
        'KC(ケルトナーチャネル): ATRベースのバンド。',
        'バンドタッチ=即反転ではない。BBとの併用でスクイーズ検出が効果的。',
        'トレンド方向を確認してから使用。',
    ].join(' '),

    // --- 出来高系 ---
    obv: [
        'OBV: 出来高の累積方向。',
        '絶対値ではなく方向性とダイバージェンスを重視。',
        '出来高データがない/信頼性が低い市場では使用しない。',
        'SMAトレンドと併用。',
    ].join(' '),

    vwap: [
        'VWAP: 出来高加重平均価格。日中取引の基準。',
        '日をまたぐと意味が薄れる。',
        '上なら買い優勢、下なら売り優勢（機関投資家の基準）。',
        '出来高データがない市場では使用不可。',
    ].join(' '),

    mfi: [
        'MFI: 出来高加重RSI。',
        '80超=買われすぎ、20未満=売られすぎ。',
        '出来高データがない銘柄では使用不可。',
        'RSIと両方買われすぎを確認推奨。FX(為替)はTick Volume精度注意。',
    ].join(' '),

    cmf: [
        'CMF: 資金流入/流出強度。',
        '正=買い圧力、負=売り圧力。',
        '±0.05未満は信頼性低い。',
        '出来高データがない銘柄では使用不可。トレンド方向と組み合わせ。',
    ].join(' '),

    // --- サポレジ系 ---
    pivot: [
        'Pivot: 前日データから自動S/Rレベル計算。',
        '流動性の低い時間帯はダマシが増える。',
        '重要経済指標発表時はレベルが無視されやすい。',
        '利確/損切りレベルの参考として使用。',
    ].join(' '),
};

// ===========================================
// Layer 2: コンテキスト注入ヘルパー
// ===========================================

/**
 * IndicatorData のキーと INDICATOR_CONTEXT のキーのマッピング。
 * IndicatorData のフィールド名から、関連するインジケーター知識を特定する。
 */
const INDICATOR_FIELD_MAPPING: Record<string, string[]> = {
    rsi: ['rsi'],
    macd: ['macd'],
    sma20: ['sma'],
    sma50: ['sma'],
    sma200: ['sma'],
    ema20: ['ema'],
    atr: ['atr'],
    bbUpper: ['bb'],
    bbLower: ['bb'],
    bbMiddle: ['bb'],
};

/**
 * インジケーターデータに含まれるフィールドに基づいて、
 * 関連するインジケーターのコンテキストを自動収集する。
 *
 * @param indicators インジケーターデータ（undefined可能なフィールドを持つオブジェクト）
 * @returns 関連するインジケーター知識を結合した文字列（なければ空文字列）
 */
export function getRelevantIndicatorContext(
    // 値の中身は見ずキーの有無と null/undefined チェックのみ行うため、
    // JSON 互換の任意値 (`JsonValue`) で受け取れば充分。
    indicators?: Record<string, IndicatorContextValue> | null
): string {
    if (!indicators) return '';

    const usedIndicators = new Set<string>();

    for (const [field, value] of Object.entries(indicators)) {
        if (value === undefined || value === null) continue;

        const mappedNames = INDICATOR_FIELD_MAPPING[field];
        if (mappedNames) {
            for (const name of mappedNames) {
                usedIndicators.add(name);
            }
        }
    }

    if (usedIndicators.size === 0) return '';

    const contextLines: string[] = [];
    for (const name of usedIndicators) {
        const ctx = INDICATOR_CONTEXT[name];
        if (ctx) {
            contextLines.push(`- ${ctx}`);
        }
    }

    if (contextLines.length === 0) return '';

    return `\n## 使用インジケーターの知識\n${contextLines.join('\n')}`;
}

/**
 * Plan AI 用の拡張コンテキストを生成。
 * Research AI より詳しく、12次元特徴量の読み方も含む。
 *
 * @param featureVector 12次元特徴量（コンテキスト判定に使用）
 * @param indicators インジケーターデータ
 * @returns 拡張コンテキスト文字列
 */
export function getPlanIndicatorContext(
    featureVector: Record<string, number>,
    indicators?: Record<string, IndicatorContextValue> | null
): string {
    const parts: string[] = [];

    // インジケーター知識（Layer 2基本）
    const indicatorCtx = getRelevantIndicatorContext(indicators);
    if (indicatorCtx) {
        parts.push(indicatorCtx);
    }

    // 特徴量に基づく状況判定ガイド
    const situationGuide: string[] = [];

    if (featureVector.trendStrength !== undefined) {
        if (featureVector.trendStrength < 20) {
            situationGuide.push('- トレンド強度が低い(ADX<20相当): レンジ戦略を検討。トレンドフォロー系のシグナルは信頼性低下。');
        } else if (featureVector.trendStrength > 70) {
            situationGuide.push('- トレンド強度が高い(ADX>70相当): 強いトレンド中。逆張りシグナル(RSI過熱等)は無視してよい。');
        }
    }

    if (featureVector.rsiLevel !== undefined) {
        if (featureVector.rsiLevel > 70) {
            situationGuide.push('- RSI過熱圏(70超): 強トレンド中なら継続の可能性あり。トレンドと矛盾なら見送り。');
        } else if (featureVector.rsiLevel < 30) {
            situationGuide.push('- RSI売られすぎ(30未満): 反発の可能性あるがトレンド方向を最優先で確認。');
        }
    }

    if (featureVector.momentumDivergence !== undefined && featureVector.momentumDivergence > 60) {
        situationGuide.push('- ダイバージェンス検出: トレンド転換の兆候。エントリー/イグジットに注意。');
    }

    if (situationGuide.length > 0) {
        parts.push(`\n## 状況判定ガイド\n${situationGuide.join('\n')}`);
    }

    return parts.join('\n');
}
