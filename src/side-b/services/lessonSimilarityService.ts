/**
 * Lesson Similarity Service（学び類似判定サービス）
 * 
 * 目的: AI（Gemini）を使って、新しい学びが既存の学びと意味的に類似しているか判定する
 * 
 * 設計思想:
 * - テキスト同士の意味的類似性を AI に判断させる
 * - 類似度 70% 以上 → 同じ趣旨と判断し、確信ルールへの昇格候補とする
 * - 統合テキスト（mergedText）も AI が生成 → より洗練された一文にまとめる
 * - 1 トレードあたり最大 1 回の API call（コスト制御）
 * 
 * 使用場面:
 * - Reflection AI が学びを生成した直後に呼ばれる
 * - AgentMemory.addLesson() 内から呼ばれる
 */

// ===========================================
// 型定義
// ===========================================

/**
 * 類似判定の結果
 */
export interface SimilarityResult {
    /** 最も類似した既存 lesson の index (-1 = 類似なし) */
    index: number;
    /** 類似度 (0-100) */
    similarity: number;
    /** 統合テキスト（2つの学びを1つにまとめた文） */
    mergedText: string;
}

/**
 * AI に送るバッチ判定リクエスト
 */
interface SimilarityRequest {
    newLesson: string;
    existingLessons: string[];
}

// ===========================================
// サービスクラス
// ===========================================

import { config, modelFor } from '../../config';
import { AIProvider } from '../agent/aiProvider';
import type { JsonValue } from '../../utils/jsonValue';

export class LessonSimilarityService {
    private apiKey: string;
    private model: string;
    private baseURL: string;

    constructor() {
        this.apiKey = process.env.AI_API_KEY || '';
        this.model = modelFor('lesson_similarity');
        this.baseURL = process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1';
    }

    /**
     * 新しい学びが既存の学びと類似しているか判定
     * 
     * @param newLesson - 新しい学びのテキスト
     * @param existingLessons - 既存の学びテキスト配列
     * @returns 最も類似した lesson の情報、または null（類似なし）
     */
    async findSimilar(
        newLesson: string,
        existingLessons: string[]
    ): Promise<SimilarityResult | null> {
        // 既存が空なら判定不要
        if (existingLessons.length === 0) {
            return null;
        }

        // API キーがない場合はフォールバック（部分文字列一致）
        if (!this.apiKey) {
            console.warn('[LessonSimilarity] APIキーなし — フォールバック判定を使用');
            return this.fallbackSimilarity(newLesson, existingLessons);
        }

        try {
            const prompt = this.buildPrompt({ newLesson, existingLessons });
            const result = await this.callAI(prompt);
            return this.parseResult(result);
        } catch (error) {
            console.error('[LessonSimilarity] AI判定エラー — フォールバック使用:', error);
            return this.fallbackSimilarity(newLesson, existingLessons);
        }
    }

    /**
     * プロンプトを構築
     */
    private buildPrompt(request: SimilarityRequest): string {
        const existingList = request.existingLessons
            .map((l, i) => `  ${i}: "${l}"`)
            .join('\n');

        return `あなたはトレード学習の類似判定エキスパートです。

## タスク
新しい学び（new）が、既存の学び（existing）の中に意味的に同じものがあるか判定してください。

## 新しい学び
"${request.newLesson}"

## 既存の学び一覧
${existingList}

## 判定基準
- 具体的な数値や銘柄名が異なっても、教訓の本質が同じなら「類似」
- 例: 「利確を焦らず待つべき」と「TPまで待つ忍耐が重要」→ 類似度 85%
- 例: 「SLを広げすぎた」と「利確を焦った」→ 異なる教訓（類似度 20%）

## 出力形式（JSON のみ）
類似するものがある場合:
{"index": 0, "similarity": 85, "mergedText": "2つの学びを統合した、より洗練された一文"}

類似するものがない場合:
{"index": -1, "similarity": 0, "mergedText": ""}

JSON のみを出力してください。説明は不要です。`;
    }

