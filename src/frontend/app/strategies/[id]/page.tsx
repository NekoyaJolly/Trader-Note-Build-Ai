/**
 * ストラテジー詳細ページ（編集モード統合版）
 * 
 * 目的:
 * - ストラテジーの詳細情報を表示
 * - インライン編集モードで直接編集
 * - バージョン履歴の閲覧
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchStrategy,
  deleteStrategy,
  updateStrategyStatus,
  duplicateStrategy,
  updateStrategy,
  rollbackStrategyVersion,
  fetchIndicatorMetadata,
} from "@/lib/api";
import {
  COMPARISON_OPERATOR_INFO,
  LOGICAL_OPERATOR_INFO,
  isIndicatorCondition,
  isPatternCondition,
} from "@/types/strategy";
import type { Strategy, StrategyStatus, ConditionGroup, IndicatorCondition, PatternCondition, ExitSettings, StrategyDirection, SupportedSymbol, UpdateStrategyRequest, CandlePatternId, PatternOperator } from "@/types/strategy";
import type { IndicatorMetadata } from "@/types/indicator";
import ConditionBuilder from "@/components/strategy/ConditionBuilder";
import { NeonButton } from "@/components/ui/NeonButton";

// ============================================
// 条件表示用サブコンポーネント
// ============================================

/** 単一条件を表示（コンパクト版） */
function ConditionDisplay({ condition }: { condition: IndicatorCondition }) {
  const fieldLabels: Record<string, string> = {
    value: "",
    macd: ".MACD",
    signal: ".Sig",
    histogram: ".Hist",
    upper: ".上",
    middle: ".中",
    lower: ".下",
    k: ".%K",
    d: ".%D",
    tenkan: ".転換",
    kijun: ".基準",
    senkouA: ".先A",
    senkouB: ".先B",
    chikou: ".遅行",
  };

  let compareTargetDisplay = "";
  if (condition.compareTarget.type === "fixed") {
    compareTargetDisplay = String(condition.compareTarget.value);
  } else if (condition.compareTarget.type === "indicator") {
    const params = condition.compareTarget.params
      ? `(${Object.values(condition.compareTarget.params).join(",")})`
      : "";
    compareTargetDisplay = `${condition.compareTarget.indicatorId}${params}`;
  } else if (condition.compareTarget.type === "price") {
    compareTargetDisplay = condition.compareTarget.priceType || "close";
  }

  const field = condition.field !== "value" ? fieldLabels[condition.field] || `.${condition.field}` : "";
  const params = condition.params ? `(${Object.values(condition.params).join(",")})` : "";
  const operatorLabel = COMPARISON_OPERATOR_INFO[condition.operator]?.label || condition.operator;

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-cyan-400">{condition.indicatorId.toUpperCase()}</span>
      <span className="text-gray-500">{params}</span>
      <span className="text-purple-400">{field}</span>
      <span className="text-yellow-400 mx-0.5">{operatorLabel}</span>
      <span className="text-green-400">{compareTargetDisplay}</span>
    </span>
  );
}

function PatternConditionDisplay({ condition }: { condition: PatternCondition }) {
  const patternLabels: Record<CandlePatternId, string> = {
    pinbar: 'スパイク（上下どちらでも）',
    pinbar_bear: 'スパイクハイ（上ヒゲ）',
    pinbar_bull: 'スパイクロー（下ヒゲ）',
    hammer: 'ハンマー（下ヒゲ）',
    hammer_bull: 'ハンマー（陽線）',
    hammer_bear: 'ハンマー（陰線）',
    shooting_star: 'シューティングスター',
    engulfing_bull: '包み足（強気）',
    engulfing_bear: '包み足（弱気）',
    doji: 'ドージ',
    thrust_bull: 'スラスト（陽線）',
    thrust_bear: 'スラスト（陰線）',
  };

  const opLabels: Record<PatternOperator, string> = {
    is_true: '出現した',
    is_false: '出現していない',
  };

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-purple-300">パターン</span>
      <span className="text-cyan-400">{patternLabels[condition.patternId] ?? condition.patternId}</span>
      <span className="text-yellow-400 mx-0.5">{opLabels[condition.operator] ?? condition.operator}</span>
    </span>
  );
}

