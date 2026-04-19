/**
 * ValidationTrigger — 表示と成功時コールバック
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ValidationTrigger } from "@/components/side-b/ValidationTrigger";

describe("ValidationTrigger", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
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
    });
});
