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
