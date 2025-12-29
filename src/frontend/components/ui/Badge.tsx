/**
 * Badge コンポーネント
 * Neon Dark テーマ対応
 * 
 * デザイン仕様:
 * - default: ネオングラデーション (pink-500/violet-500)
 * - secondary: グリーン系 (BUY / 上昇)
 * - destructive: レッド系 (SELL / 下落)
 * - outline: 透明背景 + ボーダー
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all duration-300",
  {
    variants: {
      variant: {
        // デフォルト: ネオングラデーション背景
        default:
          "border-transparent bg-gradient-to-r from-pink-500/20 to-violet-500/20 text-pink-300 border-pink-500/30",
        // セカンダリ: グリーン系 (BUY / 成功 / 上昇)
        secondary:
          "border-transparent bg-green-500/20 text-green-400 border-green-500/30",
        // 破壊的: レッド系 (SELL / 警告 / 下落)
        destructive:
          "border-transparent bg-red-500/20 text-red-400 border-red-500/30",
        // アウトライン: 透明背景
        outline: "text-gray-400 border-slate-600",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
