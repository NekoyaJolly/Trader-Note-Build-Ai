/**
 * Skeleton コンポーネント
 * Neon Dark テーマ対応
 * 
 * デザイン仕様:
 * - 背景: slate-700 (ローディングプレースホルダー)
 * - アニメーション: pulse
 */
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-slate-700", className)}
      {...props}
    />
  )
}

export { Skeleton }
