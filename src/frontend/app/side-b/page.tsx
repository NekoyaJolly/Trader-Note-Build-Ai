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
import Link from "next/link";

// フェーズ定義
// status: ready = 実装済み, planned = 開発中
const phases = [
  {
    id: "research",
    icon: "🔬",
    label: "Research",
    status: "ready",
    gradient: "from-purple-500 to-violet-600",
    href: null, // チャットから実行
  },
  {
    id: "plan",
    icon: "📋",
    label: "Plan",
    status: "ready",
    gradient: "from-indigo-500 to-purple-600",
    href: null, // チャットから実行
  },
  {
    id: "trade",
    icon: "📊",
    label: "Trade",
    status: "ready", // Phase B 実装完了！
    gradient: "from-blue-500 to-indigo-600",
    href: "/side-b/trades",
  },
  {
    id: "note",
    icon: "📝",
    label: "Note",
    status: "ready", // Phase C 実装完了！
    gradient: "from-cyan-500 to-blue-600",
    href: "/side-b/ai-notes",
  },
  {
    id: "settings",
    icon: "⚙️",
    label: "Settings",
    status: "ready", // Phase D スケジューラー設定
    gradient: "from-slate-500 to-slate-600",
    href: "/side-b/settings",
  },
];

// チャットメッセージ型
interface ChatMessage {
  role: "ai" | "user";
  content: string;
  timestamp: Date;
  data?: unknown; // API レスポンスデータ（オプション）
}

// APIベースURL（同一オリジン: 相対パス）
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "") + "/api/side-b";

