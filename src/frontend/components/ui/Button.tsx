/**
 * Button コンポーネント
 * Neon Dark テーマ対応
 * 
 * デザイン仕様:
 * - default: ネオングラデーション (pink-500 → violet-500)
 * - secondary: green-500 系 (成功/承認)
 * - destructive: red-500 系 (削除/警告)
 * - ghost/outline: 透明背景 + slate-700 ボーダー
 */
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // 共通スタイル: フォーカスリング + トランジション
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // デフォルト: ネオングラデーション + グロー効果
        default: "bg-gradient-to-r from-pink-500 to-violet-500 text-white hover:from-pink-400 hover:to-violet-400 hover:shadow-[0_0_20px_rgba(236,72,153,0.4)]",
        // 破壊的アクション: 赤系
        destructive: "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)]",
        // アウトライン: 透明背景 + ボーダー
        outline: "border border-slate-600 text-gray-300 hover:bg-slate-700/50 hover:text-white",
        // セカンダリ: グリーン系 (承認/成功)
        secondary: "bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30 hover:shadow-[0_0_15px_rgba(34,197,94,0.3)]",
        // ゴースト: 最小限のスタイル
        ghost: "text-gray-400 hover:text-white hover:bg-slate-700/50",
        // リンク風
        link: "text-violet-400 underline-offset-4 hover:text-violet-300 hover:underline",
      },
      size: {
        default: "px-4 py-2.5",
        sm: "px-3 py-1.5 text-xs",
        lg: "px-6 py-3 text-base",
        icon: "p-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
