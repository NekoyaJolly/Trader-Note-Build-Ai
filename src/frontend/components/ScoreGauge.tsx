/**
 * スコアゲージコンポーネント
 * 一致度スコア (0.0 〜 1.0) を視覚的に表示
 */

interface ScoreGaugeProps {
  /**
   * スコア値（0.0 〜 1.0）
   */
  score: number;
  /**
   * 閾値ライン（オプション）
   * この値を超えると色が変わる
   */
  threshold?: number;
  /**
   * サイズ（デフォルト: medium）
   */
  size?: "small" | "medium" | "large";
}

/**
 * スコアゲージコンポーネント
 * 0〜1 のスコアを 0〜100% のゲージで表示
 */
export default function ScoreGauge({
  score,
  threshold = 0.7,
  size = "medium",
}: ScoreGaugeProps) {
  // スコアを 0〜100% に変換
  const percentage = Math.min(Math.max(score * 100, 0), 100);

  // 閾値判定による色分け
  const isHighScore = score >= threshold;
  const gaugeColor = isHighScore
    ? "bg-green-500" // 閾値以上: 緑
    : "bg-blue-400"; // 閾値未満: 青

  // サイズ別のスタイル
  const sizeClasses = {
    small: "h-2 text-sm",
    medium: "h-4 text-base",
    large: "h-6 text-lg",
  };

  return (
    <div className="flex items-center gap-3">
      {/* スコア数値表示 */}
      <span
        className={`font-mono font-semibold ${sizeClasses[size]} ${
          isHighScore ? "text-green-600" : "text-gray-700"
        }`}
      >
        {score.toFixed(2)}
      </span>

      {/* ゲージバー */}
      <div className="flex-1 bg-gray-200 rounded-full overflow-hidden relative">
        {/* ゲージ本体 */}
        <div
          className={`${gaugeColor} ${sizeClasses[size]} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />

        {/* 閾値ライン（オプション表示） */}
        {threshold && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400"
            style={{ left: `${threshold * 100}%` }}
            title={`閾値: ${threshold.toFixed(2)}`}
          />
        )}
      </div>

      {/* パーセント表示 */}
      <span className={`text-gray-600 ${sizeClasses[size]}`}>
        {percentage.toFixed(0)}%
      </span>
    </div>
  );
}
