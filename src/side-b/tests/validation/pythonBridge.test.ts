/**
 * PythonBridge のテスト（Phase 4c Step B）
 *
 * ユニットテスト: DockerRunner をモックして契約を検証。共有ディレクトリは
 *   OS の一時ディレクトリを実際に使い、入出力ファイルの書き込み・削除を
 *   本物の fs で動かす。
 *
 * 統合テスト: env RUN_PYTHON_INTEGRATION=1 のときのみ実行。
 *   実 Docker コンテナ（side_b_python_validator）が起動している前提。
 */

import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { existsSync } from 'fs';
import { PythonBridge } from '../../validation/python_bridge/PythonBridge';
import type { DockerRunner } from '../../validation/python_bridge/types';

async function makeTempDir(): Promise<string> {
    return await mkdtemp(path.join(tmpdir(), 'pybr-test-'));
}

describe('PythonBridge (unit, docker runner mocked)', () => {
    let sharedDir: string;

    beforeEach(async () => {
        sharedDir = await makeTempDir();
    });

    it('execute: runner が stdout 成功を返し、output ファイルを書いてくれた場合 success=true', async () => {
        const runner: DockerRunner = jest.fn(async (args) => {
            // args = ['exec', container, 'python', '-u', script, inputContainer, outputContainer]
            const containerOutputPath = args[args.length - 1];
            // /app/shared/output-xxx.json → ホスト側の同名ファイルに書く
            const hostOutputPath = path.join(sharedDir, path.basename(containerOutputPath));
            const fs = await import('fs/promises');
            await fs.writeFile(hostOutputPath, JSON.stringify({ result: 'hello', n: 42 }));
            return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
        });

        const bridge = new PythonBridge(
            { containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );

        const res = await bridge.execute({
            scriptPath: '/app/test.py',
            input: { foo: 'bar' },
        });

        expect(res.success).toBe(true);
        expect(res.output).toEqual({ result: 'hello', n: 42 });
        expect(runner).toHaveBeenCalledTimes(1);
        const firstCallArgs = (runner as jest.Mock).mock.calls[0][0] as string[];
        expect(firstCallArgs[0]).toBe('exec');
        expect(firstCallArgs[1]).toBe('test-c');
        expect(firstCallArgs[2]).toBe('python');
        expect(firstCallArgs[4]).toBe('/app/test.py');
    });

    it('execute: 非0 exit code なら success=false / error に stderr', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 1,
            stdout: '',
            stderr: 'ModuleNotFoundError: No module named foo',
            timedOut: false,
        }));

        const bridge = new PythonBridge(
            { containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );

        const res = await bridge.execute({ scriptPath: '/app/bad.py', input: {} });
        expect(res.success).toBe(false);
        expect(res.error).toContain('exit=1');
        expect(res.error).toContain('ModuleNotFoundError');
    });

    it('execute: timedOut=true ならタイムアウトエラー', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: -1,
            stdout: '',
            stderr: '',
            timedOut: true,
        }));

        const bridge = new PythonBridge(
            { containerName: 'test-c', sharedDir, defaultTimeoutMs: 100 },
            runner,
        );
        const res = await bridge.execute({ scriptPath: '/app/slow.py', input: {}, timeoutMs: 100 });
        expect(res.success).toBe(false);
        expect(res.error).toContain('タイムアウト');
        expect(res.error).toContain('100');
    });

    it('execute: output ファイルが存在しないなら success=false', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 0,
            stdout: 'ok',
            stderr: '',
            timedOut: false,
        }));

        const bridge = new PythonBridge(
            { containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        const res = await bridge.execute({ scriptPath: '/app/silent.py', input: {} });
        expect(res.success).toBe(false);
        expect(res.error).toContain('出力ファイル');
    });

    it('execute: output が不正 JSON なら success=false', async () => {
        const runner: DockerRunner = jest.fn(async (args) => {
            const containerOutputPath = args[args.length - 1];
            const hostOutputPath = path.join(sharedDir, path.basename(containerOutputPath));
            const fs = await import('fs/promises');
            await fs.writeFile(hostOutputPath, 'not-json{');
            return { code: 0, stdout: '', stderr: '', timedOut: false };
        });

        const bridge = new PythonBridge(
            { containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        const res = await bridge.execute({ scriptPath: '/app/bad.py', input: {} });
        expect(res.success).toBe(false);
        expect(res.error).toContain('パース失敗');
    });

    it('execute: 入出力ファイルは成功・失敗のいずれでも後片付けされる', async () => {
        const capturedContainerOutputPaths: string[] = [];
        const runner: DockerRunner = jest.fn(async (args) => {
            const containerOutputPath = args[args.length - 1];
            capturedContainerOutputPaths.push(containerOutputPath);
            const hostOutputPath = path.join(sharedDir, path.basename(containerOutputPath));
            const fs = await import('fs/promises');
            await fs.writeFile(hostOutputPath, JSON.stringify({ ok: true }));
            return { code: 0, stdout: '', stderr: '', timedOut: false };
        });

        const bridge = new PythonBridge(
            { containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        const res = await bridge.execute({ scriptPath: '/app/x.py', input: { a: 1 } });
        expect(res.success).toBe(true);

        // 生成された input/output ファイルが消えていること
        const outputFileName = path.basename(capturedContainerOutputPaths[0]);
        const hostOutput = path.join(sharedDir, outputFileName);
        const hostInput = hostOutput.replace('output-', 'input-');
        expect(existsSync(hostOutput)).toBe(false);
        expect(existsSync(hostInput)).toBe(false);
    });

    it('execute: 入力 JSON がコンテナ内パスに対応してディスクに書き込まれる', async () => {
        let observedInputContent: unknown = null;
        const runner: DockerRunner = jest.fn(async (args) => {
            const containerInputPath = args[args.length - 2];
            const hostInputPath = path.join(sharedDir, path.basename(containerInputPath));
            const raw = await readFile(hostInputPath, 'utf-8');
            observedInputContent = JSON.parse(raw);
            const containerOutputPath = args[args.length - 1];
            const hostOutputPath = path.join(sharedDir, path.basename(containerOutputPath));
            const fs = await import('fs/promises');
            await fs.writeFile(hostOutputPath, '{}');
            return { code: 0, stdout: '', stderr: '', timedOut: false };
        });

        const bridge = new PythonBridge(
            { containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        await bridge.execute({ scriptPath: '/app/x.py', input: { msg: 'hi', n: 3 } });
        expect(observedInputContent).toEqual({ msg: 'hi', n: 3 });
    });

    it('healthCheck: code=0 かつ stdout=ok なら true', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 0,
            stdout: 'ok\n',
            stderr: '',
            timedOut: false,
        }));
        const bridge = new PythonBridge(
            { mode: 'docker_exec', containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        expect(await bridge.healthCheck()).toBe(true);
    });

    it('healthCheck: code !=0 なら false', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 1,
            stdout: '',
            stderr: 'No such container',
            timedOut: false,
        }));
        const bridge = new PythonBridge(
            { containerName: 'missing', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        expect(await bridge.healthCheck()).toBe(false);
    });

    it('healthCheck: stdout が ok でなければ false', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 0,
            stdout: 'wat',
            stderr: '',
            timedOut: false,
        }));
        const bridge = new PythonBridge(
            { containerName: 'x', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        expect(await bridge.healthCheck()).toBe(false);
    });

    // -------------------------------------------------------
    // Phase 6.8b: healthCheckStatus() のテスト
    // -------------------------------------------------------

    it('healthCheckStatus: mode 未設定なら not_configured', async () => {
        const runner: DockerRunner = jest.fn();
        const bridge = new PythonBridge(
            // mode を渡さない = undefined
            { containerName: 'x', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        expect(await bridge.healthCheckStatus()).toBe('not_configured');
        expect(runner).not.toHaveBeenCalled();
    });

    it('healthCheckStatus: docker_exec モードで疎通 OK なら local_only', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 0,
            stdout: 'ok',
            stderr: '',
            timedOut: false,
        }));
        const bridge = new PythonBridge(
            { mode: 'docker_exec', containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        expect(await bridge.healthCheckStatus()).toBe('local_only');
    });

    it('healthCheckStatus: docker_exec モードで疎通失敗なら error', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 1,
            stdout: '',
            stderr: 'No such container',
            timedOut: false,
        }));
        const bridge = new PythonBridge(
            { mode: 'docker_exec', containerName: 'missing', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        expect(await bridge.healthCheckStatus()).toBe('error');
    });

    it('healthCheckStatus: http モードで baseUrl 未設定なら not_configured', async () => {
        const runner: DockerRunner = jest.fn();
        const bridge = new PythonBridge(
            // baseUrl を渡さない
            { mode: 'http', containerName: 'x', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        expect(await bridge.healthCheckStatus()).toBe('not_configured');
        expect(runner).not.toHaveBeenCalled();
    });

    it('healthCheckStatus: http モードで疎通 OK（res.ok=true, body.status=ok）なら ok', async () => {
        const runner: DockerRunner = jest.fn();
        // global.fetch をモックして正常レスポンスを返す
        const mockFetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ status: 'ok' }),
        }));
        const origFetch = global.fetch;
        global.fetch = mockFetch as unknown as typeof fetch;
        try {
            const bridge = new PythonBridge(
                { mode: 'http', containerName: 'x', baseUrl: 'http://localhost:8000', sharedDir, defaultTimeoutMs: 5000 },
                runner,
            );
            expect(await bridge.healthCheckStatus()).toBe('ok');
        } finally {
            global.fetch = origFetch;
        }
        expect(runner).not.toHaveBeenCalled();
    });

    it('healthCheckStatus: http モードで res.ok=false なら error', async () => {
        const runner: DockerRunner = jest.fn();
        const mockFetch = jest.fn(async () => ({
            ok: false,
            json: async () => ({}),
        }));
        const origFetch = global.fetch;
        global.fetch = mockFetch as unknown as typeof fetch;
        try {
            const bridge = new PythonBridge(
                { mode: 'http', containerName: 'x', baseUrl: 'http://localhost:8000', sharedDir, defaultTimeoutMs: 5000 },
                runner,
            );
            expect(await bridge.healthCheckStatus()).toBe('error');
        } finally {
            global.fetch = origFetch;
        }
    });

    it('healthCheckStatus: http モードで fetch 例外が発生したら error', async () => {
        const runner: DockerRunner = jest.fn();
        const mockFetch = jest.fn(async () => {
            throw new Error('connect ECONNREFUSED');
        });
        const origFetch = global.fetch;
        global.fetch = mockFetch as unknown as typeof fetch;
        try {
            const bridge = new PythonBridge(
                { mode: 'http', containerName: 'x', baseUrl: 'http://localhost:8000', sharedDir, defaultTimeoutMs: 5000 },
                runner,
            );
            expect(await bridge.healthCheckStatus()).toBe('error');
        } finally {
            global.fetch = origFetch;
        }
    });

    it('healthCheckStatus: http モードで res.ok=true でも body.status が異常値なら error', async () => {
        const runner: DockerRunner = jest.fn();
        const mockFetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ status: 'degraded' }),
        }));
        const origFetch = global.fetch;
        global.fetch = mockFetch as unknown as typeof fetch;
        try {
            const bridge = new PythonBridge(
                { mode: 'http', containerName: 'x', baseUrl: 'http://localhost:8000', sharedDir, defaultTimeoutMs: 5000 },
                runner,
            );
            expect(await bridge.healthCheckStatus()).toBe('error');
        } finally {
            global.fetch = origFetch;
        }
    });

    it('healthCheck: 後方互換—docker_exec モードで疎通 OK なら true', async () => {
        const runner: DockerRunner = jest.fn(async () => ({
            code: 0,
            stdout: 'ok',
            stderr: '',
            timedOut: false,
        }));
        const bridge = new PythonBridge(
            { mode: 'docker_exec', containerName: 'test-c', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        // local_only は true として扱う
        expect(await bridge.healthCheck()).toBe(true);
    });

    it('healthCheck: 後方互換—mode 未設定は false', async () => {
        const runner: DockerRunner = jest.fn();
        const bridge = new PythonBridge(
            { containerName: 'x', sharedDir, defaultTimeoutMs: 5000 },
            runner,
        );
        // not_configured は false として扱う
        expect(await bridge.healthCheck()).toBe(false);
    });
});

// ===========================================
// 実 Docker 統合テスト（env RUN_PYTHON_INTEGRATION=1 で有効化）
// ===========================================

const integrationEnabled = process.env.RUN_PYTHON_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('PythonBridge (integration with real container)', () => {
    const sharedDir = path.join(process.cwd(), 'python', 'shared');
    const bridge = new PythonBridge({
        mode: 'docker_exec',
        containerName: 'side_b_python_validator',
        sharedDir,
        defaultTimeoutMs: 10000,
    });

    it('healthCheck が実コンテナで true', async () => {
        const ok = await bridge.healthCheck();
        expect(ok).toBe(true);
    });

    it('echo.py で round-trip が成功する', async () => {
        const res = await bridge.execute({
            scriptPath: '/app/echo.py',
            input: { hello: 'world', value: 123 },
        });
        expect(res.success).toBe(true);
        expect(res.output).toBeDefined();
        expect((res.output as { echoed: unknown }).echoed).toEqual({
            hello: 'world',
            value: 123,
        });
    });

    it('存在しないスクリプトなら success=false', async () => {
        const res = await bridge.execute({
            scriptPath: '/app/does-not-exist.py',
            input: {},
        });
        expect(res.success).toBe(false);
    });
});
