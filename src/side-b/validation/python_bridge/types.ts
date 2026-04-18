/**
 * PythonBridge 公開型（Phase 4c Step B）
 */

export interface PythonExecutionRequest {
    /** コンテナ内でのスクリプトパス（例: /app/walk_forward/walk_forward.py） */
    scriptPath: string;
    /** Python 側へ渡す JSON ペイロード */
    input: Record<string, unknown>;
    /** このコール限定のタイムアウト上書き */
    timeoutMs?: number;
}

export interface PythonExecutionResult {
    success: boolean;
    /** 成功時のみ。Python 側が書き出した JSON をパースしたもの */
    output?: Record<string, unknown>;
    /** success=false のとき必ず埋まる */
    error?: string;
    durationMs: number;
}

export interface PythonBridgeConfig {
    /** docker exec 対象のコンテナ名 */
    containerName: string;
    /** TS ↔ Python 間 JSON 受け渡しディレクトリ（ホスト側絶対パス） */
    sharedDir: string;
    /** 個別リクエストが上書きしない限りのタイムアウト(ms) */
    defaultTimeoutMs: number;
}

/**
 * `docker` サブコマンドの実行結果（内部契約）。テストで差し替え可能。
 */
export interface DockerExecResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}

export type DockerRunner = (args: string[], timeoutMs: number) => Promise<DockerExecResult>;
