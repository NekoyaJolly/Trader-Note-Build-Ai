/**
 * Phase 6.7a: expandMacros のユニットテスト
 *
 * Registry 経由の content にもマクロ展開を適用できるようにするため、
 * loader から切り出した純粋関数。
 */

import { expandMacros } from '../../prompts/loader';

describe('expandMacros', () => {
  it('macros 未指定なら content をそのまま返す', () => {
    expect(expandMacros('hello {{X}}')).toBe('hello {{X}}');
    expect(expandMacros('no placeholders')).toBe('no placeholders');
  });

  it('指定されたキーを置換する', () => {
    const out = expandMacros('A={{X}} B={{Y}}', { X: 'foo', Y: 'bar' });
    expect(out).toBe('A=foo B=bar');
  });

  it('undefined の値は空文字に置換する', () => {
    const out = expandMacros('A={{X}}', { X: undefined });
    expect(out).toBe('A=');
  });

  it('同じキーが複数回あっても全て置換する', () => {
    const out = expandMacros('{{X}}-{{X}}-{{X}}', { X: 'rep' });
    expect(out).toBe('rep-rep-rep');
  });

  it('辞書に無いキーはプレースホルダーを残す', () => {
    const out = expandMacros('{{X}} {{Y}}', { X: 'only-x' });
    expect(out).toBe('only-x {{Y}}');
  });

  it('CORE_TRADING_RULES のような実運用パターン', () => {
    const content = `# Strategy Thinker

## ルール
{{CORE_TRADING_RULES}}

## マクロ
{{MACRO_ENVIRONMENT_RULES}}

## MTF
{{MTF_ANALYSIS_RULES}}`;
    const out = expandMacros(content, {
      CORE_TRADING_RULES: '- rule 1',
      MACRO_ENVIRONMENT_RULES: '- macro rule',
      MTF_ANALYSIS_RULES: '- mtf rule',
    });
    expect(out).toContain('- rule 1');
    expect(out).toContain('- macro rule');
    expect(out).toContain('- mtf rule');
    expect(out).not.toContain('{{CORE_TRADING_RULES}}');
    expect(out).not.toContain('{{MACRO_ENVIRONMENT_RULES}}');
    expect(out).not.toContain('{{MTF_ANALYSIS_RULES}}');
  });

  it('プレースホルダー形式でないものは触らない', () => {
    const out = expandMacros('{X} {{{X}}} $X', { X: 'val' });
    // {{X}} が含まれるとそこだけ置換される。{X} や $X はそのまま
    expect(out).toBe('{X} {val} $X');
  });
});
