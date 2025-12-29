/**
 * スコアゲージコンポーネント（Neon Dark テーマ対応）
 * 
 * 一致度スコア (0.0 〜 1.0) を円形ゲージで視覚的に表示
 * ネオングラデーションを使用したプロフェッショナルなデザイン
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

interface ScoreGaugeProps {
  /**
   * スコア値（0.0 〜 1.0）
   */
  score: number;
  /**
   * サイズ（デフォルト: large）
   * - large: 120px - 詳細パネル、カード内
   * - small: 64px - リスト表示、コンパクト
   */
  size?: "small" | "large";
  /**
   * 精度ラベル（オプション）
   * 例: "精度" を表示する場合
   */
  label?: string;
  /**
   * アニメーション有効化（デフォルト: true）
   */
  animated?: boolean;
}

/**
 * 円形スコアゲージコンポーネント
 * ネオングラデーションのリングで 0〜100% を表示
 */
export default function ScoreGauge({
  score,
  size = "large",
  label,
  animated = true,
}: ScoreGaugeProps) {
  // スコアを 0〜100 に変換
  const percentage = Math.min(Math.max(score * 100, 0), 100);
  
  // サイズ別の設定
  const config = {
    large: {
      size: 120,
      strokeWidth: 8,
      radius: 52,
      fontSize: "text-3xl",
      labelSize: "text-xs",
    },
    small: {
      size: 64,
      strokeWidth: 6,
      radius: 26,
      fontSize: "text-lg",
      labelSize: "text-[10px]",
    },
  };

  const { size: svgSize, strokeWidth, radius, fontSize, labelSize } = config[size];
  
  // 円周と進捗
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  
  // 中心座標
  const center = svgSize / 2;

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* SVG 円形ゲージ */}
      <svg
        width={svgSize}
        height={svgSize}
        className={animated ? "transition-all duration-500" : ""}
      >
        {/* グラデーション定義 */}
        <defs>
          <linearGradient id="neonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#EC4899" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>

        {/* 背景リング（トラック） */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#334155"
          strokeWidth={strokeWidth}
        />

        {/* 進捗リング（ネオングラデーション） */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#neonGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${center} ${center})`}
          className={animated ? "score-gauge-ring" : ""}
          style={{
            filter: "drop-shadow(0 0 6px rgba(236, 72, 153, 0.5))",
          }}
        />
      </svg>

      {/* 中央のスコア表示 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {/* ラベル（オプション） */}
        {label && (
          <span className={`${labelSize} text-gray-400 mb-0.5`}>
            {label}
          </span>
        )}
        {/* スコア数値 */}
        <span className={`${fontSize} font-bold text-white`}>
          {Math.round(percentage)}
        </span>
      </div>
    </div>
  );
}
