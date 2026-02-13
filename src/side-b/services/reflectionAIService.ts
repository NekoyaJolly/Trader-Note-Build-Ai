/**
 * Reflection AI サービス（振り返り AI）
 * 
 * 目的: トレード完了後に自動で振り返り分析を行い、学びを抽出する
 * 
 * 設計思想:
 * - PDCA の「Check/Act」フェーズを担当
 * - トレード結果 + 市場分析 + 戦略コンテキストを入力に、
 *   構造化された振り返りレポートを生成
 * - 学びを AgentMemory に蓄積し、次の Strategy Thinker に渡す
 * 
 * 既存コードとの関係:
 * - aiNoteService.ts: エントリー/決済分析ロジックを参照（プロンプト補強）
 * - agentMemory.ts: lessons に書き込み
 * - pdcaLoop.ts: REFLECTING ハンドラから呼び出し
 * 
 * 使用モデル: 環境変数 AI_MODEL / AI_BASE_URL から取得（OpenAI互換 API）
 */

import { config } from '../../config';
import type { TradeResultSummary, TodayStrategyContext } from '../agent/agentMemory';
import {
    ReflectionOutputSchema,
    type ReflectionOutput,
} from '../../schemas/api/sideB';

// ===========================================
// 型定義
// ===========================================

/**
 * 振り返り結果の Zod スキーマおよび関連する出力型は
 * `src/schemas/api/sideB.ts` に集約して定義する。
 *
 * - ReflectionOutputSchema
 * - ReflectionOutput
 *
 * このサービスでは共通スキーマから import して利用する。
 */

/**
 * Reflection AI への入力
 */
export interface ReflectionInput {
    /** トレード結果 */
    trade: TradeResultSummary;
    /** 当日の戦略コンテキスト（あれば） */
    strategyContext?: TodayStrategyContext;
    /** 過去の学び（あれば） */
    existingLessons?: string[];
}

/**
 * Reflection AI の結果
 */
export interface ReflectionResult {
    /** 振り返り出力 */
    output: ReflectionOutput;
    /** 要約テキスト（TradeResultSummary.reflection に保存） */
    summary: string;
    /** トークン使用量 */
    tokenUsage: number;
    /** 使用モデル */
    model: string;
}

// ===========================================
// サービスクラス
// ===========================================

/** 最大リトライ回数 */
const MAX_RETRY_ATTEMPTS = 3;

export class ReflectionAIService {
    private apiKey: string;
    private model: string;
    private baseURL: string;

    constructor() {
        this.apiKey = process.env.AI_API_KEY || '';
        this.model = process.env.AI_MODEL || 'gpt-4o-mini';
        this.baseURL = process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1';
    }

