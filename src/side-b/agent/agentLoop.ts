/**
 * Agent Loop（自律エージェント実行ループ）
 *
 * AIに目標を与え、AIが自分で判断してMCPツールを呼び出しながら
 * タスクを完了するまでループする。
 *
 * フロー:
 *   1. システムプロンプト + ユーザーゴール → AI に送信
 *   2. AI が tool_call を返す → MCP Client で実行 → 結果を AI に返す
 *   3. tool_call がなくなる or 最大回数到達 → 最終応答を返す
 *
 * 使い方:
 *   const agent = new AgentLoop();
 *   await agent.initialize();
 *   const result = await agent.run('BTC/USDの相場を分析してトレードプランを作成して');
 *   await agent.shutdown();
 */

import { McpClientManager, type McpToolResult } from './mcpClient';
import { AIProvider, type ChatMessage } from './aiProvider';
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import { loadPrompt } from '../prompts/loader';

// ===========================================
// 型定義
// ===========================================

/** エージェント実行結果 */
export interface AgentResult {
    /** 最終応答テキスト */
    response: string;
    /** 実行されたツール呼び出しの履歴 */
    toolCallHistory: ToolCallRecord[];
    /** 合計トークン使用量 */
    totalTokenUsage: number;
    /** 合計ループ回数 */
    iterations: number;
    /** 使用モデル */
    model: string;
}

/** ツール呼び出し記録 */
export interface ToolCallRecord {
    /** ツール名 */
    tool: string;
    /** ツール引数 (MCP プロトコル上、tool ごとにスキーマが異なるため unknown 値で保持) */
    // eslint-disable-next-line no-restricted-syntax
    args: Record<string, unknown>;
    /** ツール実行結果（テキスト） */
    result: string;
    /** エラーか */
    isError: boolean;
    /** 実行時刻 */
    timestamp: Date;
}

/** エージェント設定 */
export interface AgentConfig {
    /** 最大ループ回数（安全制限） */
    maxIterations?: number;
    /** システムプロンプト（カスタム） */
    systemPrompt?: string;
    /** AI温度パラメータ */
    temperature?: number;
    /** 各ステップのコールバック（ログ用） */
    onStep?: (step: AgentStep) => void;
}

/** ステップ情報（コールバック用） */
export interface AgentStep {
    iteration: number;
    type: 'thinking' | 'tool_call' | 'tool_result' | 'final_response';
    content: string;
}

// ===========================================
// デフォルトシステムプロンプト
// ===========================================
//
// Phase 5.5: ハードコードを廃止し `src/side-b/prompts/agent_loop_default.md`
// から読み込む。CLAUDE.md「プロンプトを編集する時の注意」(プロンプトは外部ファイル化)
// に準拠。将来の進化的探索でプロンプト自体を変異対象にできるようにするため。

function loadDefaultSystemPrompt(): string {
    return loadPrompt('agent_loop_default');
}

// ===========================================
// Agent Loop クラス
// ===========================================

export class AgentLoop {
    private mcpClient: McpClientManager;
    private aiProvider: AIProvider;
    private config: Required<Omit<AgentConfig, 'onStep'>> & { onStep?: (step: AgentStep) => void };

    constructor(agentConfig?: AgentConfig, aiProvider?: AIProvider) {
        this.mcpClient = McpClientManager.getInstance();
        this.aiProvider = aiProvider || new AIProvider();
        this.config = {
            maxIterations: agentConfig?.maxIterations ?? 10,
            systemPrompt: agentConfig?.systemPrompt ?? loadDefaultSystemPrompt(),
            temperature: agentConfig?.temperature ?? 0.3,
            onStep: agentConfig?.onStep,
        };
    }

    /**
     * エージェントを初期化（MCPサーバー接続）
     */
    async initialize(): Promise<void> {
        if (!this.mcpClient.isConnected()) {
            await this.mcpClient.connect();
        }
    }

