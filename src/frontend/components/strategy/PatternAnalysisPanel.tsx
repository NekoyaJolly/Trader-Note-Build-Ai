"use client";

/**
 * パターン分析パネルコンポーネント
 * 
 * 機能:
 * - 現在の市場状況と過去の勝ちパターンを比較
 * - 類似度スコアとエントリー推奨度を表示
 * - 異常検知結果を表示
 */

import { useState, useCallback } from "react";
import {
  analyzeStrategyPattern,
  detectAnomaly,
  fetchWinningPatterns,
  type FeatureVector,
  type PatternAnalysisResult,
  type AnomalyDetectionResult,
  type WinningPattern,
} from "@/lib/api";
import type { StrategyDirection } from "@/types/strategy";

// ============================================
// 型定義
// ============================================

interface PatternAnalysisPanelProps {
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: StrategyDirection;
  /** 現在の12次元特徴量（外部から渡す場合） */
  currentFeatures?: FeatureVector;
}

// ============================================
// サブコンポーネント
// ============================================

/** 推奨度バッジ */
function RecommendationBadge({ recommendation }: { recommendation: string }) {
  const styles: Record<string, string> = {
    strong: "bg-green-500/20 text-green-400 border-green-500/50",
    moderate: "bg-yellow-500/20 text-yellow-400 border-yellow-500/50",
    weak: "bg-orange-500/20 text-orange-400 border-orange-500/50",
    avoid: "bg-red-500/20 text-red-400 border-red-500/50",
  };

  const labels: Record<string, string> = {
    strong: "強く推奨",
    moderate: "やや推奨",
    weak: "弱い推奨",
    avoid: "見送り",
  };

  return (
    <span className={`px-3 py-1 rounded-full border text-sm font-medium ${styles[recommendation] || styles.weak}`}>
      {labels[recommendation] || recommendation}
    </span>
  );
}

