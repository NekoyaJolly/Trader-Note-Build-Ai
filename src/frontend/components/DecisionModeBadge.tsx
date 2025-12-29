/**
 * 判断モードバッジコンポーネント
 * 
 * トレードの判断モード（順張り/逆張り/ニュートラル）を視覚的に表示
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

// 判断モードの種類
export type DecisionMode = "trend" | "reversal" | "neutral";

interface DecisionModeBadgeProps {
  /**
   * 判断モード
   */
  mode: DecisionMode;
  /**
   * サイズ（デフォルト: medium）
   */
  size?: "small" | "medium";
  /**
   * カスタムラベル（省略時はデフォルトラベル）
   */
  label?: string;
}

// モード別の設定
const modeConfig: Record<DecisionMode, {
  label: string;
  className: string;
}> = {
  trend: {
    label: "順張り",
    className: "badge-decision-trend",
  },
  reversal: {
    label: "逆張り",
    className: "badge-decision-reversal",
  },
  neutral: {
    label: "ニュートラル",
    className: "badge-decision-neutral",
  },
};

/**
 * 判断モードバッジコンポーネント
 * 順張り/逆張り/ニュートラルを色で表現
 */
export default function DecisionModeBadge({
  mode,
  size = "medium",
  label,
}: DecisionModeBadgeProps) {
  const config = modeConfig[mode];
  
  // サイズ別のスタイル
  const sizeClasses = {
    small: "px-2 py-0.5 text-xs",
    medium: "px-3 py-1 text-sm",
  };

  return (
    <span
      className={`
        inline-flex items-center rounded-full font-medium
        ${config.className}
        ${sizeClasses[size]}
        transition-smooth
      `}
    >
      {label || config.label}
    </span>
  );
}
