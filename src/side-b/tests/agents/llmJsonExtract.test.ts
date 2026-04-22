/**
 * Phase 6 hotfix: extractJson / extractOutermostBrackets のテスト
 *
 * 3 段階 fallback (raw → fence → bracket) の挙動、および本文中の ``` 誤マッチ回避を検証。
 */

import { extractJson, extractOutermostBrackets } from '../../agents/llmJsonExtract';

describe('extractJson', () => {
  describe('raw 経路', () => {
    it('プレーン JSON 配列を raw でパースできる', () => {
      const r = extractJson('[{"a":1}]');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.via).toBe('raw');
        expect(r.data).toEqual([{ a: 1 }]);
      }
    });

    it('プレーン JSON オブジェクトを raw でパースできる', () => {
      const r = extractJson('{"k":"v"}');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.via).toBe('raw');
      }
    });

    it('前後の空白を除去して raw 処理する', () => {
      const r = extractJson('  \n  {"k":1}  \n');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.via).toBe('raw');
    });

    it('重要: 応答の内部文字列に ``` を含むプレーン JSON を誤マッチせず raw 経路で parse する', () => {
      // これが Phase 6 hotfix で修正したい本丸ケース
      const content = `[
  {
    "version": "v1",
    "content": "# テストエージェント\\n\\n## 出力形式\\n\\n\\u0060\\u0060\\u0060json\\n{\\"value\\": 1}\\n\\u0060\\u0060\\u0060\\n",
    "notes": "test"
  }
]`;
      const r = extractJson(content);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.via).toBe('raw');
        expect(Array.isArray(r.data)).toBe(true);
        const arr = r.data as Array<{ content: string }>;
        expect(arr[0]!.content).toContain('出力形式');
        expect(arr[0]!.content).toContain('```json');
      }
    });
  });

  describe('fence 経路', () => {
    it('応答全体が ```json フェンスで包まれている場合、fence 経路で parse する', () => {
      const content = '```json\n[{"a":1}]\n```';
      const r = extractJson(content);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.via).toBe('fence');
        expect(r.data).toEqual([{ a: 1 }]);
      }
    });

    it('言語指定なし ``` でも parse できる', () => {
      const content = '```\n{"k":1}\n```';
      const r = extractJson(content);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.via).toBe('fence');
      }
    });

    it('fence 外に前置テキストがあると fence 経路は使われない(誤マッチ回避)', () => {
      // 行頭アンカーで包む fence のみ許容。前置きがあれば bracket 経路へ
      const content = 'ここから JSON を返します:\n```json\n[{"a":1}]\n```';
      const r = extractJson(content);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.via).toBe('bracket');
        expect(r.data).toEqual([{ a: 1 }]);
      }
    });
  });

  describe('bracket 経路', () => {
    it('前置き + JSON の混在を bracket で抽出する', () => {
      const content = 'ここから JSON を返します: {"k": 1, "arr": [1,2,3]} 以上です';
      const r = extractJson(content);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.via).toBe('bracket');
        expect(r.data).toEqual({ k: 1, arr: [1, 2, 3] });
      }
    });

    it('ネストされた括弧を正しくバランスする', () => {
      const content = 'ok: {"a":{"b":{"c":[1,2]}}}';
      const r = extractJson(content);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.via).toBe('bracket');
    });

    it('文字列リテラル内の括弧は無視する', () => {
      const content = 'ok: {"note": "}{][}", "v": 1}';
      const r = extractJson(content);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data).toEqual({ note: '}{][}', v: 1 });
    });
  });

  describe('失敗ケース', () => {
    it('空文字列は失敗', () => {
      const r = extractJson('');
      expect(r.ok).toBe(false);
    });

    it('JSON として成立しない文字列は失敗', () => {
      const r = extractJson('hello world');
      expect(r.ok).toBe(false);
    });

    it('max_tokens 切断で閉じ括弧がない(Unterminated)応答は null を返す', () => {
      // Phase 6.5 で実際に発生したケースの再現
      const truncated = '```json\n{"analysis":{"currentAgents":["x"],"coverageGaps":["y"';
      const r = extractJson(truncated);
      expect(r.ok).toBe(false);
    });
  });
});

describe('extractOutermostBrackets', () => {
  it('最外の {} を切り出す', () => {
    expect(extractOutermostBrackets('prefix {"a":1} suffix')).toBe('{"a":1}');
  });

  it('最外の [] を切り出す', () => {
    expect(extractOutermostBrackets('prefix [1,2,3] suffix')).toBe('[1,2,3]');
  });

  it('ネストされた括弧を正しくバランスする', () => {
    expect(extractOutermostBrackets('x {"a":{"b":[1,{"c":2}]}} y')).toBe(
      '{"a":{"b":[1,{"c":2}]}}',
    );
  });

  it('文字列リテラル内の括弧は無視', () => {
    expect(extractOutermostBrackets('{"s": "][{}]", "n": 1}')).toBe('{"s": "][{}]", "n": 1}');
  });

  it('エスケープされたクォートを考慮', () => {
    expect(extractOutermostBrackets('{"s": "a\\"b", "n": 1}')).toBe(
      '{"s": "a\\"b", "n": 1}',
    );
  });

  it('閉じ括弧がない場合は null', () => {
    expect(extractOutermostBrackets('{"a":1')).toBeNull();
    expect(extractOutermostBrackets('[1,2')).toBeNull();
  });

  it('開き括弧がない場合は null', () => {
    expect(extractOutermostBrackets('hello world')).toBeNull();
  });
});
