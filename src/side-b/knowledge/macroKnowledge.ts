/**
 * マクロ環境知識モジュール
 *
 * 目的: マクロ経済指標（VIX, DXY, 米国債利回り, S&P500）の
 *       知識をAI戦略立案に注入する。
 *
 * 設計:
 * - 各指標の数値を「状態フラグ」に変換
 * - AIには状態フラグ + 簡潔なルールを渡す
 * - テクニカル分析を上書きしない（補助レイヤー）
 */

// ===========================================
// 型定義
// ===========================================

/**
 * マクロ環境の生データ（API等から取得）
 */
export interface MacroEnvironmentData {
    /** VIX値 */
    vix?: number;
    /** VIXの前日比 */
    vixChange?: number;
    /** DXY値 */
    dxy?: number;
    /** DXYの20日SMA */
    dxySma20?: number;
    /** 米2年国債利回り(%) */
    yield2y?: number;
    /** 米5年国債利回り(%) */
    yield5y?: number;
    /** 米10年国債利回り(%) */
    yield10y?: number;
    /** いずれかの国債利回りの日次変動(bp) */
    yieldDailyChangeBp?: number;
    /** S&P500値 */
    sp500?: number;
    /** S&P500の50日SMA */
    sp500Sma50?: number;
    /** S&P500の日次リターン(%) */
    sp500DailyReturn?: number;
}

/**
 * マクロ環境の状態フラグ（AIに渡す判定結果）
 */
export interface MacroEnvironment {
    /** リスクセンチメント */
    riskSentiment: 'risk_on' | 'neutral' | 'risk_off';
    /** ボラティリティ環境 */
    volatilityRegime: 'low' | 'normal' | 'elevated' | 'crisis';
    /** イールドカーブシグナル */
    yieldCurveSignal: 'normal' | 'flattening' | 'inverted';
}

// ===========================================
// マクロ環境ルール（システムプロンプト用）
// ===========================================

/**
 * PlanAIのシステムプロンプトに注入するマクロ環境ルール
 */
export const MACRO_ENVIRONMENT_RULES = `
## マクロ環境の利用ルール

マクロ環境データが提供された場合、以下のルールに従うこと:

### ボラティリティ環境 (volatilityRegime)
- low/normal: テクニカル分析の信頼性高い。通常運用
- elevated: ポジションサイズ縮小推奨。シナリオ信頼度を10-20%減算
- crisis: 新規エントリー見送り推奨。warningsに「高ボラ環境」を含める

### リスクセンチメント (riskSentiment)
- risk_on: リスク資産のロングバイアス
- risk_off: 安全資産(金,円)に資金流入しやすい。リスク資産のロング信頼度を下げる
- neutral: マクロバイアスなし

### イールドカーブ (yieldCurveSignal)
- normal: 制約なし
- flattening: 信頼度5%減。warningsに「カーブフラット化」記載
- inverted: リスク資産の強気シナリオ信頼度を10-15%減。「リセッション警戒」を記載

### 重要: マクロはテクニカルを上書きしない
マクロ判定はシナリオの信頼度とwarningsに反映する。エントリー方向はテクニカル分析が決定する。
`.trim();

// ===========================================
// 状態フラグ変換関数
// ===========================================

/**
 * VIX値からボラティリティ環境を判定
 */
export function classifyVolatilityRegime(vix?: number): MacroEnvironment['volatilityRegime'] {
    if (vix === undefined || vix === null) return 'normal';
    if (vix > 30) return 'crisis';
    if (vix > 20) return 'elevated';
    if (vix < 15) return 'low';
    return 'normal';
}

/**
 * S&P500からリスクセンチメントを判定
 */
export function classifyRiskSentiment(
    sp500?: number,
    sp500Sma50?: number,
    sp500DailyReturn?: number,
): MacroEnvironment['riskSentiment'] {
    if (sp500 === undefined || sp500Sma50 === undefined) return 'neutral';

    // 急落チェック
    if (sp500DailyReturn !== undefined && sp500DailyReturn < -2) return 'risk_off';

    if (sp500 > sp500Sma50) return 'risk_on';
    if (sp500 < sp500Sma50 * 0.98) return 'risk_off'; // SMAを2%以上下回る
    return 'neutral';
}

/**
 * 米国債利回りからイールドカーブシグナルを判定
 */
export function classifyYieldCurve(
    yield2y?: number,
    yield10y?: number,
): MacroEnvironment['yieldCurveSignal'] {
    if (yield2y === undefined || yield10y === undefined) return 'normal';

    const spread = yield10y - yield2y;
    if (spread < 0) return 'inverted';
    if (spread < 0.25) return 'flattening';
    return 'normal';
}