    /**
     * AIProvider 経由で AI API を呼び出し、JSON をパースして返す
     */
    private async callAI(prompt: string): Promise<JsonValue> {
        const provider = new AIProvider({
            apiKey: this.apiKey,
            model: this.model,
            baseURL: this.baseURL,
        });

        const aiResponse = await provider.chat(
            [{ role: 'user', content: prompt }],
            {
                temperature: 0.1, // 判定なので低温度
                maxTokens: 200, // JSON 1 行なので少量で十分
                responseFormat: { type: 'json_object' },
            },
        );

        const content = aiResponse.content;
        if (!content) {
            throw new Error('AI API returned empty content');
        }

        return JSON.parse(content) as JsonValue;
    }

    /**
     * AI 応答をパース
     */
    private parseResult(data: JsonValue): SimilarityResult | null {
        // JsonValue → 必要キーのみを持つ薄い型に narrow する。
        // 中身は parseResult 直後の typeof チェックで検証されるので、ここでは形だけ整える。
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            console.warn('[LessonSimilarity] AI応答がオブジェクトではない:', data);
            return null;
        }
        const result = data as { index?: number; similarity?: number; mergedText?: string };

        if (
            typeof result.index !== 'number' ||
            typeof result.similarity !== 'number' ||
            typeof result.mergedText !== 'string'
        ) {
            console.warn('[LessonSimilarity] AI応答の形式が不正:', data);
            return null;
        }

        // 類似度 70% 未満は「類似なし」として扱う
        if (result.index === -1 || result.similarity < 70) {
            return null;
        }

        return {
            index: result.index,
            similarity: result.similarity,
            mergedText: result.mergedText || '',
        };
    }

    /**
     * フォールバック: APIキーなし or API エラー時の簡易類似判定
     * 
     * キーワード重複率で判定する簡易版
     */
    private fallbackSimilarity(
        newLesson: string,
        existingLessons: string[]
    ): SimilarityResult | null {
        const newWords = this.extractKeywords(newLesson);

        let bestIndex = -1;
        let bestOverlap = 0;

        for (let i = 0; i < existingLessons.length; i++) {
            const existingWords = this.extractKeywords(existingLessons[i]);
            const overlap = this.calculateWordOverlap(newWords, existingWords);

            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestIndex = i;
            }
        }

        // 60% 以上のキーワード重複で類似とみなす
        if (bestIndex >= 0 && bestOverlap >= 0.6) {
            return {
                index: bestIndex,
                similarity: Math.round(bestOverlap * 100),
                mergedText: newLesson, // フォールバックでは新しい方をそのまま使う
            };
        }

        return null;
    }

    /**
     * テキストからキーワードを抽出（日本語対応の簡易版）
     */
    private extractKeywords(text: string): Set<string> {
        // 助詞・接続詞を除去して主要キーワードを抽出
        const stopWords = new Set([
            'の', 'は', 'が', 'を', 'に', 'で', 'と', 'も', 'や', 'へ',
            'から', 'まで', 'より', 'ば', 'て', 'で', 'た', 'だ', 'な',
            'する', 'した', 'して', 'される', 'できる', 'ある', 'いる',
            'こと', 'もの', 'ため', 'よう', 'べき', 'ない',
        ]);

        // 2文字以上の単語を抽出（簡易的なN-gram）
        const words = new Set<string>();
        const cleaned = text.replace(/[、。！？\s]/g, '');

        // 2-gram, 3-gram を生成
        for (let n = 2; n <= 4; n++) {
            for (let i = 0; i <= cleaned.length - n; i++) {
                const ngram = cleaned.substring(i, i + n);
                if (!stopWords.has(ngram)) {
                    words.add(ngram);
                }
            }
        }

        return words;
    }

    /**
     * 2つのキーワードセットの重複率を計算
     */
    private calculateWordOverlap(setA: Set<string>, setB: Set<string>): number {
        if (setA.size === 0 || setB.size === 0) return 0;

        let intersection = 0;
        for (const word of setA) {
            if (setB.has(word)) {
                intersection++;
            }
        }

        // Jaccard 類似度
        const union = setA.size + setB.size - intersection;
        return intersection / union;
    }
}

// シングルトン
export const lessonSimilarityService = new LessonSimilarityService();
