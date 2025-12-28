import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // ヘッダーのナビボタンと統一したシンプルなデザイン
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // デフォルト: アクティブ状態のヘッダーボタン風
        default: "bg-blue-100 text-blue-700 hover:bg-blue-200",
        // 破壊的アクション
        destructive: "bg-red-100 text-red-700 hover:bg-red-200",
        // アウトライン: 非アクティブ状態のヘッダーボタン風
        outline: "text-gray-700 hover:bg-gray-100",
        // セカンダリ: 承認済みなどの完了状態
        secondary: "bg-green-100 text-green-700 hover:bg-green-200",
        // ゴースト: 目立たないボタン
        ghost: "text-gray-700 hover:bg-gray-100",
        // リンク風
        link: "text-blue-700 underline-offset-4 hover:underline",
      },
      size: {
        default: "px-3 py-2",
        sm: "px-2 py-1 text-xs",
        lg: "px-4 py-3",
        icon: "p-2",
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
