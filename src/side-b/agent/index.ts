/**
 * Side-B AI Agent
 *
 * MCPサーバー経由でツールを使い、自律的にPDCAサイクルを実行するAIエージェント。
 * AIモデルは .env で自由に切り替え可能。
 */

export { McpClientManager, type McpToolDefinition, type McpToolResult } from './mcpClient';
export { AIProvider, type ChatMessage, type ToolCall, type AIResponse } from './aiProvider';
export {
    AgentLoop,
    type AgentResult,
    type AgentConfig,
    type AgentStep,
    type ToolCallRecord,
} from './agentLoop';

// 自律トレーディングAI（Phase 1-2 新規）
export {
    AgentMemory,
    agentMemory,
    type AgentState,
    type AgentMemoryState,
    type TradeResultSummary,
    type ActivePosition,
    type TodayStrategyContext,
} from './agentMemory';

export {
    PDCALoop,
    pdcaLoop,
    type PDCALoopConfig,
    type PDCATickResult,
    type ThinkingLogEntry,
} from './pdcaLoop';
