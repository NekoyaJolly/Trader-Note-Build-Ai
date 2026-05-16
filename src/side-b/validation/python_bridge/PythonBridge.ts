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
 * Phase 6.8b 追加:
 * - healthCheckStatus() を新設。4 値ステータス (PythonValidatorStatus) を返す。
 *   'not_configured': PYTHON_VALIDATION_MODE が未設定（本番で意図的に無効化）
 *   'local_only'    : docker_exec モードで疎通 OK（ローカル専用）
 *   'ok'            : http モードで疎通 OK（本番 HTTP service）
 *   'error'         : 疎通失敗
 * - healthCheck() は後方互換のため boolean のまま残す（@deprecated）。
 *
 * @see docs/design/phase_4c_specification.md §4.3
 * @see docs/design/phase_6.8b_python_validation_service.md §7, §8
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
    PythonJsonPayload,
} from './types';
import type { JsonValue } from '../../../utils/jsonValue';

/**
 * Python 側の応答 (任意の JsonValue) を `PythonJsonPayload` (Record<string, JsonValue>) に
 * narrow する型ガード。配列 / プリミティブ / null は契約違反として扱う。
 *
 * 理由: `JSON.parse` の戻り値は any/JsonValue で、型システム上は object に強制できるが、
 * 実体が配列やプリミティブの場合に as キャストすると output の型と実体が乖離する。
 * Python 側の契約 (オブジェクトを返す) を runtime で確認することで呼び出し側が安全に扱える。
 */
function isPythonJsonPayload(value: JsonValue): value is PythonJsonPayload {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
// Python 検証ステータス型（Phase 6.8b）
// ===========================================

/**
 * Python 検証サービスのヘルスチェック結果。
 *
 * - 'ok'             : http モードで疎通 OK（本番 HTTP service）
 * - 'local_only'     : docker_exec モードで疎通 OK（ローカル専用。本番では使えない）
 * - 'not_configured' : PYTHON_VALIDATION_MODE が未設定（意図的に無効化されている）
 * - 'error'          : 設定はあるが疎通失敗
 */
export type PythonValidatorStatus = 'ok' | 'local_only' | 'not_configured' | 'error';

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
     * Python 検証サービスのヘルスチェック。
     *
     * Phase 6.8b: boolean ではなく PythonValidatorStatus を返す。
     * - PYTHON_VALIDATION_MODE が未設定なら 'not_configured'
     * - docker_exec モードで疎通 OK なら 'local_only'
     * - http モードで疎通 OK なら 'ok'
     * - 疎通失敗なら 'error'
     */
    async healthCheckStatus(): Promise<PythonValidatorStatus> {
        // mode が未設定（環境変数 PYTHON_VALIDATION_MODE が指定されていない）
        if (!this.config.mode) {
            return 'not_configured';
        }

        if (this.config.mode === 'http') {
            // HTTP モード: baseUrl が未設定なら not_configured
            if (!this.config.baseUrl) {
                return 'not_configured';
            }
            const ok = await this.healthCheckHttp();
            return ok ? 'ok' : 'error';
        }

        // docker_exec モード
        const ok = await this.healthCheckDockerExec();
        return ok ? 'local_only' : 'error';
    }

    /**
     * コンテナが起動していて ping が通るかを確認する。
     *
     * @deprecated healthCheckStatus() を使用してください。
     *   この boolean 版は後方互換のために残しています。
     */
    async healthCheck(): Promise<boolean> {
        const status = await this.healthCheckStatus();
        return status === 'ok' || status === 'local_only';
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

        // Python 側からの JSON は構造未確定のため、まず JsonValue で受けてから
        // PythonJsonPayload (Record<string, JsonValue>) であることを runtime で確認する。
        // 配列やプリミティブが返ってきた場合は契約違反として success=false で返す。
        let parsed: JsonValue;
        try {
            parsed = JSON.parse(raw) as JsonValue;
        } catch (err) {
            await this.safeUnlink(inputHost, outputHost);
            return {
                success: false,
                error: `出力 JSON パース失敗: ${err instanceof Error ? err.message : String(err)}`,
                durationMs: Date.now() - start,
            };
        }
        if (!isPythonJsonPayload(parsed)) {
            await this.safeUnlink(inputHost, outputHost);
            return {
                success: false,
                error: `出力 JSON が PythonJsonPayload (オブジェクト) ではありません: ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
                durationMs: Date.now() - start,
            };
        }

        await this.safeUnlink(inputHost, outputHost);
        return {
            success: true,
            output: parsed,
            durationMs: Date.now() - start,
        };
    }

    private async healthCheckDockerExec(): Promise<boolean> {
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
            // HTTP モードでも docker_exec と同様、レスポンスが配列やプリミティブの場合は契約違反として扱う
            const parsed = (await res.json()) as JsonValue;
            if (!isPythonJsonPayload(parsed)) {
                return {
                    success: false,
                    error: `HTTP 応答が PythonJsonPayload (オブジェクト) ではありません: ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
                    durationMs: Date.now() - start,
                };
            }
            return {
                success: true,
                output: parsed,
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
 * - PYTHON_VALIDATION_MODE    : 'docker_exec'（ローカル）または 'http'（本番）
 *                               未設定の場合は未設定扱いのまま渡す。
 *                               その場合、healthCheckStatus() は 'not_configured' を返す。
 * - PYTHON_BRIDGE_CONTAINER   : コンテナ名（既定 side_b_python_validator）
 * - PYTHON_BRIDGE_SHARED_DIR  : 共有ディレクトリ（既定 <cwd>/python/shared）
 * - PYTHON_BRIDGE_TIMEOUT_MS  : 既定タイムアウト（既定 300000 = 5分）
 * - PYTHON_VALIDATION_URL     : HTTP モードの base URL
 * - ANALYSIS_ENGINE_URL       : HTTP モードの base URL（フォールバック）
 */
export function createDefaultPythonBridge(): PythonBridge {
    const rawMode = process.env.PYTHON_VALIDATION_MODE;
    // 'docker_exec' / 'http' 以外の想定外の値は undefined として扱い、not_configured にフォールバック
    let mode: 'docker_exec' | 'http' | undefined;
    if (rawMode === 'docker_exec' || rawMode === 'http') {
        mode = rawMode;
    } else {
        if (rawMode !== undefined && rawMode !== '') {
            console.warn(
                `[PythonBridge] PYTHON_VALIDATION_MODE に想定外の値 "${rawMode}" が設定されています。` +
                `'docker_exec' または 'http' を指定してください。not_configured として扱います。`,
            );
        }
        mode = undefined;
    }
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
