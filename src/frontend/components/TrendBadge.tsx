/**
 * トレンドバッジコンポーネント
 * 
 * 市場のトレンド方向（上昇/下降/横ばい）を視覚的に表示
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

// トレンドの種類
export type TrendDirection = "up" | "down" | "neutral";

interface TrendBadgeProps {
  /**
   * トレンド方向
   */
  trend: TrendDirection;
  /**
   * サイズ（デフォルト: medium）
   */
  size?: "small" | "medium";
  /**
   * カスタムラベル（省略時はデフォルトラベル）
   */
  label?: string;
}

// トレンド別の設定
const trendConfig: Record<TrendDirection, {
  label: string;
  icon: string;
  className: string;
}> = {
  up: {
    label: "上昇トレンド",
    icon: "↑",
    className: "badge-trend-up",
  },
  down: {
    label: "下降トレンド",
    icon: "↓",
    className: "badge-trend-down",
  },
  neutral: {
    label: "横ばい",
    icon: "→",
    className: "badge-trend-neutral",
  },
};

/**
 * トレンドバッジコンポーネント
 * 上昇/下降/横ばいを色とアイコンで表現
 */
export default function TrendBadge({
  trend,
  size = "medium",
  label,
}: TrendBadgeProps) {
  const config = trendConfig[trend];
  
  // サイズ別のスタイル
  const sizeClasses = {
    small: "px-2 py-0.5 text-xs",
    medium: "px-3 py-1 text-sm",
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full font-medium
        ${config.className}
        ${sizeClasses[size]}
        transition-smooth
      `}
    >
      <span>{config.icon}</span>
      <span>{label || config.label}</span>
    </span>
  );
}
