/**
 * SymbolSelector コンポーネント
 * 
 * 機能:
 * - 銘柄（通貨ペア）の選択ドロップダウン
 * - 検索機能（オプション）
 * - ダークモード対応 (Neon Dark テーマ)
 */
"use client";

import React, { useState, useRef, useEffect } from "react";

// 銘柄データの型定義
export interface Symbol {
  /** 銘柄コード (例: "USD/JPY") */
  code: string;
  /** 表示名（オプション） */
  name?: string;
  /** カテゴリ（オプション: forex, crypto, stock） */
  category?: "forex" | "crypto" | "stock" | "other";
}

export interface SymbolSelectorProps {
  /** 利用可能な銘柄リスト */
  symbols: Symbol[];
  /** 選択中の銘柄コード */
  value: string | null;
  /** 選択変更時のコールバック */
  onChange: (symbol: string) => void;
  /** プレースホルダーテキスト */
  placeholder?: string;
  /** 検索機能を有効化 */
  searchable?: boolean;
  /** 無効状態 */
  disabled?: boolean;
  /** 追加の CSS クラス */
  className?: string;
}

/**
 * SymbolSelector コンポーネント
 * 
 * 銘柄選択用のカスタムドロップダウン
 */
export default function SymbolSelector({
  symbols,
  value,
  onChange,
  placeholder = "銘柄を選択...",
  searchable = true,
  disabled = false,
  className = "",
}: SymbolSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 選択中の銘柄情報
  const selectedSymbol = symbols.find((s) => s.code === value);

  // フィルタリングされた銘柄リスト
  const filteredSymbols = searchable && searchQuery
    ? symbols.filter((s) =>
        s.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : symbols;

  // 外側クリックでドロップダウンを閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ドロップダウンを開いたときに検索入力にフォーカス
  useEffect(() => {
    if (isOpen && searchable && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, searchable]);

  // 銘柄選択時の処理
  function handleSelect(symbolCode: string) {
    onChange(symbolCode);
    setIsOpen(false);
    setSearchQuery("");
  }

  // カテゴリアイコン取得
  function getCategoryIcon(category?: string) {
    switch (category) {
      case "forex":
        return "💱";
      case "crypto":
        return "₿";
      case "stock":
        return "📈";
      default:
        return "📊";
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* トリガーボタン */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-2
          px-4 py-2.5 rounded-lg border
          bg-slate-800 border-slate-700
          text-left transition-all duration-300
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-slate-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"}
          ${isOpen ? "border-violet-500 ring-2 ring-violet-500/20" : ""}
        `}
      >
        <span className={selectedSymbol ? "text-white" : "text-gray-400"}>
          {selectedSymbol ? (
            <span className="flex items-center gap-2">
              <span>{getCategoryIcon(selectedSymbol.category)}</span>
              <span className="font-medium">{selectedSymbol.code}</span>
              {selectedSymbol.name && (
                <span className="text-gray-400 text-sm">({selectedSymbol.name})</span>
              )}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ドロップダウンメニュー */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 py-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl">
          {/* 検索入力 */}
          {searchable && (
            <div className="px-3 pb-2 border-b border-slate-700">
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="検索..."
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-400 text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
          )}

          {/* 銘柄リスト */}
          <div className="max-h-60 overflow-y-auto">
            {filteredSymbols.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">
                該当する銘柄がありません
              </div>
            ) : (
              filteredSymbols.map((symbol) => (
                <button
                  key={symbol.code}
                  type="button"
                  onClick={() => handleSelect(symbol.code)}
                  className={`
                    w-full flex items-center gap-2 px-4 py-2.5 text-left
                    transition-colors duration-150
                    ${symbol.code === value
                      ? "bg-violet-500/20 text-violet-400"
                      : "text-gray-300 hover:bg-slate-700"
                    }
                  `}
                >
                  <span className="text-lg">{getCategoryIcon(symbol.category)}</span>
                  <div>
                    <span className="font-medium">{symbol.code}</span>
                    {symbol.name && (
                      <span className="text-gray-400 text-sm ml-2">({symbol.name})</span>
                    )}
                  </div>
                  {symbol.code === value && (
                    <svg className="w-4 h-4 ml-auto text-violet-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