/** 条件グループを再帰的に表示（コンパクト版） */
function ConditionGroupDisplay({ group, depth = 0 }: { group: ConditionGroup; depth?: number }) {
  const operatorLabel = LOGICAL_OPERATOR_INFO[group.operator]?.label || group.operator;
  const operatorColor = group.operator === "AND" ? "text-blue-400" : group.operator === "OR" ? "text-orange-400" : "text-red-400";

  return (
    <div className={`${depth > 0 ? "ml-3 pl-2 border-l border-slate-600" : ""}`}>
      <div className="space-y-1">
        {group.conditions.map((item, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1">
            {isIndicatorCondition(item) ? (
              <div className="bg-slate-700/50 px-2 py-1 rounded">
                <ConditionDisplay condition={item as IndicatorCondition} />
              </div>
            ) : isPatternCondition(item) ? (
              <div className="bg-slate-700/50 px-2 py-1 rounded">
                <PatternConditionDisplay condition={item as PatternCondition} />
              </div>
            ) : (
              <ConditionGroupDisplay group={item as ConditionGroup} depth={depth + 1} />
            )}
            {index < group.conditions.length - 1 && (
              <span className={`text-[10px] ${operatorColor} px-1`}>{operatorLabel}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// アクションメニューコンポーネント
// ============================================

interface ActionMenuProps {
  strategy: Strategy;
  onStatusChange: (status: StrategyStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ActionMenu({ strategy, onStatusChange, onDuplicate, onDelete }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-600 bg-slate-800/80 text-gray-300 hover:border-cyan-500/50 hover:text-cyan-400 transition-all"
      >
        <span>アクション</span>
        <svg className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-40 bg-slate-800 border border-slate-600 rounded-lg shadow-lg shadow-black/30 z-50 overflow-hidden">
          {/* 編集 */}
          <Link
            href={`/strategies/${strategy.id}/edit`}
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-cyan-500/10 hover:text-cyan-400 transition-colors"
            onClick={() => setIsOpen(false)}
          >
            <span className="w-4 text-center">✏️</span>
            <span>編集</span>
          </Link>

          {/* バックテスト */}
          <Link
            href={`/strategies/${strategy.id}/backtest`}
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-purple-500/10 hover:text-purple-400 transition-colors"
            onClick={() => setIsOpen(false)}
          >
            <span className="w-4 text-center">📊</span>
            <span>バックテスト</span>
          </Link>

          {/* 複製 */}
          <button
            onClick={() => { onDuplicate(); setIsOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-slate-700 transition-colors"
          >
            <span className="w-4 text-center">📋</span>
            <span>複製</span>
          </button>

          <div className="border-t border-slate-700 my-1" />

          {/* ステータス変更 */}
          {strategy.status !== "active" && (
            <button
              onClick={() => { onStatusChange("active"); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-green-500/10 hover:text-green-400 transition-colors"
            >
              <span className="w-4 text-center">✅</span>
              <span>アクティブにする</span>
            </button>
          )}
          {strategy.status !== "draft" && strategy.status !== "archived" && (
            <button
              onClick={() => { onStatusChange("draft"); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-yellow-500/10 hover:text-yellow-400 transition-colors"
            >
              <span className="w-4 text-center">📝</span>
              <span>下書きに戻す</span>
            </button>
          )}
          {strategy.status !== "archived" && (
            <button
              onClick={() => { onStatusChange("archived"); setIsOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-orange-500/10 hover:text-orange-400 transition-colors"
            >
              <span className="w-4 text-center">📦</span>
              <span>アーカイブ</span>
            </button>
          )}

          <div className="border-t border-slate-700 my-1" />

          {/* 削除 */}
          <button
            onClick={() => { onDelete(); setIsOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <span className="w-4 text-center">🗑️</span>
            <span>削除</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================
// 定数
// ============================================

const SUPPORTED_SYMBOLS: SupportedSymbol[] = [
  'USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY',
  'EURUSD', 'GBPUSD', 'AUDUSD', 'XAUUSD',
];

// ============================================
// メインコンポーネント
// ============================================

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const strategyId = params.id as string;

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 編集モード状態
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [indicatorMetadata, setIndicatorMetadata] = useState<IndicatorMetadata[]>([]);
  
  // 編集用フォーム状態
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSymbol, setEditSymbol] = useState<SupportedSymbol>("USDJPY");
  const [editSide, setEditSide] = useState<StrategyDirection>("buy");
  const [editEntryConditions, setEditEntryConditions] = useState<ConditionGroup | null>(null);
  const [editExitSettings, setEditExitSettings] = useState<ExitSettings | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [changeNote, setChangeNote] = useState("");

  // ストラテジー取得
  useEffect(() => {
    const loadStrategy = async () => {
      try {
        setIsLoading(true);
        const data = await fetchStrategy(strategyId);
        setStrategy(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "データの取得に失敗しました";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };
    loadStrategy();
  }, [strategyId]);

  // インジケーターメタデータ取得（編集モード用）
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        const data = await fetchIndicatorMetadata();
        setIndicatorMetadata(data.indicators);
      } catch (err) {
        console.error("インジケーターメタデータの取得に失敗:", err);
      }
    };
    loadMetadata();
  }, []);

  // 編集モード開始
  const startEditMode = () => {
    if (!strategy) return;
    setEditName(strategy.name);
    setEditDescription(strategy.description || "");
    setEditSymbol(strategy.symbol as SupportedSymbol);
    setEditSide(strategy.side);
    setEditEntryConditions(strategy.currentVersion?.entryConditions as ConditionGroup || null);
    setEditExitSettings(strategy.currentVersion?.exitSettings as ExitSettings || null);
    setEditTags(strategy.tags || []);
    setChangeNote("");
    setIsEditMode(true);
  };

  // 編集モードキャンセル
  const cancelEditMode = () => {
    setIsEditMode(false);
    setChangeNote("");
  };

  // 保存処理
  const handleSave = async () => {
    if (!strategy || !editEntryConditions || !editExitSettings) return;
    
    if (!editName.trim()) {
      alert("ストラテジー名を入力してください");
      return;
    }

    setIsSaving(true);
    try {
      const request: UpdateStrategyRequest = {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        symbol: editSymbol,
        side: editSide,
        entryConditions: editEntryConditions,
        exitSettings: editExitSettings,
        tags: editTags,
        changeNote: changeNote.trim() || undefined,
      };
      const updated = await updateStrategy(strategy.id, request);
      setStrategy(updated);
      setIsEditMode(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存に失敗しました";
      alert(message);
    } finally {
      setIsSaving(false);
    }
  };

  // バージョンをロールバック（表示モード専用）
  const handleRollback = async (versionNumber: number) => {
    if (!strategy) return;
    if (!confirm(`v${versionNumber} にロールバックしますか？（履歴として新バージョンが作成されます）`)) {
      return;
    }

    setIsSaving(true);
    try {
      const updated = await rollbackStrategyVersion(strategy.id, versionNumber);
      setStrategy(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ロールバックに失敗しました';
      alert(message);
    } finally {
      setIsSaving(false);
    }
  };

  // タグ追加
  const handleAddTag = () => {
    const trimmed = editTagInput.trim();
    if (trimmed && !editTags.includes(trimmed)) {
      setEditTags([...editTags, trimmed]);
      setEditTagInput("");
    }
  };

  // タグ削除
  const handleRemoveTag = (tagToRemove: string) => {
    setEditTags(editTags.filter(t => t !== tagToRemove));
  };

  // 削除処理
  const handleDelete = async () => {
    if (!confirm("このストラテジーを削除しますか？この操作は取り消せません。")) {
      return;
    }
    try {
      await deleteStrategy(strategyId);
      router.push("/strategies");
    } catch (err) {
      const message = err instanceof Error ? err.message : "削除に失敗しました";
      alert(message);
    }
  };

  // ステータス変更処理
  const handleStatusChange = async (status: StrategyStatus) => {
    try {
      const updated = await updateStrategyStatus(strategyId, status);
      setStrategy(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : "ステータス変更に失敗しました";
      alert(message);
    }
  };

  // 複製処理
  const handleDuplicate = async () => {
    try {
      const duplicated = await duplicateStrategy(strategyId);
      router.push(`/strategies/${duplicated.id}/edit`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "複製に失敗しました";
      alert(message);
    }
  };

  // ステータスバッジ
  const statusConfig: Record<StrategyStatus, { color: string; glow: string; label: string }> = {
    draft: { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", glow: "", label: "下書き" },
    active: { color: "bg-green-500/20 text-green-400 border-green-500/30", glow: "shadow-green-500/20 shadow-sm", label: "アクティブ" },
    archived: { color: "bg-gray-500/20 text-gray-400 border-gray-500/30", glow: "", label: "アーカイブ" },
  };

  // 日付フォーマット
  const formatDateTime = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleString("ja-JP", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  // ローディング
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500"></div>
        <span className="ml-2 text-xs text-gray-400">読み込み中...</span>
      </div>
    );
  }

  // エラー
  if (error || !strategy) {
    return (
      <div className="text-center py-8">
        <div className="text-red-400 text-sm mb-3">{error || "ストラテジーが見つかりません"}</div>
        <Link href="/strategies" className="text-cyan-400 hover:text-cyan-300 text-xs">
          ← 一覧に戻る
        </Link>
      </div>
    );
  }

  const currentVersion = strategy.currentVersion;
  const exitSettings = currentVersion?.exitSettings as {
    takeProfit: { value: number; unit: string };
    stopLoss: { value: number; unit: string };
    maxHoldingMinutes?: number;
  } | null;

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {/* パンくず */}
      <nav className="mb-3 sm:mb-4">
        <ol className="flex items-center gap-1.5 text-xs text-gray-500">
          <li><Link href="/strategies" className="hover:text-cyan-400 transition-colors">ストラテジー</Link></li>
          <li>/</li>
          <li className="text-gray-300 truncate max-w-[150px] sm:max-w-[200px]">
            {isEditMode ? "編集中" : strategy.name}
          </li>
        </ol>
      </nav>

      {/* ヘッダーカード */}
      <div className="card-surface p-3 sm:p-4 mb-3 sm:mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {isEditMode ? (
              /* 編集モード: 名前 + シンボル + サイドを1行に */
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 min-w-[120px] text-sm font-bold bg-slate-800/50 text-white rounded px-2 py-0.5 border border-slate-600 focus:border-purple-500 focus:outline-none"
                  placeholder="ストラテジー名"
                />
                <select
                  value={editSymbol}
                  onChange={(e) => setEditSymbol(e.target.value as SupportedSymbol)}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800/50 text-cyan-400 border border-slate-600 focus:border-purple-500 focus:outline-none"
                >
                  {SUPPORTED_SYMBOLS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  value={editSide}
                  onChange={(e) => setEditSide(e.target.value as StrategyDirection)}
                  className={`px-1.5 py-0.5 text-[10px] rounded bg-slate-800/50 border border-slate-600 focus:border-purple-500 focus:outline-none ${editSide === 'buy' ? 'text-green-400' : editSide === 'sell' ? 'text-red-400' : 'text-amber-400'}`}
                >
                  <option value="buy">買い</option>
                  <option value="sell">売り</option>
                  <option value="both">両建て</option>
                </select>
              </div>
            ) : (
              /* 表示モード: タイトル行 */
              <>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-base sm:text-lg font-bold text-white truncate">{strategy.name}</h1>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded border ${statusConfig[strategy.status].color} ${statusConfig[strategy.status].glow}`}>
                    {statusConfig[strategy.status].label}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-mono text-cyan-400">{strategy.symbol}</span>
                  <span className={strategy.side === "buy" ? "text-green-400" : strategy.side === "sell" ? "text-red-400" : "text-amber-400"}>
                    {strategy.side === "buy" ? "買い" : strategy.side === "sell" ? "売り" : "両建て"}
                  </span>
                  {currentVersion && (
                    <span className="text-gray-500">v{currentVersion.versionNumber}</span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* アクションメニュー（表示モードのみ） */}
          {!isEditMode && (
            <ActionMenu
              strategy={strategy}
              onStatusChange={handleStatusChange}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          )}
        </div>

        {/* 説明 + タグ（編集モード: 1行にまとめる） */}
        {isEditMode ? (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="flex-1 px-2 py-0.5 text-[10px] bg-slate-800/50 text-gray-300 rounded border border-slate-600 focus:border-purple-500 focus:outline-none"
              placeholder="説明（任意）"
            />
            <div className="flex items-center gap-1">
              {editTags.slice(0, 3).map((tag) => (
                <span key={tag} className="px-1 py-0.5 bg-slate-700/50 text-[10px] text-gray-400 rounded flex items-center gap-0.5">
                  {tag}
                  <button onClick={() => handleRemoveTag(tag)} className="text-red-400 hover:text-red-300 text-[8px]">×</button>
                </span>
              ))}
              {editTags.length > 3 && <span className="text-[10px] text-gray-500">+{editTags.length - 3}</span>}
              <input
                type="text"
                value={editTagInput}
                onChange={(e) => setEditTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                className="w-16 px-1 py-0.5 text-[10px] bg-slate-800/50 text-gray-300 rounded border border-slate-600 focus:border-purple-500 focus:outline-none"
                placeholder="+タグ"
              />
            </div>
          </div>
        ) : (
          <>
            {strategy.description && (
              <p className="mt-2 text-xs text-gray-400 line-clamp-2">{strategy.description}</p>
            )}
            {strategy.tags && strategy.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {strategy.tags.map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 bg-slate-700/50 text-[10px] text-gray-400 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* クイックアクション / 編集モードボタン */}
      <div className="flex gap-2 mb-3 sm:mb-4">
        {isEditMode ? (
          <>
            <NeonButton
              onClick={handleSave}
              color="green"
              size="sm"
              disabled={isSaving}
              className="flex-1"
            >
              {isSaving ? "保存中..." : "💾 保存"}
            </NeonButton>
            <NeonButton
              onClick={cancelEditMode}
              color="slate"
              size="sm"
              variant="outline"
              className="flex-1"
            >
              キャンセル
            </NeonButton>
          </>
        ) : (
          <>
            <Link
              href={`/strategies/${strategy.id}/backtest`}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-gradient-to-r from-purple-600/20 to-cyan-600/20 border border-purple-500/30 text-purple-300 hover:border-purple-400/50 hover:text-purple-200 transition-all"
            >
              <span>📊</span>
              <span>バックテスト</span>
            </Link>
            <button
              onClick={startEditMode}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/30 text-cyan-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-all"
            >
              <span>✏️</span>
              <span>編集</span>
            </button>
          </>
        )}
      </div>

      {/* エントリー条件 */}
      <div className="card-surface p-3 sm:p-4 mb-3 sm:mb-4">
        <h2 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
          <span className="text-cyan-400">▸</span>
          エントリー条件
        </h2>
        {isEditMode && editEntryConditions ? (
          <ConditionBuilder
            value={editEntryConditions}
            onChange={setEditEntryConditions}
            indicatorMetadata={indicatorMetadata}
            compact={true}
          />
        ) : currentVersion ? (
          <ConditionGroupDisplay group={currentVersion.entryConditions as ConditionGroup} />
        ) : (
          <p className="text-xs text-gray-500">条件が設定されていません</p>
        )}
      </div>

      {/* イグジット設定 */}
      <div className="card-surface p-3 sm:p-4 mb-3 sm:mb-4">
        <h2 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
          <span className="text-cyan-400">▸</span>
          イグジット設定
        </h2>
        {isEditMode && editExitSettings ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-700/30 px-2 py-1 rounded text-center">
              <div className="text-[10px] text-gray-500">TP</div>
              <div className="flex items-center gap-0.5 justify-center">
                <input
                  type="number"
                  value={editExitSettings.takeProfit.value}
                  onChange={(e) => setEditExitSettings({
                    ...editExitSettings,
                    takeProfit: { ...editExitSettings.takeProfit, value: parseFloat(e.target.value) || 0 }
                  })}
                  className="w-12 px-1 py-0.5 text-xs bg-slate-800/50 text-green-400 rounded border border-slate-600 focus:border-green-500 focus:outline-none text-center"
                  step="0.1"
                />
                <select
                  value={editExitSettings.takeProfit.unit}
                  onChange={(e) => setEditExitSettings({
                    ...editExitSettings,
                    takeProfit: { ...editExitSettings.takeProfit, unit: e.target.value as 'percent' | 'pips' }
                  })}
                  className="px-0.5 py-0.5 text-[10px] bg-slate-800/50 text-gray-400 rounded border border-slate-600"
                >
                  <option value="percent">%</option>
                  <option value="pips">p</option>
                </select>
              </div>
            </div>
            <div className="bg-slate-700/30 px-2 py-1 rounded text-center">
              <div className="text-[10px] text-gray-500">SL</div>
              <div className="flex items-center gap-0.5 justify-center">
                <input
                  type="number"
                  value={editExitSettings.stopLoss.value}
                  onChange={(e) => setEditExitSettings({
                    ...editExitSettings,
                    stopLoss: { ...editExitSettings.stopLoss, value: parseFloat(e.target.value) || 0 }
                  })}
                  className="w-12 px-1 py-0.5 text-xs bg-slate-800/50 text-red-400 rounded border border-slate-600 focus:border-red-500 focus:outline-none text-center"
                  step="0.1"
                />
                <select
                  value={editExitSettings.stopLoss.unit}
                  onChange={(e) => setEditExitSettings({
                    ...editExitSettings,
                    stopLoss: { ...editExitSettings.stopLoss, unit: e.target.value as 'percent' | 'pips' }
                  })}
                  className="px-0.5 py-0.5 text-[10px] bg-slate-800/50 text-gray-400 rounded border border-slate-600"
                >
                  <option value="percent">%</option>
                  <option value="pips">p</option>
                </select>
              </div>
            </div>
            <div className="bg-slate-700/30 px-2 py-1 rounded text-center">
              <div className="text-[10px] text-gray-500">保有</div>
              <input
                type="number"
                value={editExitSettings.maxHoldingMinutes || ""}
                onChange={(e) => setEditExitSettings({
                  ...editExitSettings,
                  maxHoldingMinutes: e.target.value ? parseInt(e.target.value) : undefined
                })}
                className="w-full px-1 py-0.5 text-xs bg-slate-800/50 text-gray-300 rounded border border-slate-600 focus:border-purple-500 focus:outline-none"
                placeholder="∞"
              />
            </div>
          </div>
        ) : exitSettings ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-700/30 px-2 py-1.5 rounded text-center">
              <div className="text-[10px] text-gray-500">TP</div>
              <div className="text-sm font-mono text-green-400">
                {exitSettings.takeProfit.value}{exitSettings.takeProfit.unit === "percent" ? "%" : "p"}
              </div>
            </div>
            <div className="bg-slate-700/30 px-2 py-1.5 rounded text-center">
              <div className="text-[10px] text-gray-500">SL</div>
              <div className="text-sm font-mono text-red-400">
                {exitSettings.stopLoss.value}{exitSettings.stopLoss.unit === "percent" ? "%" : "p"}
              </div>
            </div>
            <div className="bg-slate-700/30 px-2 py-1.5 rounded text-center">
              <div className="text-[10px] text-gray-500">保有</div>
              <div className="text-sm font-mono text-gray-300">
                {exitSettings.maxHoldingMinutes ? `${exitSettings.maxHoldingMinutes}m` : "∞"}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">設定されていません</p>
        )}
      </div>

      {/* 編集モード: 変更メモ */}
      {isEditMode && (
        <div className="card-surface p-3 sm:p-4 mb-3 sm:mb-4">
          <h2 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
            <span className="text-cyan-400">▸</span>
            変更メモ（任意）
          </h2>
          <input
            type="text"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-slate-800/50 text-gray-300 rounded border border-slate-600 focus:border-purple-500 focus:outline-none"
            placeholder="この変更について一言..."
          />
        </div>
      )}

      {/* バージョン履歴（表示モードのみ） */}
      {!isEditMode && strategy.versions && strategy.versions.length > 0 && (
        <div className="card-surface p-3 sm:p-4 mb-3 sm:mb-4">
          <h2 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
            <span className="text-cyan-400">▸</span>
            バージョン履歴
          </h2>
          <div className="space-y-1">
            {strategy.versions.slice(0, 5).map((version) => (
              <div
                key={version.id}
                className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${
                  version.versionNumber === currentVersion?.versionNumber
                    ? "bg-cyan-500/10 border border-cyan-500/30"
                    : "bg-slate-700/30"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-gray-300">v{version.versionNumber}</span>
                  <span className="text-gray-500 text-[10px]">{formatDateTime(version.createdAt)}</span>
                  {version.changeNote && (
                    <span className="text-gray-400 truncate">{version.changeNote}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {version.versionNumber === currentVersion?.versionNumber ? (
                    <span className="px-1.5 py-0.5 bg-cyan-500/20 text-[10px] text-cyan-400 rounded">現在</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRollback(version.versionNumber)}
                      className="px-2 py-0.5 text-[10px] rounded bg-slate-800/50 border border-slate-600 text-gray-300 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors"
                      disabled={isSaving}
                    >
                      復元
                    </button>
                  )}
                </div>
              </div>
            ))}
            {strategy.versions.length > 5 && (
              <div className="text-center text-[10px] text-gray-500 pt-1">
                他 {strategy.versions.length - 5} バージョン
              </div>
            )}
          </div>
        </div>
      )}

      {/* メタ情報（表示モードのみ） */}
      {!isEditMode && (
        <div className="card-surface p-3 sm:p-4">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>作成: {formatDateTime(strategy.createdAt)}</span>
            <span>更新: {formatDateTime(strategy.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
