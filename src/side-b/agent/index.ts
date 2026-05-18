/**
 * Side-B AI Agent
 *
 * AIProvider (汎用 LLM client) + AgentMemory (state ストア) + PDCALoop
 * (状態機械) を集約する。AI モデルは .env で自由に切り替え可能。
 *
 * NOTE (2026-05-19): Phase 5.5 の「1 LLM が PDCA を全部回す」設計
 * (AgentLoop + McpClientManager + src/mcp-server) は撤去済。
 * Phase 6.7a 以降の役割別細分化 + PromptRegistry が正規路。
 */

export { AIProvider, type ChatMessage, type ToolCall, type AIResponse } from './aiProvider';

// 自律トレーディングAI（Phase 1-2 新規）
export {
    AgentMemory,
    agentMemory,
    type AgentState,
    type AgentMemoryState,
    type TradeResultSummary,
    type ActivePosition,
    type TodayStrategyContext,
    type LessonEntry,
    type ConsolidatedLesson,
    type SymbolLessons,
} from './agentMemory';

export {
    PDCALoop,
    pdcaLoop,
    type PDCALoopConfig,
    type PDCATickResult,
    type ThinkingLogEntry,
} from './pdcaLoop';
