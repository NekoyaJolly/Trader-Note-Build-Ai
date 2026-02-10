/**
 * AI Provider（AIモデル抽象化層）
 *
 * OpenAI互換の Chat Completions API を共通インターフェースとして使い、
 * .env の AI_BASE_URL / AI_MODEL / AI_API_KEY を切り替えるだけで
 * Gemini / OpenAI / Claude 等あらゆるモデルに対応する。
 *
 * 使い方:
 *   const provider = new AIProvider();
 *   const response = await provider.chat(messages, tools);
 *   // response.toolCalls があればツール実行 → 結果を messages に追加して再送信
 */

import { config } from '../../config';
import type { McpToolDefinition } from './mcpClient';

// ===========================================
// 型定義
// ===========================================

/** チャットメッセージ */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    /** assistant メッセージの場合のツール呼び出し */
    tool_calls?: ToolCall[];
    /** tool メッセージの場合の呼び出しID */
    tool_call_id?: string;
}

/** ツール呼び出し（AI応答に含まれる） */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

/** AI応答 */
export interface AIResponse {
    /** テキスト応答（ツール呼び出しがない場合の最終回答） */
    content: string | null;
    /** ツール呼び出し要求（あればエージェントが実行すべき） */
    toolCalls: ToolCall[];
    /** 使用トークン数 */
    tokenUsage: number;
    /** 使用モデル名 */
    model: string;
    /** 応答の終了理由 */
    finishReason: string;
}

/** OpenAI function calling 形式のツール定義 */
interface OpenAIToolDef {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}

// ===========================================
// AI Provider クラス
// ===========================================

export class AIProvider {
    private apiKey: string;
    private model: string;
    private baseURL: string;

    constructor(options?: { apiKey?: string; model?: string; baseURL?: string }) {
        this.apiKey = options?.apiKey || config.ai.apiKey;
        this.model = options?.model || config.ai.model;
        this.baseURL = options?.baseURL || config.ai.baseURL || 'https://api.openai.com/v1';
    }

    /** 現在のモデル名を返す */
    getModel(): string {
        return this.model;
    }

    /**
     * MCPツール定義 → OpenAI function calling 形式に変換
     */
    convertToolsToOpenAIFormat(mcpTools: McpToolDefinition[]): OpenAIToolDef[] {
        return mcpTools.map((tool) => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
    }

    /**
     * Chat Completions API を呼び出す
     *
     * @param messages メッセージ履歴
     * @param mcpTools MCPツール定義（省略可）
     * @param temperature 温度パラメータ（デフォルト: 0.3）
     * @returns AI応答（テキスト or ツール呼び出し要求）
     */
    async chat(
        messages: ChatMessage[],
        mcpTools?: McpToolDefinition[],
        temperature = 0.3,
    ): Promise<AIResponse> {
        const body: Record<string, unknown> = {
            model: this.model,
            messages,
            temperature,
        };

        // ツール定義がある場合のみ追加
        if (mcpTools && mcpTools.length > 0) {
            body.tools = this.convertToolsToOpenAIFormat(mcpTools);
            body.tool_choice = 'auto';
        }

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`AI API error: ${response.status} - ${errorBody}`);
        }

        const data = (await response.json()) as {
            choices?: Array<{
                message?: {
                    content?: string | null;
                    tool_calls?: ToolCall[];
                };
                finish_reason?: string;
            }>;
            usage?: { total_tokens?: number };
            model?: string;
        };

        const choice = data.choices?.[0];
        if (!choice?.message) {
            throw new Error('Empty response from AI API');
        }

        return {
            content: choice.message.content ?? null,
            toolCalls: choice.message.tool_calls || [],
            tokenUsage: data.usage?.total_tokens || 0,
            model: data.model || this.model,
            finishReason: choice.finish_reason || 'unknown',
        };
    }
}
