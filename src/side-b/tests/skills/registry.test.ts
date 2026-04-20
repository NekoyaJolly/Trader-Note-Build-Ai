/**
 * SkillRegistry のテスト (Phase 5.5)
 *
 * 登録・列挙・呼び出しの挙動と、例外を SkillResult に wrap する
 * エラーハンドリングを検証する。
 */

import { SkillRegistry } from '../../skills/registry';
import type { Skill } from '../../skills/types';
import { z } from 'zod';

function makeSkill(overrides?: Partial<Skill>): Skill {
  return {
    name: 'noop',
    description: 'noop skill',
    inputSchema: { type: 'object' },
    async execute() {
      return { ok: true };
    },
    ...overrides,
  };
}

describe('SkillRegistry', () => {
  describe('register / has / get / list', () => {
    it('スキルを登録し、has/get/list で取り出せる', () => {
      const reg = new SkillRegistry();
      const skill = makeSkill({ name: 'alpha' });
      reg.register(skill);
      expect(reg.has('alpha')).toBe(true);
      expect(reg.get('alpha')).toBe(skill);
      expect(reg.list()).toEqual([skill]);
    });

    it('同名スキルの再登録は Error を投げる', () => {
      const reg = new SkillRegistry();
      reg.register(makeSkill({ name: 'dup' }));
      expect(() => reg.register(makeSkill({ name: 'dup' }))).toThrow(
        /already registered/,
      );
    });

    it('registerAll は複数スキルを一括登録する', () => {
      const reg = new SkillRegistry();
      reg.registerAll([
        makeSkill({ name: 'a' }),
        makeSkill({ name: 'b' }),
        makeSkill({ name: 'c' }),
      ]);
      expect(reg.list().map((s) => s.name).sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('toMcpToolDefinitions', () => {
    it('MCP ツール定義形式に変換する', () => {
      const reg = new SkillRegistry();
      reg.register(
        makeSkill({
          name: 'x',
          description: 'test skill',
          inputSchema: {
            type: 'object',
            properties: { foo: { type: 'string' } },
            required: ['foo'],
          },
        }),
      );
      const tools = reg.toMcpToolDefinitions();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: 'x',
        description: 'test skill',
        inputSchema: {
          type: 'object',
          properties: { foo: { type: 'string' } },
          required: ['foo'],
        },
      });
    });
  });

  describe('invoke', () => {
    it('存在しないスキル名は SKILL_NOT_FOUND で返す(例外は投げない)', async () => {
      const reg = new SkillRegistry();
      const result = await reg.invoke('missing', {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SKILL_NOT_FOUND');
      }
    });

    it('成功時は data を包んで返す', async () => {
      const reg = new SkillRegistry();
      reg.register(
        makeSkill({
          name: 'echo',
          async execute(input) {
            return { got: input };
          },
        }),
      );
      const result = await reg.invoke<{ got: unknown }>('echo', { v: 42 });
      expect(result).toEqual({ ok: true, data: { got: { v: 42 } } });
    });

    it('execute が例外を投げても握りつぶさず SkillResult に wrap する', async () => {
      const reg = new SkillRegistry();
      reg.register(
        makeSkill({
          name: 'boom',
          async execute() {
            throw new Error('bang');
          },
        }),
      );
      const result = await reg.invoke('boom', {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SKILL_EXECUTION_ERROR');
        expect(result.error.message).toBe('bang');
        expect(result.error.details).toBeInstanceOf(Error);
      }
    });

    it('Zod バリデーション失敗は code=ZodError で返る', async () => {
      const reg = new SkillRegistry();
      reg.register(
        makeSkill({
          name: 'needs_num',
          async execute(raw) {
            const schema = z.object({ n: z.number() });
            schema.parse(raw);
            return { ok: true };
          },
        }),
      );
      const result = await reg.invoke('needs_num', { n: 'not a number' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ZodError');
      }
    });

    it('context.timestamp 省略時は現在時刻が自動セットされる', async () => {
      const reg = new SkillRegistry();
      let capturedTs: Date | undefined;
      reg.register(
        makeSkill({
          name: 'ts',
          async execute(_input, context) {
            capturedTs = context.timestamp;
            return null;
          },
        }),
      );
      const before = Date.now();
      await reg.invoke('ts', {});
      const after = Date.now();
      expect(capturedTs).toBeInstanceOf(Date);
      expect(capturedTs!.getTime()).toBeGreaterThanOrEqual(before);
      expect(capturedTs!.getTime()).toBeLessThanOrEqual(after);
    });

    it('context の callerAgent / callerReason をスキル側に伝達する', async () => {
      const reg = new SkillRegistry();
      let captured: { caller?: string; reason?: string } = {};
      reg.register(
        makeSkill({
          name: 'ctx',
          async execute(_input, context) {
            captured = { caller: context.callerAgent, reason: context.callerReason };
            return null;
          },
        }),
      );
      await reg.invoke('ctx', {}, {
        callerAgent: 'discovery',
        callerReason: '週次探索',
      });
      expect(captured).toEqual({ caller: 'discovery', reason: '週次探索' });
    });
  });

  describe('callAsMcpTool', () => {
    it('成功時は text content + isError=false で返す', async () => {
      const reg = new SkillRegistry();
      reg.register(
        makeSkill({
          name: 'ok',
          async execute() {
            return { value: 1 };
          },
        }),
      );
      const res = await reg.callAsMcpTool('ok', {});
      expect(res.isError).toBe(false);
      expect(JSON.parse(res.content[0]!.text!)).toEqual({ value: 1 });
    });

    it('失敗時は isError=true、text に error コードとメッセージ', async () => {
      const reg = new SkillRegistry();
      reg.register(
        makeSkill({
          name: 'fail',
          async execute() {
            throw new Error('nope');
          },
        }),
      );
      const res = await reg.callAsMcpTool('fail', {});
      expect(res.isError).toBe(true);
      const body = JSON.parse(res.content[0]!.text!);
      expect(body).toEqual({
        error: 'SKILL_EXECUTION_ERROR',
        message: 'nope',
      });
    });
  });
});
