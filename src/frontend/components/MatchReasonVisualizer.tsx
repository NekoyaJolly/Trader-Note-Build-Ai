/**
 * 判定理由可視化コンポーネント
 * 
 * 一致判定の根拠となる特徴量比較を横バー形式で表示
 * Neon Dark テーマ対応
 */

import type { MatchReason } from "@/types/notification";

interface MatchReasonVisualizerProps {
  /**
   * 判定理由の配列
   */
  reasons: MatchReason[];
  /**
   * 表示スタイル（bars: 横バー, table: テーブル）
   */
  variant?: "bars" | "table";
}

/**
 * 寄与度を0-100%のパーセンテージに変換
 * 寄与度の最大値を基準にスケーリング
 */
function getContributionPercentage(contribution: number, maxContribution: number): number {
  if (maxContribution === 0) return 0;
  return Math.min(Math.abs(contribution) / maxContribution * 100, 100);
}

/**
 * 横バー形式の理由表示コンポーネント
 */
function BarsView({ reasons }: { reasons: MatchReason[] }) {
  // 寄与度の絶対値の最大値を取得（スケーリング用）
  const maxContribution = Math.max(...reasons.map((r) => Math.abs(r.contribution)), 0.01);

  return (
    <div className="space-y-4">
      {reasons.map((reason, index) => {
        const percentage = getContributionPercentage(reason.contribution, maxContribution);
        const isPositive = reason.contribution > 0;
        const isNegative = reason.contribution < 0;

        return (
          <div key={index} className="space-y-1">
            {/* ラベル行 */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-300">
                {reason.featureName}
              </span>
              <span className={`text-sm font-mono font-semibold ${
                isPositive ? "text-green-400" :
                isNegative ? "text-red-400" :
                "text-gray-400"
              }`}>
                {isPositive ? "+" : ""}{reason.contribution.toFixed(4)}
              </span>
            </div>
            
            {/* プログレスバー */}
            <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${
                  isPositive
                    ? "bg-gradient-to-r from-green-500 to-emerald-400"
                    : isNegative
                    ? "bg-gradient-to-r from-red-500 to-rose-400"
                    : "bg-gray-500"
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            
            {/* 詳細情報（展開可能） */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>ノート: <span className="font-mono text-gray-400">{reason.noteValue.toFixed(2)}</span></span>
              <span>現在: <span className="font-mono text-gray-400">{reason.currentValue.toFixed(2)}</span></span>
              <span>差分: <span className={`font-mono ${
                reason.diff > 0 ? "text-green-400" :
                reason.diff < 0 ? "text-red-400" :
                "text-gray-400"
              }`}>
                {reason.diff >= 0 ? "+" : ""}{reason.diff.toFixed(2)}
              </span></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * テーブル形式の理由表示コンポーネント（ダークモード対応）
 */
function TableView({ reasons }: { reasons: MatchReason[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-slate-700">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
              特徴量
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
              ノート時
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
              現在
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
              差分
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
              寄与度
            </th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
              評価
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {reasons.map((reason, index) => {
            const isPositive = reason.contribution > 0;
            const isNegative = reason.contribution < 0;

            return (
              <tr
                key={index}
                className="hover:bg-slate-700/50 transition-colors"
              >
                <td className="px-4 py-3 text-sm text-gray-200">
                  {reason.featureName}
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-400 font-mono">
                  {reason.noteValue.toFixed(4)}
                </td>
                <td className="px-4 py-3 text-sm text-right text-gray-400 font-mono">
                  {reason.currentValue.toFixed(4)}
                </td>
                <td className={`px-4 py-3 text-sm text-right font-mono ${
                  reason.diff > 0 ? "text-green-400" :
                  reason.diff < 0 ? "text-red-400" :
                  "text-gray-500"
                }`}>
                  {reason.diff >= 0 ? "+" : ""}
                  {reason.diff.toFixed(4)}
                </td>
                <td className={`px-4 py-3 text-sm text-right font-mono font-semibold ${
                  isPositive ? "text-green-400" :
                  isNegative ? "text-red-400" :
                  "text-gray-500"
                }`}>
                  {isPositive ? "+" : ""}
                  {reason.contribution.toFixed(4)}
                </td>
                <td className="px-4 py-3 text-center">
                  {isPositive ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500/20 text-green-400">
                      ↑
                    </span>
                  ) : isNegative ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500/20 text-red-400">
                      ↓
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-500/20 text-gray-400">
                      −
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 判定理由を可視化するコンポーネント
 * 
 * @param reasons - 判定理由の配列
 * @param variant - 表示スタイル (bars: 横バー, table: テーブル)
 */
export default function MatchReasonVisualizer({
  reasons,
  variant = "bars",
}: MatchReasonVisualizerProps) {
  if (!reasons || reasons.length === 0) {
    return (
      <div className="text-gray-400 text-center py-8">
        判定理由データがありません
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* メイン表示 */}
      {variant === "bars" ? (
        <BarsView reasons={reasons} />
      ) : (
        <TableView reasons={reasons} />
      )}

      {/* 日本語での理由リスト */}
      <div className="pt-4 border-t border-slate-700">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">
          判定理由（詳細）
        </h4>
        <ul className="space-y-2">
          {reasons.map((reason, index) => (
            <li key={index} className="text-sm text-gray-400 flex items-start">
              <span className={`mr-2 ${
                reason.contribution > 0 ? "text-green-400" :
                reason.contribution < 0 ? "text-red-400" :
                "text-gray-500"
              }`}>
                {reason.contribution > 0 ? "✓" : reason.contribution < 0 ? "✗" : "•"}
              </span>
              <span>{reason.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
