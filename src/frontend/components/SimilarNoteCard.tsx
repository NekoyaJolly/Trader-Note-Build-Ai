/**
 * SimilarNoteCard コンポーネント
 * 
 * 機能:
 * - 類似トレードノートのカード表示
 * - 類似度スコア (%) 表示
 * - ノート詳細へのリンク
 * - ダークモード対応 (Neon Dark テーマ)
 */
"use client";

import React from "react";
import Link from "next/link";
import ScoreGauge from "./ScoreGauge";
import { Badge } from "./ui/Badge";

// 類似ノートデータの型定義
export interface SimilarNote {
  /** ノート ID */
  id: string;
  /** 通貨ペア */
  symbol: string;
  /** 売買方向 */
  side: "buy" | "sell" | "BUY" | "SELL";
  /** 類似度スコア (0-100) */
  similarity: number;
  /** エントリー日時 */
  timestamp: string;
  /** AI 要約（短縮版） */
  summarySnippet?: string;
  /** トレード結果 (オプション - pending は未決済) */
  result?: "win" | "loss" | "breakeven" | "pending";
}

export interface SimilarNoteCardProps {
  /** 類似ノートデータ */
  note: SimilarNote;
  /** 追加の CSS クラス */
  className?: string;
}

/**
 * トレード結果バッジ
 */
function ResultBadge({ result }: { result?: "win" | "loss" | "breakeven" | "pending" }) {
  if (!result || result === "pending") return null;

  const config = {
    win: { label: "勝ち", className: "bg-green-500/20 text-green-400 border-green-500/30" },
    loss: { label: "負け", className: "bg-red-500/20 text-red-400 border-red-500/30" },
    breakeven: { label: "同値", className: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
  };

  const { label, className } = config[result];

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${className}`}>
      {label}
    </span>
  );
}

/**
 * SimilarNoteCard コンポーネント
 * 
 * 類似トレードノートをカード形式で表示
 * - 類似度スコアを視覚的に表示
 * - 銘柄、方向、結果を一覧表示
 * - クリックでノート詳細へ遷移
 */
export default function SimilarNoteCard({ note, className = "" }: SimilarNoteCardProps) {
  const sideNormalized = note.side.toUpperCase() as "BUY" | "SELL";
  
  return (
    <Link
      href={`/notes/${note.id}`}
      className={`block group ${className}`}
    >
      <div className="card-surface rounded-xl p-4 transition-all duration-300 hover:border-slate-600 hover:shadow-[0_0_20px_rgba(139,92,246,0.15)]">
        <div className="flex items-start gap-4">
          {/* 類似度スコア */}
          <div className="flex-shrink-0">
            <ScoreGauge score={note.similarity} size="small" />
          </div>
          
          {/* ノート情報 */}
          <div className="flex-1 min-w-0">
            {/* ヘッダー行: 銘柄 + 方向 + 結果 */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-white">{note.symbol}</span>
              <Badge variant={sideNormalized === "BUY" ? "secondary" : "destructive"}>
                {sideNormalized}
              </Badge>
              <ResultBadge result={note.result} />
            </div>
            
            {/* 日時 */}
            <div className="text-sm text-gray-400 mb-2">
              {new Date(note.timestamp).toLocaleString("ja-JP", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            
            {/* AI 要約スニペット */}
            {note.summarySnippet && (
              <p className="text-sm text-gray-300 line-clamp-2">
                {note.summarySnippet}
              </p>
            )}
          </div>
          
          {/* 矢印アイコン（ホバーで表示） */}
          <div className="flex-shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity">
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
        </div>
        
        {/* 類似度表示テキスト */}
        <div className="mt-3 pt-3 border-t border-slate-700">
          <span className="text-xs text-gray-500">
            類似度: <span className="text-violet-400 font-medium">{note.similarity}%</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
