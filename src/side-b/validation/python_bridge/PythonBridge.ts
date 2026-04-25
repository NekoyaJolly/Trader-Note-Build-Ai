/**
 * PythonBridge（Phase 4c Step B）
 *
 * TypeScript から Python コンテナの任意スクリプトを実行する薄いアダプター。
 *
 * 設計判断:
 * - 起動コスト削減のため、`docker run` ではなく常駐コンテナへ `docker exec` する
 * - stdin/stdout 経由ではなく、共有ボリューム上の JSON ファイルで入出力を受け渡す
 *   （stdio より safer、大きなペイロードでも詰まらない）
 * - タイムアウト時は子プロセスを SIGKILL し、timedOut=true を返す
 * - Python 側のエラーは非0 exit code + stderr で伝わる想定
 *
 * @see docs/design/phase_4c_specification.md §4.3
 */

import { spawn } from 'child_process';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import type {
    DockerExecResult,
    DockerRunner,
    PythonBridgeConfig,
    PythonExecutionRequest,
    PythonExecutionResult,
} from './types';

// ===========================================
// デフォルト docker ランナー
// ===========================================

/**
 * `docker` CLI を子プロセスで実行する既定ランナー。
 * テストでは DI で差し替え可能。
 */
export const defaultDockerRunner: DockerRunner = (
    args: string[],
    timeoutMs: number,
): Promise<DockerExecResult> => {
    return new Promise((resolve) => {
        const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? -1, stdout, stderr, timedOut });
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({
                code: -1,
                stdout,
                stderr: `${stderr}\n${err.message}`.trim(),
                timedOut,
            });
        });
    });
};

// ===========================================
// PythonBridge 本体
// ===========================================

export class PythonBridge {
    private readonly runner: DockerRunner;

    constructor(
        private readonly config: PythonBridgeConfig,
        runner: DockerRunner = defaultDockerRunner,
    ) {
        this.runner = runner;
    }

    /**
     * コンテナが起動していて ping が通るかを確認する。
     */
    async healthCheck(): Promise<boolean> {
        if (this.config.mode === 'http') {
            return this.healthCheckHttp();
        }
        try {
            const result = await this.runner(
                ['exec', this.config.containerName, 'python', '/app/ping.py'],
                5000,
            );
            return result.code === 0 && result.stdout.trim() === 'ok';
        } catch {
            return false;
        }
    }

    /**
     * スクリプトを実行し、Python 側が JSON で返した結果をパースして返す。
     *
     * フロー:
     *   1. input を shared/input-<id>.json に書き出し
     *   2. docker exec container python <scriptPath> <inputInContainer> <outputInContainer>
     *   3. shared/output-<id>.json を読んで JSON.parse
     *   4. 成否にかかわらず両ファイルを削除
     */
    async execute(req: PythonExecutionRequest): Promise<PythonExecutionResult> {
        if (this.config.mode === 'http') {
            return this.executeHttp(req);
        }
        const start = Date.now();
        const runId = randomUUID();
        const inputHost = path.join(this.config.sharedDir, `input-${runId}.json`);
        const outputHost = path.join(this.config.sharedDir, `output-${runId}.json`);
        const inputContainer = `/app/shared/input-${runId}.json`;
        const outputContainer = `/app/shared/output-${runId}.json`;

        try {
            await mkdir(this.config.sharedDir, { recursive: true });
            await writeFile(inputHost, JSON.stringify(req.input), 'utf-8');
        } catch (err) {
            return {
                success: false,
                error: `入力書き込み失敗: ${err instanceof Error ? err.message : String(err)}`,
                durationMs: Date.now() - start,
            };
        }

        const timeoutMs = req.timeoutMs ?? this.config.defaultTimeoutMs;

        let execResult: DockerExecResult;
        try {
            execResult = await this.runner(
                [
                    'exec',
                    this.config.containerName,
                    'python',
                    '-u',
                    req.scriptPath,
                    inputContainer,
                    outputContainer,
                ],
                timeoutMs,
            );
        } catch (err) {
            await this.safeUnlink(inputHost, outputHost);
            return {
                success: false,
                error: `docker exec 失敗: ${err instanceof Error ? err.message : String(err)}`,
                durationMs: Date.now() - start,
            };
        }

        if (execResult.timedOut) {
            await this.safeUnlink(inputHost, outputHost);
            return {
                success: false,
                error: `タイムアウト (${timeoutMs}ms)`,
                durationMs: Date.now() - start,
            };
        }
        if (execResult.code !== 0) {
            await this.safeUnlink(inputHost, outputHost);
            const msg = execResult.stderr.trim() || execResult.stdout.trim() || `exit code ${execResult.code}`;
            return {
                success: false,
                error: `Python 実行失敗 (exit=${execResult.code}): ${msg}`,
                durationMs: Date.now() - start,
            };
        }

        let raw: string;
        try {
            raw = await readFile(outputHost, 'utf-8');
        } catch (err) {
            await this.safeUnlink(inputHost, outputHost);
            return {
                success: false,
                error: `出力ファイル読み込み失敗: ${err instanceof Error ? err.message : String(err)}`,
                durationMs: Date.now() - start,
            };
        }

        let output: Record<string, unknown>;
        try {
            output = JSON.parse(raw) as Record<string, unknown>;
        } catch (err) {
            await this.safeUnlink(inputHost, outputHost);
            return {
                success: false,
                error: `出力 JSON パース失敗: ${err instanceof Error ? err.message : String(err)}`,
                durationMs: Date.now() - start,
            };
        }

        await this.safeUnlink(inputHost, outputHost);
        return {
            success: true,
            output,
            durationMs: Date.now() - start,
        };
    }

