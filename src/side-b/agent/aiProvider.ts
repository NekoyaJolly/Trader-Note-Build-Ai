/**
 * AI Provider（AIモデル抽象化層）
 *
 * OpenAI互換の Chat Completions API を共通インターフェースとして使い、
 * .env の AI_BASE_URL / AI_MODEL / AI_API_KEY を切り替えるだけで
 * OpenRouter / Gemini / OpenAI / Claude 等あらゆるモデルに対応する。
 *
 * 使い方:
 *   const provider = new AIProvider();
 *   const response = await provider.chat(messages, { maxTokens: 4096 });
 *   // response.toolCalls があればツール実行 → 結果を messages に追加して再送信
 *
 * Phase 6 hotfix: chat() の 2 番目以降の引数を ChatOptions オブジェクトに統一
 * (破壊的変更、旧 (messages, tools?, temperature?) 形式は廃止)
 */

import { config, resolveDefaultModel } from '../../config';
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
    /** 使用トークン数 (= prompt + completion + reasoning) */
    tokenUsage: number;
    /** プロンプト側のトークン数 (provider が返した時のみ) */
    promptTokens?: number;
    /** 生成側のトークン数 (provider が返した時のみ) */
    completionTokens?: number;
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

/** OpenAI Chat Completions の reasoning_effort 取りうる値 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * chat() の呼び出しオプション (Phase 6 hotfix で統一)。
 *
 * - `temperature`: サンプリング温度 (既定 0.3)
 * - `maxTokens`: 生成トークン上限 (既定: プロバイダー既定 = 指定しない)
 *   Phase 6 系エージェントは JSON 応答が長くなるため 4096 を明示指定推奨
 * - `tools`: function calling 用の MCP ツール定義
 * - `responseFormat`: OpenAI Chat Completions の response_format。
 *   `{ type: 'json_object' }` で JSON モード強制、`{ type: 'text' }` で平文
 * - `reasoningEffort`: gpt-5系 / o系の思考レベル。未指定時は config.ai.reasoningEffort。
 *   isReasoningModel() でゲートされ、非対象モデルでは送られない (= 安全に渡せる)
 */
export interface ChatOptions {
    temperature?: number;
    maxTokens?: number;
    tools?: McpToolDefinition[];
    responseFormat?: { type: 'json_object' } | { type: 'text' };
    reasoningEffort?: ReasoningEffort;
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
        // options.model 未指定時は resolveDefaultModel() 経由で AI_MODEL_OVERRIDE_ALL の効果を受ける。
        // (modelFor() を経由しない new AIProvider() でも一括上書きが効くようにするため)
        this.model = options?.model || resolveDefaultModel();
        this.baseURL = options?.baseURL || config.ai.baseURL || 'https://api.openai.com/v1';
    }

    /** 現在のモデル名を返す */
    getModel(): string {
        return this.model;
    }

    /**
     * OpenAI の **直エンドポイント** かを判定する。
     *
     * OpenAI の o 系 / gpt-5 系は以下の API 仕様変更があるため、`api.openai.com` 直の時だけ
     * リクエスト形式を切り替える:
     *   - `max_tokens` を拒否 → `max_completion_tokens` を要求
     *   - `temperature` 非対応 (デフォルト 1 のみ) → 送信しない
     *
     * OpenRouter (`openrouter.ai`) / Gemini OpenAI 互換 (`generativelanguage.googleapis.com`)
     * は従来形式を受け付けるため切り替えない。
     */
    private usesOpenAINewParam(): boolean {
        // 大文字小文字を吸収しつつ "api.openai.com" を含むかで判定
        return this.baseURL.toLowerCase().includes('api.openai.com');
    }

    /**
     * reasoning モデル (= reasoning_effort を受け付けるモデル) かを判定する。
     *
     * 対応: OpenAI gpt-5 系 (gpt-5, gpt-5-mini, gpt-5.1 等), o 系 (o1, o3, o3-mini, o4-mini 等)
     * 非対応: gpt-4o, gpt-4-turbo, anthropic/*, google/* 等
     *
     * モデル名で判定しているため、OpenRouter 経由の "openai/gpt-5-mini" 等にも対応。
     */
    private isReasoningModel(model: string): boolean {
        const m = model.toLowerCase();
        // "openai/" プレフィックスを剥がして判定 (OpenRouter 経由対応)
        const stripped = m.startsWith('openai/') ? m.slice('openai/'.length) : m;
        return /^gpt-5/.test(stripped) || /^o\d/.test(stripped);
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
     * @param options  ChatOptions (temperature / maxTokens / tools)
     *                 省略時: temperature=0.3, maxTokens=未指定(プロバイダー既定)
     * @returns AI応答（テキスト or ツール呼び出し要求）
     *
     * Phase 6 hotfix (破壊的変更): 旧 (messages, mcpTools?, temperature?) の
     * ポジショナル引数形式は廃止、options オブジェクトに統一
     */
    async chat(
        messages: ChatMessage[],
        options: ChatOptions = {},
    ): Promise<AIResponse> {
        const body: Record<string, unknown> = {
            model: this.model,
            messages,
        };

        // OpenAI の o 系 / gpt-5 系は temperature 非対応 (デフォルト 1 のみ受理)。
        // 既存 aiSummaryService.ts も同様の対応をしており、ここで揃える。
        // OpenRouter / Gemini OpenAI 互換 / その他は temperature を尊重。
        if (!this.usesOpenAINewParam()) {
            body.temperature = options.temperature ?? 0.3;
        }

        // max_tokens は明示指定された時のみ付ける(プロバイダー既定に任せたい場合は省略可)
        // OpenAI の o 系 / gpt-5 系は `max_tokens` を拒否し `max_completion_tokens` を要求するため、
        // OpenAI 直エンドポイントの時だけパラメータ名を切り替える。
        // OpenRouter / Gemini OpenAI 互換 / その他は従来通り `max_tokens`。
        if (options.maxTokens !== undefined) {
            const tokenParam = this.usesOpenAINewParam() ? 'max_completion_tokens' : 'max_tokens';
            body[tokenParam] = options.maxTokens;
        }

        // response_format (JSON モード等) — 指定された時のみ送信
        if (options.responseFormat) {
            body.response_format = options.responseFormat;
        }

        // reasoning_effort — reasoning モデル (gpt-5系/o系) の時のみ送信。
        // 非対象モデルに送ると API エラーになるため、isReasoningModel() でゲートする。
        // 値は options.reasoningEffort > config.ai.reasoningEffort の優先度。
        if (this.isReasoningModel(this.model)) {
            const effort = options.reasoningEffort ?? config.ai.reasoningEffort;
            if (effort) {
                body.reasoning_effort = effort;
            }
        }

        // ツール定義がある場合のみ追加
        const mcpTools = options.tools;
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
            usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
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
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
            model: data.model || this.model,
            finishReason: choice.finish_reason || 'unknown',
        };
    }
}