    /**
     * トレードの振り返りを生成
     */
    async reflect(input: ReflectionInput): Promise<ReflectionResult> {
        if (!this.apiKey) {
            console.warn('[ReflectionAI] APIキーが設定されていません。フォールバックを返します。');
            return this.generateFallback(input.trade);
        }

        const prompt = this.buildPrompt(input);
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                const result = await this.callAI(prompt);

                // バリデーション
                const parsed = ReflectionOutputSchema.parse(result.content);

                const summary = this.buildSummary(parsed, input.trade);

                console.log(
                    `[ReflectionAI] ${input.trade.symbol} 振り返り完了 (試行${attempt}/${MAX_RETRY_ATTEMPTS}): スコア${parsed.overallScore} / ${parsed.lessons.length}件の学び`,
                );

                return {
                    output: parsed,
                    summary,
                    tokenUsage: result.tokenUsage,
                    model: result.model,
                };
            } catch (error) {
                lastError = error;
                console.error(`[ReflectionAI] エラー（試行${attempt}/${MAX_RETRY_ATTEMPTS}）:`, error);

                // 最大試行回数未満の場合は指数バックオフで待機してリトライ
                if (attempt < MAX_RETRY_ATTEMPTS) {
                    const delayMs = 500 * 2 ** (attempt - 1);
                    console.log(`[ReflectionAI] ${delayMs}ms 待機後にリトライします...`);
                    await this.sleep(delayMs);
                }
            }
        }

        console.error('[ReflectionAI] 最大リトライ回数に達しました。フォールバックを返します。最後のエラー:', lastError);
        return this.generateFallback(input.trade);
    }

    /**
     * 指定ミリ秒だけ待機するユーティリティ
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    // --- プロンプト構築 ---

    /**
     * 振り返りプロンプトを構築
     */
    private buildPrompt(input: ReflectionInput): string {
        const { trade, strategyContext, existingLessons } = input;

        const pnlSign = trade.pnlPips > 0 ? '+' : '';

        let prompt = `# トレード振り返り分析

## トレード概要
- **通貨ペア**: ${trade.symbol}
- **方向**: ${trade.direction}
- **エントリー価格**: ${trade.entryPrice}
- **決済価格**: ${trade.exitPrice}
- **損益**: ${pnlSign}${trade.pnlPips.toFixed(1)} pips
- **結果**: ${trade.outcome === 'win' ? '勝ち ✅' : trade.outcome === 'loss' ? '負け ❌' : '引き分け ➖'}
- **決済理由**: ${trade.exitReason}
- **トレード日時**: ${trade.tradedAt.toISOString().split('T')[0]}
- **保有時間**: ${this.calculateHoldingTime(trade)}

## 戦略の意図
${trade.strategyRationale || '（情報なし）'}`;

        // 戦略コンテキストがあれば追加
        if (strategyContext) {
            const analysis = strategyContext.baseAnalysis;
            prompt += `

## 当日の市場分析
- **レジーム**: ${analysis.regime}
- **方向**: ${analysis.direction}
- **ボラティリティ**: ${analysis.volatility}
- **信頼度**: ${analysis.confidence}%
- **重要な観察**: ${analysis.reasoning.keyObservation}

## 当日の戦略
${strategyContext.strategies.map(s =>
                `- ${s.name}: ${s.direction} @${s.entryPrice} (信頼度${s.confidence}%) [${s.status}]`
            ).join('\n')}
- 修正回数: ${strategyContext.revisedCount}回`;
        }

        // 既存の学びがあれば追加
        if (existingLessons && existingLessons.length > 0) {
            prompt += `

## これまでの学び（参考）
${existingLessons.slice(-5).map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
        }

        prompt += `

## 分析してほしいこと
1. **勝因/敗因**: なぜこの結果になったのか？
2. **エントリー評価**: エントリーのタイミングと価格は適切だったか？
3. **決済評価**: 決済のタイミングは適切だったか？ もっと良い選択肢はあったか？
4. **次回への学び**: 同じ状況で次はどうすべきか？（具体的かつ実行可能な学び）
5. **戦略修正**: 戦略そのものに修正が必要か？

## 出力形式（JSON）

\`\`\`json
{
  "outcomeAnalysis": "<勝因/敗因の分析 — 2-3文で簡潔に>",
  "entryEvaluation": {
    "rating": "excellent" | "good" | "neutral" | "poor" | "bad",
    "comment": "<エントリー評価の根拠>"
  },
  "exitEvaluation": {
    "rating": "excellent" | "good" | "neutral" | "poor" | "bad",
    "comment": "<決済評価の根拠>"
  },
  "lessons": [
    "<学び1: 具体的で次回実行可能な内容>",
    "<学び2: 同上（必要があれば）>"
  ],
  "strategyAdjustment": "<戦略修正の提案（不要なら省略可能）>",
  "overallScore": <0-100: トレードの総合評価>
}
\`\`\`

重要:
- 日本語で記述してください
- lessonsは1-3件、具体的で「次回〜すべき」の形式
- overallScoreの基準: 90+=完璧, 70-89=良好, 50-69=普通, 30-49=改善必要, <30=要反省
- 有効なJSONのみを出力`;

        return prompt;
    }

    // --- AI呼び出し ---

    /**
     * AI APIを呼び出し
     */
    private async callAI(prompt: string): Promise<{ content: unknown; tokenUsage: number; model: string }> {
        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: `あなたは経験豊富なFXトレードコーチです。
トレーダーの取引を振り返り、建設的なフィードバックと具体的な学びを提供してください。

振り返りの原則:
- 結果論ではなく、プロセスを評価する（結果が利益でもプロセスが悪ければ指摘する）
- 「たられば」は最小限に。次に実行可能な具体的アドバイスを重視
- 同じミスを繰り返さないための、短く記憶に残るルールを提示
- 良かった点も必ず指摘する（全否定しない）
- 必ず有効なJSONのみを出力してください`,
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.4,
                max_tokens: 1500,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`AI API エラー: ${response.status} - ${errorBody}`);
        }

        const data = await response.json() as {
            choices?: { message?: { content?: string } }[];
            usage?: { total_tokens?: number };
            model?: string;
        };

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('AI APIからの応答が空です');
        }

        const parsed = JSON.parse(content);

        return {
            content: parsed,
            tokenUsage: data.usage?.total_tokens || 0,
            model: data.model || this.model,
        };
    }

    // --- ヘルパー ---

    /**
     * 振り返りサマリーを構築（TradeResultSummary.reflection に保存する短いテキスト）
     */
    private buildSummary(output: ReflectionOutput, trade: TradeResultSummary): string {
        const pnlSign = trade.pnlPips > 0 ? '+' : '';
        const emoji = trade.outcome === 'win' ? '✅' : trade.outcome === 'loss' ? '❌' : '➖';
        return `${emoji} ${trade.symbol} ${trade.direction} ${pnlSign}${trade.pnlPips.toFixed(1)}pips | ` +
            `スコア${output.overallScore} | ${output.lessons[0]}`;
    }

    /**
     * 保有時間を計算
     */
    private calculateHoldingTime(trade: TradeResultSummary): string {
        const diffMs = trade.closedAt.getTime() - trade.tradedAt.getTime();
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}時間${minutes}分`;
        }
        return `${minutes}分`;
    }

    /**
     * フォールバック結果（API失敗時）
     */
    private generateFallback(trade: TradeResultSummary): ReflectionResult {
        const isWin = trade.outcome === 'win';
        const fallback: ReflectionOutput = {
            outcomeAnalysis: isWin
                ? `${trade.symbol} ${trade.direction} で ${trade.pnlPips.toFixed(1)}pips の利益を確保。`
                : `${trade.symbol} ${trade.direction} で ${Math.abs(trade.pnlPips).toFixed(1)}pips の損失。${trade.exitReason}により決済。`,
            entryEvaluation: {
                rating: 'neutral',
                comment: 'API未接続のため評価不可',
            },
            exitEvaluation: {
                rating: 'neutral',
                comment: 'API未接続のため評価不可',
            },
            lessons: [isWin
                ? '利益確定時はルールに従い機械的に決済する'
                : `${trade.exitReason}到達時の損失を受け入れ、次のトレードに集中する`
            ],
            overallScore: 50,
        };

        return {
            output: fallback,
            summary: this.buildSummary(fallback, trade),
            tokenUsage: 0,
            model: 'fallback',
        };
    }
}

// シングルトンインスタンス
export const reflectionAI = new ReflectionAIService();
