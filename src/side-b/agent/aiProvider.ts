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

import { z } from 'zod';
import { config, resolveDefaultModel } from '../../config';
import type { McpToolDefinition } from '../skills/types';

/**
 * AIProvider が必要とする最小限のレスポンス形状を Zod で検証する。
 *
 * 設計方針:
 * - リポジトリの `OpenAIChatCompletionResponseSchema` は `id`/`object`/`created` 等も必須にする厳格版で、
 *   プロバイダ差異 (OpenRouter / Gemini OpenAI 互換 / 今後の新エンドポイント) や
 *   既存テストの最小モックを壊しやすい。
 * - AIProvider が実際に参照するのは `choices[].message.content` / `usage.*_tokens` / `model` のみ。
 *   不要な field は `optional()` にし、必要 field の **欠落** だけを runtime error で弾く。
 * - これにより、PR #149 Copilot レビュー (4) の「type assertion で潜在エラーを隠さない」要件は満たしつつ、
 *   過度な型結合を避ける。
 */
const AIProviderToolCallSchema = z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
        name: z.string(),
        arguments: z.string(),
    }),
});

const AIProviderResponseSchema = z.object({
    choices: z
        .array(
            z.object({
                message: z.object({
                    content: z.string().nullable().optional(),
                    tool_calls: z.array(AIProviderToolCallSchema).optional(),
                }),
                finish_reason: z.string().nullable().optional(),
            }),
        )
        .min(1, 'AI API レスポンスに choices がありません'),
    usage: z
        .object({
            total_tokens: z.number().optional(),
            prompt_tokens: z.number().optional(),
            completion_tokens: z.number().optional(),
        })
        .optional(),
    model: z.string().optional(),
});

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

/**
 * Chat Completions API へ送るリクエスト body の型。
 *
 * オプション送信のフィールドは optional とし、`Record<string, unknown>` を
 * 使わず具体型として表現する。値はすべて JSON.stringify で送る前提なので
 * JSON プリミティブ + 既知オブジェクトのみで構成する。
 */
interface ChatRequestBody {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    response_format?: { type: 'json_object' } | { type: 'text' };
    reasoning_effort?: ReasoningEffort;
    tools?: OpenAIToolDef[];
    tool_choice?: 'auto' | 'none';
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
     * OpenAI の **直エンドポイント** かを判定する (baseURL のみ判定)。
     * 通常は {@link requiresOpenAINewParamFormat} 経由で参照すること。
     */
    private usesOpenAIDirectEndpoint(): boolean {
        return this.baseURL.toLowerCase().includes('api.openai.com');
    }

    /**
     * OpenAI 新パラメータ形式 (temperature 抑止 + max_completion_tokens) を要求するかを判定する。
     *
     * 条件: **OpenAI 直エンドポイント (api.openai.com) かつ reasoning モデル (gpt-5系 / o系)** の時のみ true。
     *
     * 同 baseURL でも gpt-4o 等の非 reasoning モデルでは従来形式 (temperature OK / max_tokens) を維持する必要がある。
     * baseURL だけで判定すると gpt-4o 直叩きが壊れるため、必ずモデルとセットで判定する。
     */
    private requiresOpenAINewParamFormat(): boolean {
        return this.usesOpenAIDirectEndpoint() && this.isReasoningModel(this.model);
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
        // OpenAI 互換 API へ送る JSON body。
        // 値は number / string / boolean / 配列 / オブジェクトのいずれかで、
        // 最終的に JSON.stringify される。型は ChatRequestBody (union) で表現する。
        const body: ChatRequestBody = {
            model: this.model,
            messages,
        };

        // OpenAI 直 + reasoning モデル (gpt-5系/o系) は temperature 非対応 (デフォルト 1 のみ受理)。
        // 同じ OpenAI 直でも gpt-4o 等は temperature を受け付けるため、モデルもセットで判定する。
        // OpenRouter / Gemini OpenAI 互換 / その他は常に temperature を尊重。
        if (!this.requiresOpenAINewParamFormat()) {
            body.temperature = options.temperature ?? 0.3;
        }

        // max_tokens は明示指定された時のみ付ける(プロバイダー既定に任せたい場合は省略可)。
        // OpenAI 直 + reasoning モデル (gpt-5系/o系) は `max_tokens` を拒否し `max_completion_tokens` を要求する。
        // 非 reasoning モデル (gpt-4o 等) や OpenRouter 経由は従来通り `max_tokens`。
        if (options.maxTokens !== undefined) {
            if (this.requiresOpenAINewParamFormat()) {
                body.max_completion_tokens = options.maxTokens;
            } else {
                body.max_tokens = options.maxTokens;
            }
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

        // 軽量 Zod スキーマでレスポンスを検証し、プロバイダ側の形式変化を runtime error で早期検知する。
        // type assertion ではキー欠落・型不一致が `undefined` の連鎖で隠れるため避ける (PR #149 Copilot レビュー (4))。
        const rawData = await response.json();
        const parseResult = AIProviderResponseSchema.safeParse(rawData);
        if (!parseResult.success) {
            throw new Error(`AI API レスポンス形式エラー: ${parseResult.error.message}`);
        }
        const data = parseResult.data;

        const choice = data.choices[0];
        // choices.min(1) を満たしていれば choice は存在する。message も schema 上必須。
        return {
            content: choice.message.content ?? null,
            toolCalls: (choice.message.tool_calls ?? []),
            tokenUsage: data.usage?.total_tokens ?? 0,
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
            model: data.model ?? this.model,
            finishReason: choice.finish_reason ?? 'unknown',
        };
    }
}
