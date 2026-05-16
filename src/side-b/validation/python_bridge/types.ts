/**
 * PythonBridge 公開型（Phase 4c Step B）
 */

import type { JsonValue } from '../../../utils/jsonValue';

/**
 * Python 側との JSON 受け渡しに用いるペイロード型。
 *
 * `JsonValue` ベースの具体型で、`unknown` を持ち込まない。値の検証は呼び出し側で
 * Zod スキーマにより narrow する想定。
 */
export type PythonJsonPayload = Record<string, JsonValue>;

export interface PythonExecutionRequest {
    /** コンテナ内でのスクリプトパス（例: /app/walk_forward/walk_forward.py） */
    scriptPath: string;
    /** Python 側へ渡す JSON ペイロード */
    input: PythonJsonPayload;
    /** このコール限定のタイムアウト上書き */
    timeoutMs?: number;
}

export interface PythonExecutionResult {
    success: boolean;
    /** 成功時のみ。Python 側が書き出した JSON をパースしたもの */
    output?: PythonJsonPayload;
    /** success=false のとき必ず埋まる */
    error?: string;
    durationMs: number;
}

export interface PythonBridgeConfig {
    /** 実行方式。docker_exec はローカル、http は本番 analysis-engine 用 */
    mode?: 'docker_exec' | 'http';
    /** docker exec 対象のコンテナ名 */
    containerName: string;
    /** HTTP mode の base URL */
    baseUrl?: string;
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
