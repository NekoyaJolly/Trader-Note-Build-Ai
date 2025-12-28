/**
 * Progress コンポーネント（最小構成）
 * 0〜100% の進捗を横棒で表示する。
 */
export function Progress({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full h-2 bg-gray-200 rounded">
      <div
        className="h-2 bg-blue-500 rounded"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