    /**
     * エージェントを実行
     *
     * @param goal ユーザーの目標・指示
     * @returns エージェント実行結果
     */
    async run(goal: string): Promise<AgentResult> {
        console.log(`[Agent] Starting agent loop with goal: ${goal.substring(0, 100)}...`);

        // MCPツール一覧を取得
        const mcpTools = await this.mcpClient.listTools();

        // メッセージ履歴を初期化
        const messages: ChatMessage[] = [
            { role: 'system', content: this.config.systemPrompt },
            { role: 'user', content: goal },
        ];

        const toolCallHistory: ToolCallRecord[] = [];
        let totalTokenUsage = 0;
        let model = this.aiProvider.getModel();

        // エージェントループ
        for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
            console.log(`[Agent] Iteration ${iteration}/${this.config.maxIterations}`);

            // AI に送信
            const aiResponse = await this.aiProvider.chat(messages, {
                tools: mcpTools,
                temperature: this.config.temperature,
                maxTokens: AI_MAX_TOKENS.MEDIUM,
            });

            totalTokenUsage += aiResponse.tokenUsage;
            model = aiResponse.model;

            // ツール呼び出しがない場合 → 最終応答
            if (aiResponse.toolCalls.length === 0) {
                const finalResponse = aiResponse.content || '（応答なし）';

                this.emitStep({
                    iteration,
                    type: 'final_response',
                    content: finalResponse,
                });

                console.log(`[Agent] Completed in ${iteration} iterations (${totalTokenUsage} tokens)`);

                return {
                    response: finalResponse,
                    toolCallHistory,
                    totalTokenUsage,
                    iterations: iteration,
                    model,
                };
            }

            // AIの思考テキスト（ツール呼び出しと一緒に返る場合）
            if (aiResponse.content) {
                this.emitStep({
                    iteration,
                    type: 'thinking',
                    content: aiResponse.content,
                });
            }

            // assistant メッセージを履歴に追加（tool_calls 含む）
            messages.push({
                role: 'assistant',
                content: aiResponse.content,
                tool_calls: aiResponse.toolCalls,
            });

            // 各ツール呼び出しを実行
            for (const toolCall of aiResponse.toolCalls) {
                const { name, arguments: argsStr } = toolCall.function;

                this.emitStep({
                    iteration,
                    type: 'tool_call',
                    content: `${name}(${argsStr.substring(0, 200)})`,
                });

                let toolResult: McpToolResult;
                // eslint-disable-next-line no-restricted-syntax -- MCP tool 引数。スキーマは tool ごとに動的決定されるため Record<string, unknown> で保持し、callTool 側で検証する
                let parsedArgs: Record<string, unknown> = {};

                try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse の戻り。直後の callTool で MCP server 側スキーマ検証に委ねる
                    parsedArgs = JSON.parse(argsStr);
                    toolResult = await this.mcpClient.callTool(name, parsedArgs);
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    console.error(`[Agent] Tool ${name} failed:`, errorMsg);
                    toolResult = {
                        content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMsg }) }],
                        isError: true,
                    };
                }

                // 結果をテキストに変換
                const resultText = toolResult.content
                    .map((c) => c.text || '')
                    .filter(Boolean)
                    .join('\n');

                // 記録
                toolCallHistory.push({
                    tool: name,
                    args: parsedArgs,
                    result: resultText,
                    isError: toolResult.isError || false,
                    timestamp: new Date(),
                });

                this.emitStep({
                    iteration,
                    type: 'tool_result',
                    content: `${name}: ${resultText.substring(0, 200)}`,
                });

                // tool 結果をメッセージ履歴に追加
                messages.push({
                    role: 'tool',
                    content: resultText,
                    tool_call_id: toolCall.id,
                });
            }
        }

        // 最大ループ数に到達
        console.warn(`[Agent] Reached max iterations (${this.config.maxIterations})`);

        return {
            response: `最大反復回数 (${this.config.maxIterations}) に到達しました。中間結果をご確認ください。`,
            toolCallHistory,
            totalTokenUsage,
            iterations: this.config.maxIterations,
            model,
        };
    }

    /**
     * エージェントをシャットダウン（MCPサーバー切断）
     */
    async shutdown(): Promise<void> {
        await this.mcpClient.disconnect();
    }

    /** ステップコールバック発火 */
    private emitStep(step: AgentStep): void {
        if (this.config.onStep) {
            this.config.onStep(step);
        }
    }
}
