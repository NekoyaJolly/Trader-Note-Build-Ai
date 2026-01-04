/**
 * Side-B: AI取引プランダッシュボード
 * 
 * TradeAssistant-AI の入り口ページ
 * - AIによる日次取引プラン生成
 * - 仮想トレード実行・記録
 * - AI用トレードノートによる学習ループ
 * 
 * デザイン方針:
 * - AI主体のため、AIの意思表示エリア（チャット風）がメイン
 * - フェーズカードはアイコンサイズで横並び
 * 
 * @see docs/side-b/TradeAssistant-AI.md
 */

"use client";

import { useState, useRef, useEffect } from "react";

// フェーズ定義
const phases = [
  {
    id: "research",
    icon: "🔬",
    label: "Research",
    status: "ready",
    gradient: "from-purple-500 to-violet-600",
  },
  {
    id: "plan",
    icon: "📋",
    label: "Plan",
    status: "ready",
    gradient: "from-indigo-500 to-purple-600",
  },
  {
    id: "trade",
    icon: "📊",
    label: "Trade",
    status: "planned",
    gradient: "from-blue-500 to-indigo-600",
  },
  {
    id: "note",
    icon: "📝",
    label: "Note",
    status: "planned",
    gradient: "from-cyan-500 to-blue-600",
  },
];

// チャットメッセージ型
interface ChatMessage {
  role: "ai" | "user";
  content: string;
  timestamp: Date;
}

export default function SideBDashboard() {
  // チャット状態
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "ai",
      content: "TradeAssistant-AI です。市場分析と取引プラン生成の準備ができています。\n\n現在利用可能な機能:\n• 🔬 Market Research（市場リサーチ）\n• 📋 Trade Plan Generation（取引プラン生成）\n\nどのような分析をお手伝いしましょうか？",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // メッセージ追加時に自動スクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // メッセージ送信ハンドラ
  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    // AI応答シミュレーション（実際はAPIコール）
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        role: "ai",
        content: "申し訳ありません。現在チャット機能は開発中です。\n\nAPIエンドポイントは準備ができています:\n• POST /api/side-b/research\n• POST /api/side-b/plan\n\n詳細は開発者ツールでご確認ください。",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
      setIsTyping(false);
    }, 1000);
  };

  // Enterキーで送信
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-4xl w-full mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8 md:py-12">
        {/* ヘッダー */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 sm:mb-4">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
              TradeAssistant-AI
            </span>
          </h1>
          <p className="text-xs sm:text-sm md:text-lg text-gray-400">
            AI主導の市場分析・取引プラン生成
          </p>
        </div>

        {/* フェーズアイコン（横並び） */}
        <div className="flex justify-center gap-3 sm:gap-4 md:gap-6 mb-6 sm:mb-8">
          {phases.map((phase) => (
            <button
              key={phase.id}
              className={`relative group transition-all duration-300 ${
                phase.status === "planned" ? "opacity-50 cursor-not-allowed" : "hover:scale-110"
              }`}
              disabled={phase.status === "planned"}
              title={phase.label}
            >
              {/* アイコン */}
              <div
                className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 bg-gradient-to-br ${phase.gradient} rounded-lg flex items-center justify-center text-white text-lg sm:text-xl md:text-2xl shadow-lg`}
              >
                {phase.icon}
              </div>
              {/* ラベル */}
              <span className="block text-[10px] sm:text-xs text-gray-400 mt-1 text-center">
                {phase.label}
              </span>
              {/* ステータスバッジ */}
              {phase.status === "ready" && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-slate-900" />
              )}
            </button>
          ))}
        </div>

        {/* AIチャットエリア（カード3枚分の高さ） */}
        <div className="card-surface rounded-xl overflow-hidden" style={{ minHeight: "420px" }}>
          {/* チャットヘッダー */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-800/50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white text-sm">🤖</span>
            </div>
            <div>
              <p className="text-sm font-medium text-white">TradeAssistant-AI</p>
              <p className="text-xs text-gray-400">
                {isTyping ? "入力中..." : "オンライン"}
              </p>
            </div>
          </div>

          {/* メッセージエリア */}
          <div className="h-72 sm:h-80 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-purple-600 text-white"
                      : "bg-slate-700 text-gray-200"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-[10px] mt-1 opacity-60">
                    {msg.timestamp.toLocaleTimeString("ja-JP", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-slate-700 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 入力エリア */}
          <div className="px-4 py-3 border-t border-slate-700 bg-slate-800/30">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力..."
                className="flex-1 bg-slate-700 text-white text-sm rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-400"
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isTyping}
                className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-transform"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="text-center mt-6 sm:mt-8 text-xs sm:text-sm text-gray-500">
          <p>TradeAssistant-AI • Side-B</p>
        </div>
      </main>
    </div>
  );
}
