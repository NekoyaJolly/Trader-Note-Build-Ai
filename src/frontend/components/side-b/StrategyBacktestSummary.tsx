/**
 * プラン同梱の即時BT（Phase 6.7b）を要約表示
 */

import type { StrategyBacktestRunPayload } from "@/types/sideB";

type Props = {
  /** オーケストレータの `plan.strategyBacktest` */
  backtest: StrategyBacktestRunPayload | undefined;
  /** true のときキャッシュ再開で即時BTが付いていない */
  fromCachedPlan: boolean;
};

/**
 * 即時BTの全体/シナリオ別通過状況とツール連結文を箇条書きする
 */
export function StrategyBacktestSummary({ backtest, fromCachedPlan }: Props) {
  if (fromCachedPlan) {
    return (
      <p className="text-xs text-slate-500">
        本日分の既存プランを再利用中のため、即時BT（strategyBacktest）は付きません。再計算は「同じ日付でプラン再生成
        （forceRefresh）」を行ってください。
      </p>
    );
  }
  if (!backtest) {
    return (
      <p className="text-xs text-amber-400/90">
        今回の生成では即時BT結果がありません（シナリオ0件、BT例外、またはスキップ）。
      </p>
    );
  }

  const firstExecution = backtest.scenarioResults.find((r) => r.surrogateFitnessResult)?.surrogateFitnessResult;
  const cost = firstExecution?.costSummary;

  return (
    <div className="space-y-3 text-sm text-slate-200">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">全体</span>
        <span
          className={
            backtest.overallPassed ? "font-semibold text-emerald-400" : "font-semibold text-rose-400"
          }
        >
          {backtest.overallPassed ? "全シナリオ通過" : "いずれか未通過"}
        </span>
        <span className="text-slate-500">
          {backtest.period.start} 〜 {backtest.period.end} / {backtest.totalDurationMs}ms
        </span>
      </div>
      {firstExecution ? (
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-2.5 text-xs text-slate-300">
          <div className="flex flex-wrap gap-2">
            <span className="font-medium text-slate-200">執行モデル</span>
            <span>{firstExecution.executionModel ?? "unknown"}</span>
            <span className="text-slate-500">hash:</span>
            <span className="font-mono text-slate-400">{firstExecution.executionConfigHash ?? "-"}</span>
            <span className="text-slate-500">source:</span>
            <span>{firstExecution.dataSource ?? "ctrader"}</span>
          </div>
          {cost ? (
            <div className="mt-1 flex flex-wrap gap-2 text-slate-500">
              <span>roundTripCostPips={cost.roundTripCostPips ?? 0}</span>
              <span>atrMult={cost.roundTripCostAtrMult ?? 0}</span>
              <span>totalCost={Number(cost.totalCost ?? 0).toFixed(2)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-2 text-xs">
        {backtest.scenarioResults.map((r) => (
          <li
            key={r.scenario.id}
            className="border border-slate-700/60 rounded-lg p-2.5 bg-slate-800/40"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <span className="font-medium text-white">
                {r.scenario.name}{" "}
                <span className="text-slate-500 font-normal">({r.scenario.direction})</span>
              </span>
              <span className={r.passed ? "text-emerald-400" : "text-rose-400"}>
                {r.passed ? "3ツール通過" : "未通過/一部失敗"}
              </span>
            </div>
            {r.error ? (
              <p className="text-rose-400 mt-1">{r.error}</p>
            ) : null}
            <p className="text-slate-500 mt-1.5 line-clamp-4 break-words">{r.strategistInterpretation}</p>
            {r.surrogateFitnessResult?.costSummary ? (
              <p className="text-slate-600 mt-0.5">
                {r.surrogateFitnessResult.executionModel} / cost={Number(r.surrogateFitnessResult.costSummary.totalCost ?? 0).toFixed(2)}
              </p>
            ) : null}
            <p className="text-slate-600 mt-0.5">{r.durationMs}ms</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