/**
 * マクロデータからマクロ環境を判定
 */
export function classifyMacroEnvironment(data?: MacroEnvironmentData | null): MacroEnvironment {
    if (!data) {
        return {
            riskSentiment: 'neutral',
            volatilityRegime: 'normal',
            yieldCurveSignal: 'normal',
        };
    }

    return {
        volatilityRegime: classifyVolatilityRegime(data.vix),
        riskSentiment: classifyRiskSentiment(data.sp500, data.sp500Sma50, data.sp500DailyReturn),
        yieldCurveSignal: classifyYieldCurve(data.yield2y, data.yield10y),
    };
}

// ===========================================
// コンテキスト生成（buildPrompt用）
// ===========================================

/**
 * マクロ環境データからAIプロンプト用のコンテキスト文字列を生成
 */
export function getMacroContext(data?: MacroEnvironmentData | null): string {
    if (!data) return '';

    const env = classifyMacroEnvironment(data);
    const parts: string[] = [];

    parts.push('\n## マクロ環境');

    // VIX
    if (data.vix !== undefined) {
        const vixTrend = data.vixChange !== undefined
            ? (data.vixChange > 0 ? '↑上昇中' : data.vixChange < 0 ? '↓下降中' : '→横ばい')
            : '';
        parts.push(`- VIX: ${data.vix} ${vixTrend} → ボラ環境: ${volatilityRegimeToJapanese(env.volatilityRegime)}`);
    }

    // DXY
    if (data.dxy !== undefined) {
        const dxyBias = data.dxySma20 !== undefined
            ? (data.dxy > data.dxySma20 ? 'ドル高基調' : data.dxy < data.dxySma20 ? 'ドル安基調' : '中立')
            : '方向不明';
        parts.push(`- DXY: ${data.dxy} → ${dxyBias}`);
    }

    // イールドカーブ
    if (data.yield2y !== undefined && data.yield10y !== undefined) {
        const spread = (data.yield10y - data.yield2y).toFixed(2);
        parts.push(`- 米国債: 2Y=${data.yield2y}% / 5Y=${data.yield5y ?? 'N/A'}% / 10Y=${data.yield10y}% (10Y-2Yスプレッド: ${spread}%) → ${yieldCurveToJapanese(env.yieldCurveSignal)}`);
        if (data.yieldDailyChangeBp !== undefined && Math.abs(data.yieldDailyChangeBp) > 10) {
            parts.push(`  ⚠️ 金利急変動: ${data.yieldDailyChangeBp > 0 ? '+' : ''}${data.yieldDailyChangeBp}bp`);
        }
    }

    // S&P500
    if (data.sp500 !== undefined) {
        const returnStr = data.sp500DailyReturn !== undefined
            ? ` (日次${data.sp500DailyReturn > 0 ? '+' : ''}${data.sp500DailyReturn.toFixed(2)}%)`
            : '';
        parts.push(`- S&P500: ${data.sp500}${returnStr} → リスクセンチメント: ${riskSentimentToJapanese(env.riskSentiment)}`);
    }

    // 総合判定
    parts.push('');
    parts.push('### マクロ総合判定');
    parts.push(`- ボラティリティ環境: **${volatilityRegimeToJapanese(env.volatilityRegime)}**`);
    parts.push(`- リスクセンチメント: **${riskSentimentToJapanese(env.riskSentiment)}**`);
    parts.push(`- イールドカーブ: **${yieldCurveToJapanese(env.yieldCurveSignal)}**`);

    return parts.join('\n');
}

// ===========================================
// ヘルパー（日本語変換）
// ===========================================

function volatilityRegimeToJapanese(regime: MacroEnvironment['volatilityRegime']): string {
    const map = {
        low: '低ボラ（安定）',
        normal: '通常',
        elevated: '警戒（ポジション縮小推奨）',
        crisis: '危機（エントリー見送り推奨）',
    };
    return map[regime];
}

function riskSentimentToJapanese(sentiment: MacroEnvironment['riskSentiment']): string {
    const map = {
        risk_on: 'リスクオン（リスク選好）',
        neutral: '中立',
        risk_off: 'リスクオフ（リスク回避）',
    };
    return map[sentiment];
}

function yieldCurveToJapanese(signal: MacroEnvironment['yieldCurveSignal']): string {
    const map = {
        normal: '正常（順イールド）',
        flattening: 'フラット化（先行き不透明）',
        inverted: '逆転（リセッション警戒）',
    };
    return map[signal];
}