// ユーザー入力からシンボルと意図を解析
function parseUserIntent(message: string): {
  intent: "research" | "plan" | "unknown";
  symbol: string | null;
  timeframe: string;
} {
  const msg = message.toLowerCase();

  // シンボル検出（よく使われる通貨ペアや商品）
  const symbolPatterns = [
    /xauusd|gold|ゴールド|金/i,
    /eurusd|eur\/usd|ユーロドル/i,
    /usdjpy|usd\/jpy|ドル円/i,
    /gbpusd|gbp\/usd|ポンドドル/i,
  ];

  let symbol: string | null = null;
  if (symbolPatterns[0].test(msg)) symbol = "XAU/USD";
  else if (symbolPatterns[1].test(msg)) symbol = "EUR/USD";
  else if (symbolPatterns[2].test(msg)) symbol = "USD/JPY";
  else if (symbolPatterns[3].test(msg)) symbol = "GBP/USD";

  // デフォルトシンボル（指定がない場合）
  if (!symbol) symbol = "XAU/USD";

  // 時間足検出
  let timeframe = "15m";
  if (/1h|1時間|hourly/i.test(msg)) timeframe = "1h";
  else if (/4h|4時間/i.test(msg)) timeframe = "4h";
  else if (/5m|5分/i.test(msg)) timeframe = "5m";
  else if (/30m|30分/i.test(msg)) timeframe = "30m";
  else if (/daily|日足|1d/i.test(msg)) timeframe = "1d";

  // 意図検出
  let intent: "research" | "plan" | "unknown" = "unknown";
  if (/research|リサーチ|分析|調査|市場|マーケット/i.test(msg)) {
    intent = "research";
  } else if (/plan|プラン|計画|戦略|エントリー|トレード/i.test(msg)) {
    intent = "plan";
  } else if (/xauusd|eurusd|usdjpy|gbpusd|gold|ゴールド|ドル|ユーロ|ポンド/i.test(msg)) {
    // シンボルが含まれていればリサーチと推定
    intent = "research";
  }

  return { intent, symbol, timeframe };
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
    const userInput = inputValue;
    setInputValue("");
    setIsTyping(true);

    try {
      // ユーザー意図を解析
      const { intent, symbol, timeframe } = parseUserIntent(userInput);

      let aiResponse: ChatMessage;

      if (intent === "research") {
        // Research API 呼び出し
        const response = await fetch(`${API_BASE}/research`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, timeframe }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "リサーチ生成に失敗しました");
        }

        // リサーチ結果をフォーマット
        const research = data.research;
        const content = `🔬 **${symbol} マーケットリサーチ**\n\n` +
          `📊 **市場状況**: ${research?.analysis?.marketCondition || "分析中"}\n` +
          `📈 **トレンド**: ${research?.analysis?.trend || "不明"}\n` +
          `💪 **強度**: ${research?.analysis?.strength || "N/A"}\n\n` +
          `🎯 **主要レベル**:\n` +
          `• サポート: ${research?.keyLevels?.support?.join(", ") || "N/A"}\n` +
          `• レジスタンス: ${research?.keyLevels?.resistance?.join(", ") || "N/A"}\n\n` +
          `📝 **サマリー**: ${research?.summary || "リサーチ完了"}\n\n` +
          `次のステップ: 「${symbol}のプランを作成」と入力してください。`;

        aiResponse = {
          role: "ai",
          content,
          timestamp: new Date(),
          data: research,
        };

      } else if (intent === "plan") {
        // Plan API 呼び出し
        const response = await fetch(`${API_BASE}/plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, timeframe }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "プラン生成に失敗しました");
        }

        // プラン結果をフォーマット
        const plan = data.plan;
        const scenario = plan?.scenarios?.[0];
        const content = `📋 **${symbol} トレードプラン**\n\n` +
          `🎯 **推奨シナリオ**: ${scenario?.direction?.toUpperCase() || "N/A"}\n` +
          `📍 **エントリー**: ${scenario?.entry?.price || "N/A"}\n` +
          `🛡️ **ストップ**: ${scenario?.stopLoss?.price || "N/A"}\n` +
          `🎁 **ターゲット**: ${scenario?.takeProfit?.[0]?.price || "N/A"}\n` +
          `⚖️ **リスクリワード**: ${scenario?.riskReward || "N/A"}\n\n` +
          `📊 **確信度**: ${scenario?.confidence || "N/A"}%\n` +
          `📝 **根拠**: ${scenario?.reasoning || "プラン生成完了"}\n\n` +
          `次のステップ: Trade タブで仮想トレードを作成できます。`;

        aiResponse = {
          role: "ai",
          content,
          timestamp: new Date(),
          data: plan,
        };

      } else {
        // 不明な意図
        aiResponse = {
          role: "ai",
          content: "ご質問ありがとうございます。\n\n以下のコマンドをお試しください:\n\n" +
            "🔬 **リサーチ**: 「XAUUSDの市場分析」「ゴールドをリサーチ」\n" +
            "📋 **プラン**: 「XAUUSDのプランを作成」「ゴールドのエントリー戦略」\n\n" +
            "対応シンボル: XAU/USD, EUR/USD, USD/JPY, GBP/USD",
          timestamp: new Date(),
        };
      }

      setMessages((prev) => [...prev, aiResponse]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "エラーが発生しました";
      const aiResponse: ChatMessage = {
        role: "ai",
        content: `⚠️ エラーが発生しました:\n${errorMessage}\n\nしばらく待ってから再度お試しください。`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
    } finally {
      setIsTyping(false);
    }
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
          {phases.map((phase) => {
            // リンク先がある場合はLinkコンポーネントを使用
            const PhaseIcon = (
              <div className="relative group">
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
              </div>
            );

            // リンクがある場合
            if (phase.href) {
              return (
                <Link
                  key={phase.id}
                  href={phase.href}
                  className="transition-all duration-300 hover:scale-110"
                  title={phase.label}
                >
                  {PhaseIcon}
                </Link>
              );
            }

            // リンクがない場合（planned または チャットから実行）
            return (
              <button
                key={phase.id}
                className={`transition-all duration-300 ${phase.status === "planned" ? "opacity-50 cursor-not-allowed" : "hover:scale-110"
                  }`}
                disabled={phase.status === "planned"}
                title={phase.label}
              >
                {PhaseIcon}
              </button>
            );
          })}
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
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === "user"
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
