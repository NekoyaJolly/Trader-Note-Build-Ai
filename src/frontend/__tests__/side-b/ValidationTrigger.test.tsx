/**
 * ValidationTrigger — 表示と成功時コールバック
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ValidationTrigger } from "@/components/side-b/ValidationTrigger";

// Wave 1 G5-3 (Copilot レビュー #6): toast 動作を検証可能にするため sonner を mock
vi.mock("sonner", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));
import { toast } from "sonner";

describe("ValidationTrigger", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.mocked(toast.success).mockClear();
        vi.mocked(toast.error).mockClear();
    });

    it("ラベルを表示する", () => {
        render(
            <ValidationTrigger hypothesisId="123e4567-e89b-12d3-a456-426614174000" label="テスト実行" />,
        );
        expect(screen.getByRole("button", { name: "テスト実行" })).toBeInTheDocument();
    });

    it("検証成功時 onComplete が呼ばれる", async () => {
        const user = userEvent.setup();
        const onComplete = vi.fn();
        const body = {
            success: true,
            verdict: "confirmed",
            hypothesisId: "123e4567-e89b-12d3-a456-426614174000",
            baseCriteriaReasons: [],
            decidedAt: new Date().toISOString(),
        };
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve(body),
            }),
        );

        render(
            <ValidationTrigger
                hypothesisId="123e4567-e89b-12d3-a456-426614174000"
                onComplete={onComplete}
            />,
        );
        await user.click(screen.getByRole("button", { name: "本格検証を実行" }));
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete.mock.calls[0][0]).toMatchObject({ verdict: "confirmed" });
        // Wave 1 G5-3 (Copilot #6): 成功時に toast.success が呼ばれる
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith("本格検証を実行しました");
    });

    it("検証失敗時 toast.error が呼ばれる", async () => {
        const user = userEvent.setup();
        const onError = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ message: "internal error" }),
                text: () => Promise.resolve("internal error"),
            }),
        );

        render(
            <ValidationTrigger
                hypothesisId="123e4567-e89b-12d3-a456-426614174000"
                onError={onError}
            />,
        );
        await user.click(screen.getByRole("button", { name: "本格検証を実行" }));
        expect(onError).toHaveBeenCalledTimes(1);
        // Wave 1 G5-3 (Copilot #6): 失敗時に toast.error が呼ばれる
        expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
        const errCall = vi.mocked(toast.error).mock.calls[0]?.[0];
        expect(String(errCall)).toMatch(/本格検証エラー/);
    });
});
