/**
 * ValidationProgressBar の表示確認
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ValidationProgressBar } from "@/components/side-b/ValidationProgressBar";

describe("ValidationProgressBar", () => {
    it("testing 時にプログレス用の testid が付く", () => {
        const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        render(
            <ValidationProgressBar hypothesisId={id} status="testing" />,
        );
        expect(screen.getByTestId(`validation-progress-${id}`)).toBeInTheDocument();
    });
});
