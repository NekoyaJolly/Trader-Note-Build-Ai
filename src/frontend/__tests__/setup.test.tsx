/**
 * Vitest + React Testing Library のセットアップ動作確認テスト
 *
 * このテストは「テスト基盤が通る」ことを保証するための最小ダミー。
 * - jsdom 環境が動いている
 * - JSX がレンダリングできる
 * - @testing-library/jest-dom のマッチャが使える
 * - `@/` path alias が解決する
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { cn } from "@/lib/utils";

describe("vitest セットアップ", () => {
    it("JSX をレンダリングして DOM からクエリできる", () => {
        render(<div data-testid="greeting">こんにちは</div>);
        const el = screen.getByTestId("greeting");
        expect(el).toBeInTheDocument();
        expect(el).toHaveTextContent("こんにちは");
    });

    it("@/ path alias が解決する (@/lib/utils が import できる)", () => {
        const merged = cn("text-red-500", "font-bold");
        expect(merged).toContain("text-red-500");
        expect(merged).toContain("font-bold");
    });
});
