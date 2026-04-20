import { describe, it, expect } from "vitest";
import { parseEvolutionStatement } from "@/lib/evolutionStatement";

describe("parseEvolutionStatement", () => {
  it("[DSL:uuid] プレフィックスを除去して displayText と dslId を返す", () => {
    const result = parseEvolutionStatement(
      "[DSL:a1b2c3d4-e5f6-7890-abcd-ef1234567890] ロンドン寄り後のブレイクアウト",
    );
    expect(result).toEqual({
      displayText: "ロンドン寄り後のブレイクアウト",
      dslId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      isEvolutionPrefixed: true,
    });
  });

  it("プレフィックスなしの statement はそのまま返す", () => {
    const raw = "東京時間のレンジブレイクは信頼性が高い";
    const result = parseEvolutionStatement(raw);
    expect(result).toEqual({
      displayText: raw,
      dslId: null,
      isEvolutionPrefixed: false,
    });
  });

  it("空文字は displayText 空文字で返す", () => {
    const result = parseEvolutionStatement("");
    expect(result).toEqual({
      displayText: "",
      dslId: null,
      isEvolutionPrefixed: false,
    });
  });

  it("大文字の [DSL:...] にもマッチする", () => {
    const result = parseEvolutionStatement(
      "[DSL:ABCDEF01-2345-6789-ABCD-EF0123456789] テスト",
    );
    expect(result.isEvolutionPrefixed).toBe(true);
    expect(result.dslId).toBe("ABCDEF01-2345-6789-ABCD-EF0123456789");
    expect(result.displayText).toBe("テスト");
  });

  it("[DSL:] の後に説明文がない場合は元の文字列を返す", () => {
    const raw = "[DSL:a1b2c3d4-e5f6-7890-abcd-ef1234567890]";
    const result = parseEvolutionStatement(raw);
    expect(result.isEvolutionPrefixed).toBe(true);
    expect(result.dslId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result.displayText).toBe(raw);
  });

  it("不正なフォーマット [DSL:not-uuid は通常 statement として扱う", () => {
    const raw = "[DSL:not-a-valid-uuid] 何かの説明";
    const result = parseEvolutionStatement(raw);
    // UUID パターンにマッチしないのでプレフィックスなし扱い
    expect(result.isEvolutionPrefixed).toBe(false);
    expect(result.displayText).toBe(raw);
    expect(result.dslId).toBeNull();
  });

  it("[DSL:] が途中にある場合はプレフィックスとみなさない", () => {
    const raw = "説明 [DSL:a1b2c3d4-e5f6-7890-abcd-ef1234567890] 追加";
    const result = parseEvolutionStatement(raw);
    expect(result.isEvolutionPrefixed).toBe(false);
    expect(result.displayText).toBe(raw);
  });
});
