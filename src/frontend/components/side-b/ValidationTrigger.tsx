/**
 * 本格検証の手動トリガー（Phase 4d §4.4 / §4.6）
 *
 * 詳細画面・検証画面で共通利用。二重送信防止と完了/エラー通知を内包する。
 */

"use client";

import * as React from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import type { ValidateResponse } from "@/types/sideB";

export interface ValidationTriggerProps {
  hypothesisId: string;
  /** E2E / 詳細画面用 */
  "data-testid"?: string;
  /** ボタン文言（既定: 「本格検証を実行」） */
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
  onComplete?: (result: ValidateResponse) => void;
  onError?: (message: string) => void;
}

export function ValidationTrigger({
  hypothesisId,
  "data-testid": dataTestId,
  label = "本格検証を実行",
  variant = "default",
  size = "sm",
  className,
  disabled = false,
  onComplete,
  onError,
}: ValidationTriggerProps) {
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    if (!hypothesisId || loading || disabled) return;
    setLoading(true);
    try {
      const result = await sideBApi.triggerValidation(hypothesisId);
      toast.success("本格検証を実行しました");
      onComplete?.(result);
    } catch (err) {
      const msg = err instanceof SideBApiError ? err.message : String(err);
      toast.error(`本格検証エラー: ${msg}`);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || loading}
      onClick={handleClick}
      data-testid={dataTestId ?? "validation-trigger"}
    >
      {loading ? "検証中…（10〜30秒）" : label}
    </Button>
  );
}