    private async healthCheckHttp(): Promise<boolean> {
        const baseUrl = this.config.baseUrl?.replace(/\/$/, '');
        if (!baseUrl) return false;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
            if (!res.ok) return false;
            const body = await res.json() as { status?: string; ok?: boolean };
            return body.status === 'ok' || body.ok === true;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    private async executeHttp(req: PythonExecutionRequest): Promise<PythonExecutionResult> {
        const start = Date.now();
        const baseUrl = this.config.baseUrl?.replace(/\/$/, '');
        if (!baseUrl) {
            return {
                success: false,
                error: 'PYTHON_VALIDATION_URL / ANALYSIS_ENGINE_URL が未設定です',
                durationMs: Date.now() - start,
            };
        }
        const timeoutMs = req.timeoutMs ?? this.config.defaultTimeoutMs;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const endpoint = req.scriptPath.includes('walk_forward')
                ? '/v1/walk-forward'
                : '/v1/execute';
            const res = await fetch(`${baseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.input),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                return {
                    success: false,
                    error: `HTTP ${res.status}: ${text}`,
                    durationMs: Date.now() - start,
                };
            }
            const output = await res.json() as Record<string, unknown>;
            return {
                success: true,
                output,
                durationMs: Date.now() - start,
            };
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    private async safeUnlink(...paths: string[]): Promise<void> {
        await Promise.all(
            paths.map((p) =>
                unlink(p).catch(() => {
                    /* 既に存在しない場合は無視 */
                }),
            ),
        );
    }
}

// ===========================================
// 既定インスタンス生成
// ===========================================

/**
 * 環境変数を反映したデフォルト PythonBridge を生成する。
 *
 * - PYTHON_BRIDGE_CONTAINER: コンテナ名（既定 side_b_python_validator）
 * - PYTHON_BRIDGE_SHARED_DIR: 共有ディレクトリ（既定 <cwd>/python/shared）
 * - PYTHON_BRIDGE_TIMEOUT_MS: 既定タイムアウト（既定 300000 = 5分）
 */
export function createDefaultPythonBridge(): PythonBridge {
    const mode = (process.env.PYTHON_VALIDATION_MODE ?? 'docker_exec') as 'docker_exec' | 'http';
    return new PythonBridge({
        mode,
        containerName: process.env.PYTHON_BRIDGE_CONTAINER ?? 'side_b_python_validator',
        baseUrl: process.env.PYTHON_VALIDATION_URL ?? process.env.ANALYSIS_ENGINE_URL,
        sharedDir:
            process.env.PYTHON_BRIDGE_SHARED_DIR ??
            path.join(process.cwd(), 'python', 'shared'),
        defaultTimeoutMs: Number(process.env.PYTHON_BRIDGE_TIMEOUT_MS ?? '300000'),
    });
}

export const pythonBridge = createDefaultPythonBridge();
