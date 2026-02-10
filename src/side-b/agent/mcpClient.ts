/**
 * MCP Client
 *
 * MCPサーバーを子プロセスとして起動し、stdio経由で接続するクライアント。
 * ツール一覧の取得とツール実行のインターフェースを提供する。
 *
 * 使い方:
 *   const client = McpClientManager.getInstance();
 *   await client.connect();
 *   const tools = await client.listTools();
 *   const result = await client.callTool('get_market_ohlcv', { symbol: 'BTC/USD' });
 *   await client.disconnect();
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

// ===========================================
// 型定義
// ===========================================

/** MCPツール定義（AIプロバイダーに渡す形式） */
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties?: Record<string, object>;
        required?: string[];
    };
}

/** MCPツール実行結果 */
export interface McpToolResult {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
}

// ===========================================
// MCP Client Manager（シングルトン）
// ===========================================

export class McpClientManager {
    private static instance: McpClientManager | null = null;

    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private connected = false;
    private cachedTools: McpToolDefinition[] | null = null;

    private constructor() { }

    /** シングルトンインスタンス取得 */
    static getInstance(): McpClientManager {
        if (!McpClientManager.instance) {
            McpClientManager.instance = new McpClientManager();
        }
        return McpClientManager.instance;
    }

    /** 接続中かどうか */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * MCPサーバーに接続
     *
     * MCPサーバーを子プロセスとして起動し、stdio で接続する。
     * 既に接続中の場合はスキップ。
     */
    async connect(): Promise<void> {
        if (this.connected) {
            console.log('[McpClient] Already connected');
            return;
        }

        console.log('[McpClient] Connecting to MCP server...');

        // MCPサーバーのパスを解決
        const serverPath = path.resolve(__dirname, '../../mcp-server/index.ts');

        // StdioClientTransport でMCPサーバーを子プロセス起動
        this.transport = new StdioClientTransport({
            command: 'npx',
            args: ['ts-node', serverPath],
            cwd: path.resolve(__dirname, '../../../'),
            stderr: 'pipe',
        });

        // MCP Client 初期化
        this.client = new Client(
            {
                name: 'side-b-agent-client',
                version: '1.0.0',
            },
            {
                capabilities: {},
            },
        );

        // 接続
        await this.client.connect(this.transport);
        this.connected = true;
        this.cachedTools = null; // ツールキャッシュをリセット

        console.log('[McpClient] Connected to MCP server');
    }

    /**
     * 利用可能なツール一覧を取得
     *
     * 初回呼び出し時にキャッシュし、以降はキャッシュを返す。
     * 強制更新したい場合は forceRefresh=true。
     */
    async listTools(forceRefresh = false): Promise<McpToolDefinition[]> {
        if (!this.client || !this.connected) {
            throw new Error('[McpClient] Not connected. Call connect() first.');
        }

        if (this.cachedTools && !forceRefresh) {
            return this.cachedTools;
        }

        const result = await this.client.listTools();

        this.cachedTools = result.tools.map((tool) => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema as McpToolDefinition['inputSchema'],
        }));

        console.log(`[McpClient] Discovered ${this.cachedTools.length} tools: ${this.cachedTools.map((t) => t.name).join(', ')}`);

        return this.cachedTools;
    }

    /**
     * ツールを実行
     *
     * @param name ツール名（例: 'get_market_ohlcv'）
     * @param args ツール引数
     * @returns ツール実行結果
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        if (!this.client || !this.connected) {
            throw new Error('[McpClient] Not connected. Call connect() first.');
        }

        console.log(`[McpClient] Calling tool: ${name}`, JSON.stringify(args).substring(0, 200));

        const result = await this.client.callTool({ name, arguments: args });

        const toolResult: McpToolResult = {
            content: (result.content as Array<{ type: string; text?: string }>) || [],
            isError: result.isError as boolean | undefined,
        };

        if (toolResult.isError) {
            console.error(`[McpClient] Tool ${name} returned error`);
        } else {
            console.log(`[McpClient] Tool ${name} completed successfully`);
        }

        return toolResult;
    }

    /**
     * 切断
     *
     * MCP クライアント接続を閉じ、子プロセスを終了する。
     */
    async disconnect(): Promise<void> {
        if (!this.connected) {
            return;
        }

        console.log('[McpClient] Disconnecting...');

        try {
            if (this.transport) {
                await this.transport.close();
            }
        } catch (error) {
            console.error('[McpClient] Error during disconnect:', error);
        }

        this.client = null;
        this.transport = null;
        this.connected = false;
        this.cachedTools = null;

        console.log('[McpClient] Disconnected');
    }

    /** テスト用: インスタンスをリセット */
    static resetInstance(): void {
        if (McpClientManager.instance) {
            McpClientManager.instance.disconnect().catch(() => { });
            McpClientManager.instance = null;
        }
    }
}
