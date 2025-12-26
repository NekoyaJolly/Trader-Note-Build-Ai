/**
 * 判定理由可視化コンポーネント
 * 一致判定の根拠となる特徴量比較を表形式で表示
 */

import type { MatchReason } from "@/types/notification";

interface MatchReasonVisualizerProps {
  /**
   * 判定理由の配列
   */
  reasons: MatchReason[];
}

/**
 * 判定理由を表形式で可視化するコンポーネント
 */
export default function MatchReasonVisualizer({
  reasons,
}: MatchReasonVisualizerProps) {
  if (!reasons || reasons.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">
        判定理由データがありません
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-gray-300">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 border-b">
              特徴量
            </th>
            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700 border-b">
              ノート時
            </th>
            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700 border-b">
              現在
            </th>
            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700 border-b">
              差分
            </th>
            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700 border-b">
              重み
            </th>
            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700 border-b">
              寄与度
            </th>
            <th className="px-4 py-2 text-center text-sm font-semibold text-gray-700 border-b">
              評価
            </th>
          </tr>
        </thead>
        <tbody>
          {reasons.map((reason, index) => {
            // 寄与度がプラスなら緑、マイナスなら赤
            const contributionColor =
              reason.contribution > 0
                ? "text-green-600"
                : reason.contribution < 0
                  ? "text-red-600"
                  : "text-gray-600";

            return (
              <tr
                key={index}
                className="border-b hover:bg-gray-50 transition-colors"
              >
                {/* 特徴量名 */}
                <td className="px-4 py-2 text-sm text-gray-800">
                  {reason.featureName}
                </td>

                {/* ノート時の値 */}
                <td className="px-4 py-2 text-sm text-right text-gray-700 font-mono">
                  {reason.noteValue.toFixed(4)}
                </td>

                {/* 現在の値 */}
                <td className="px-4 py-2 text-sm text-right text-gray-700 font-mono">
                  {reason.currentValue.toFixed(4)}
                </td>

                {/* 差分 */}
                <td className="px-4 py-2 text-sm text-right text-gray-600 font-mono">
                  {reason.diff >= 0 ? "+" : ""}
                  {reason.diff.toFixed(4)}
                </td>

                {/* 重み */}
                <td className="px-4 py-2 text-sm text-right text-gray-600 font-mono">
                  {reason.weight.toFixed(2)}
                </td>

                {/* 寄与度（色分け） */}
                <td
                  className={`px-4 py-2 text-sm text-right font-mono font-semibold ${contributionColor}`}
                >
                  {reason.contribution >= 0 ? "+" : ""}
                  {reason.contribution.toFixed(4)}
                </td>

                {/* 評価インジケーター */}
                <td className="px-4 py-2 text-center">
                  {reason.contribution > 0 ? (
                    <span className="text-green-500 text-lg" title="加点">
                      ▲
                    </span>
                  ) : reason.contribution < 0 ? (
                    <span className="text-red-500 text-lg" title="減点">
                      ▼
                    </span>
                  ) : (
                    <span className="text-gray-400 text-lg" title="中立">
                      ●
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 日本語での理由リスト */}
      <div className="mt-6">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">
          判定理由（日本語）
        </h4>
        <ul className="space-y-2">
          {reasons.map((reason, index) => (
            <li key={index} className="text-sm text-gray-700 flex items-start">
              <span className="mr-2 text-gray-400">•</span>
              <span>{reason.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