/** スコアゲージ */
function ScoreGauge({ score, label }: { score: number; label: string }) {
  const getColor = (s: number) => {
    if (s >= 80) return "from-green-500 to-emerald-500";
    if (s >= 60) return "from-yellow-500 to-amber-500";
    if (s >= 40) return "from-orange-500 to-red-500";
    return "from-red-500 to-rose-500";
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="font-bold text-slate-200">{score}%</span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${getColor(score)} transition-all duration-500`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

/** パターンマッチカード */
function PatternMatchCard({ match }: { match: PatternAnalysisResult["patternMatches"][0] }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-200">{match.patternName}</span>
        <span className={`text-sm font-bold ${match.similarity >= 70 ? "text-green-400" : match.similarity >= 50 ? "text-yellow-400" : "text-red-400"}`}>
          {match.similarity}%
        </span>
      </div>
      {match.matchedDimensions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {match.matchedDimensions.slice(0, 3).map((dim, i) => (
            <span key={i} className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">
              {dim}
            </span>
          ))}
        </div>
      )}
      {match.divergentDimensions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {match.divergentDimensions.slice(0, 3).map((dim, i) => (
            <span key={i} className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">
              {dim}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 異常検知カード */
function AnomalyCard({ result }: { result: AnomalyDetectionResult }) {
  const typeLabels: Record<string, string> = {
    volatility_spike: "ボラティリティ急上昇",
    trend_reversal: "トレンド転換",
    volume_anomaly: "出来高異常",
    pattern_break: "パターン逸脱",
    none: "異常なし",
  };

  return (
    <div className={`p-4 rounded-lg border ${result.isAnomaly ? "bg-red-500/10 border-red-500/50" : "bg-green-500/10 border-green-500/50"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-200">異常検知</span>
        <span className={`text-lg font-bold ${result.isAnomaly ? "text-red-400" : "text-green-400"}`}>
          {result.anomalyScore}%
        </span>
      </div>
      <div className="text-sm text-slate-300 mb-2">
        {typeLabels[result.anomalyType]}
      </div>
      <p className="text-xs text-slate-400">{result.explanation}</p>
      {result.suggestedAction && (
        <p className="text-xs text-cyan-400 mt-2">💡 {result.suggestedAction}</p>
      )}
    </div>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export default function PatternAnalysisPanel({
  strategyId,
  strategyName,
  symbol,
  side,
  currentFeatures,
}: PatternAnalysisPanelProps) {
  // 状態
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PatternAnalysisResult | null>(null);
  const [anomalyResult, setAnomalyResult] = useState<AnomalyDetectionResult | null>(null);
  const [patterns, setPatterns] = useState<WinningPattern[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ダミー特徴量（現在の市場データがない場合のテスト用）
  const getDefaultFeatures = (): FeatureVector => ({
    trendStrength: 60,
    trendDirection: 65,
    maAlignment: 55,
    pricePosition: 58,
    rsiLevel: 45,
    macdMomentum: 52,
    momentumDivergence: 10,
    volatilityLevel: 48,
    bbWidth: 42,
    volatilityTrend: 50,
    supportProximity: 35,
    resistanceProximity: 70,
  });

  // パターン分析を実行
  const runAnalysis = useCallback(async () => {
    try {
      setAnalyzing(true);
      setError(null);

      const features = currentFeatures || getDefaultFeatures();

      // ストラテジーに対してパターン分析を実行
      const result = await analyzeStrategyPattern({
        strategyId,
        currentFeatures: features,
        context: {
          timeframe: "1h",
        },
      });

      setAnalysisResult(result.analysis);

      // 勝ちパターンを取得（異常検知用）
      const patternsData = await fetchWinningPatterns(strategyId, { limit: 20 });
      setPatterns(patternsData.patterns);

      // 異常検知も実行
      if (patternsData.patterns.length > 0) {
        const normalPatterns = patternsData.patterns.map(p => p.featureVector);
        const anomaly = await detectAnomaly({
          symbol,
          currentFeatures: features,
          normalPatterns,
          context: { timeframe: "1h" },
        });
        setAnomalyResult(anomaly);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  }, [strategyId, symbol, currentFeatures]);

  return (
    <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">
            🧠 AI パターン分析
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            過去の勝ちパターンと現在の市場状況を比較
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {analyzing ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              分析中...
            </span>
          ) : (
            "分析を実行"
          )}
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* 分析結果 */}
      {analysisResult && (
        <div className="space-y-4">
          {/* メインスコア */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
                  {analysisResult.overallScore}%
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  類似度スコア（信頼度: {(analysisResult.confidence * 100).toFixed(0)}%）
                </div>
              </div>
              <RecommendationBadge recommendation={analysisResult.recommendation} />
            </div>

            <ScoreGauge score={analysisResult.overallScore} label="総合類似度" />
          </div>

          {/* 推奨アクション */}
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
            <div className="text-sm font-medium text-cyan-400 mb-2">
              💡 推奨アクション
            </div>
            <p className="text-slate-200">{analysisResult.suggestedAction}</p>
          </div>

          {/* 理由とリスク */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 推奨理由 */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <div className="text-sm font-medium text-green-400 mb-2">
                ✅ 推奨理由
              </div>
              <ul className="space-y-1">
                {analysisResult.reasons.map((reason, i) => (
                  <li key={i} className="text-sm text-slate-300">
                    • {reason}
                  </li>
                ))}
              </ul>
            </div>

            {/* リスク要因 */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <div className="text-sm font-medium text-red-400 mb-2">
                ⚠️ リスク要因
              </div>
              <ul className="space-y-1">
                {analysisResult.risks.map((risk, i) => (
                  <li key={i} className="text-sm text-slate-300">
                    • {risk}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* パターンマッチ詳細 */}
          {analysisResult.patternMatches.length > 0 && (
            <div>
              <div className="text-sm font-medium text-slate-300 mb-2">
                📊 パターンマッチ詳細
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {analysisResult.patternMatches.slice(0, 6).map((match, i) => (
                  <PatternMatchCard key={i} match={match} />
                ))}
              </div>
            </div>
          )}

          {/* 異常検知 */}
          {anomalyResult && (
            <AnomalyCard result={anomalyResult} />
          )}

          {/* メタ情報 */}
          <div className="text-xs text-slate-500 flex items-center gap-4">
            <span>モデル: {analysisResult.model}</span>
            <span>トークン: {analysisResult.tokenUsage}</span>
            <span>分析日時: {new Date(analysisResult.analyzedAt).toLocaleString("ja-JP")}</span>
          </div>
        </div>
      )}

      {/* 未分析時のプレースホルダー */}
      {!analysisResult && !analyzing && (
        <div className="text-center py-8">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-slate-400 text-sm">
            「分析を実行」ボタンをクリックして、<br />
            現在の市場状況と過去の勝ちパターンを比較します
          </p>
        </div>
      )}
    </div>
  );
}

