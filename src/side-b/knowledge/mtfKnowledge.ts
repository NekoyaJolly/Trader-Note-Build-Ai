/**
 * MTF（マルチタイムフレーム）知識モジュール
 *
 * 目的: 上位足の方向性バイアスをPlan AIに注入する。
 *
 * 設計:
 * - 上位足の12次元特徴量のうち3つ（trendDirection, trendStrength, maAlignment）を使用
 * - 「long / short / neutral」のバイアスに変換
 * - 矛盾ルールはタイムフレーム内に限定（上位足↑ + 下位足RSI過熱 ≠ 見送り）
 */

// ===========================================
// 型定義
// ===========================================

/**
 * 上位足コンテキスト
 */
export interface HigherTimeframeContext {
    /** 上位足のタイムフレーム（'1D' | '4H'） */
    timeframe: string;
    /** 上位足のトレンド方向（0-100） */
    trendDirection: number;
    /** 上位足のトレンド強度（0-100） */
    trendStrength: number;
    /** 上位足のMA配列スコア（0-100） */
    maAlignment: number;
    /** 判定されたバイアス */
    bias: 'long' | 'short' | 'neutral';
}

/**
 * 上位足と執行足の整合性
 */
export type MTFAlignment = 'aligned' | 'conflicting' | 'neutral';

// ===========================================
// MTF分析ルール（システムプロンプト用）
// ===========================================

/**
 * PlanAIのシステムプロンプトに注入するMTFルール
 */
export const MTF_ANALYSIS_RULES = `
## MTF（マルチタイムフレーム）分析ルール

上位足データが提供された場合、以下のルールに従うこと:

### タイムフレーム階層
- **上位足（日足/4H）**: 方向性を決定。ロング/ショートのバイアス
- **執行足（1H/15M）**: エントリータイミングを決定

### 重要: 上位足と執行足の「矛盾」について
- 上位足↑ + 執行足RSI過熱 → **見送りではない**。押し目買いチャンス
- 上位足↓ + 執行足↑シグナル → 戻り売りシナリオを優先
- **矛盾ルール（インジケーター同士の矛盾→見送り）は同一タイムフレーム内にのみ適用**

### バイアスの適用
- 上位足long: primaryシナリオはロング方向を優先
- 上位足short: primaryシナリオはショート方向を優先
- 上位足neutral: 既存ルールに従う（バイアスなし）

### 禁止事項
- 上位足longなのにshortをprimaryにしない（neutralの場合は例外）
- 上位足と執行足の矛盾だけを理由に全シナリオ見送りにしない
`.trim();

// ===========================================
// 分類関数
// ===========================================

/**
 * 上位足の特徴量からバイアスを判定
 *
 * ルール:
 * - trendDirection > 60 かつ trendStrength > 30 → long
 * - trendDirection < 40 かつ trendStrength > 30 → short
 * - それ以外 → neutral
 */
export function classifyHigherTFBias(
    trendDirection: number,
    trendStrength: number,
): HigherTimeframeContext['bias'] {
    // トレンド強度が弱い場合は方向感なし
    if (trendStrength <= 30) return 'neutral';

    // 方向性が中立圏の場合
    if (trendDirection >= 40 && trendDirection <= 60) return 'neutral';

    // 上昇バイアス
    if (trendDirection > 60) return 'long';

    // 下降バイアス
    return 'short';
}

/**
 * 上位足と執行足の整合性を判定
 */
export function classifyMTFAlignment(
    higherTFBias: HigherTimeframeContext['bias'],
    executionTFTrendDirection: number,
): MTFAlignment {
    if (higherTFBias === 'neutral') return 'neutral';

    const execBias = executionTFTrendDirection > 55 ? 'long'
        : executionTFTrendDirection < 45 ? 'short'
            : 'neutral';

    if (execBias === 'neutral') return 'neutral';
    if (execBias === higherTFBias) return 'aligned';
    return 'conflicting';
}

/**
 * 上位足の特徴量からHigherTimeframeContextを生成
 */
export function buildHigherTFContext(
    timeframe: string,
    featureVector: { trendDirection: number; trendStrength: number; maAlignment: number },
): HigherTimeframeContext {
    return {
        timeframe,
        trendDirection: featureVector.trendDirection,
        trendStrength: featureVector.trendStrength,
        maAlignment: featureVector.maAlignment,
        bias: classifyHigherTFBias(featureVector.trendDirection, featureVector.trendStrength),
    };
}

// ===========================================
// コンテキスト生成（buildPrompt用）
// ===========================================

/**
 * MTFコンテキスト文字列を生成
 */
export function getMTFContext(
    higherTF?: HigherTimeframeContext | null,
    executionTFTrendDirection?: number,
): string {
    if (!higherTF) return '';

    const parts: string[] = [];

    parts.push('\n## MTF分析（マルチタイムフレーム）');
    parts.push(`\n### 上位足（${higherTF.timeframe}）`);
    parts.push(`- トレンド方向: ${higherTF.trendDirection} (0=強い下降, 50=横ばい, 100=強い上昇)`);
    parts.push(`- トレンド強度: ${higherTF.trendStrength}`);
    parts.push(`- MA配列: ${higherTF.maAlignment}`);
    parts.push(`- **方向性バイアス: ${biasToJapanese(higherTF.bias)}**`);

    // MA配列の補助情報
    if (higherTF.maAlignment > 70) {
        parts.push(`- MA配列が整っている → バイアスの確信度高い`);
    } else if (higherTF.maAlignment < 30 && higherTF.bias !== 'neutral') {
        parts.push(`- ⚠️ MA配列が不整列 → トレンド転換の兆候の可能性`);
    }

    // 整合性判定
    if (executionTFTrendDirection !== undefined) {
        const alignment = classifyMTFAlignment(higherTF.bias, executionTFTrendDirection);
        parts.push('');
        parts.push('### 上位足と執行足の整合性');
        parts.push(`- 整合性: **${alignmentToJapanese(alignment)}**`);

        switch (alignment) {
            case 'aligned':
                parts.push('- → 方向性一致。信頼度+10%。通常のインジケータールールに従う');
                break;
            case 'conflicting':
                parts.push('- → 上位足の方向に従ったシナリオを優先。逆方向は「タイミング待ち」');
                break;
            case 'neutral':
                parts.push('- → 上位足の方向感なし。既存ルールに従う');
                break;
        }
    }

    return parts.join('\n');
}

// ===========================================
// ヘルパー
// ===========================================

function biasToJapanese(bias: HigherTimeframeContext['bias']): string {
    const map = {
        long: 'ロング（上昇バイアス）',
        short: 'ショート（下降バイアス）',
        neutral: '中立（方向感なし）',
    };
    return map[bias];
}

function alignmentToJapanese(alignment: MTFAlignment): string {
    const map = {
        aligned: '整合（同方向）',
        conflicting: '不整合（逆方向）',
        neutral: '中立',
    };
    return map[alignment];
}
