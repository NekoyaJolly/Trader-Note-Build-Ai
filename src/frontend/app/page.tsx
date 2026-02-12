'use client';

/**
 * TradeAssist - ホーム画面
 * 
 * NeonCard コンポーネントを使用
 * スタッガードフェードインアニメーション
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */

import OnboardingIntro from "@/components/OnboardingIntro";
import { NeonCard, GlowColor } from "@/components/ui/NeonCard";

export default function Home() {
  // メニュー定義
  const menuItems: { href: string; icon: string; title: string; color: GlowColor; fullWidth?: boolean }[] = [
    { href: "/notes", icon: "📊", title: "トレードノート", color: "blue" },
    { href: "/strategies", icon: "🎯", title: "ストラテジー", color: "purple" },
    { href: "/import", icon: "📥", title: "トレード取込", color: "green" },
    { href: "/data-presets", icon: "📁", title: "データプリセット", color: "orange" },
    { href: "/settings", icon: "⚙️", title: "設定", color: "slate", fullWidth: true },
  ];

  return (
    <div className="min-h-screen">
      <main className="max-w-lg w-full mx-auto px-4 py-8 sm:py-12">
        {/* 初回オンボーディング */}
        <OnboardingIntro />

        {/* ヘッダー */}
        <div className="text-center mb-8 sm:mb-10 animate-fade-in">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            <span className="neon-text">TradeAssist</span>
          </h1>
          <p className="text-sm text-gray-400 tracking-wide">
            トレードノート自動生成システム
          </p>
          <div className="mt-3 mx-auto w-16 h-0.5 rounded-full bg-gradient-to-r from-pink-500 to-violet-500 opacity-60" />
        </div>

        {/* メニューカード */}
        <div className="grid grid-cols-2 gap-3 p-4 rounded-3xl glass-surface stagger-children">
          {menuItems.map((item, i) => (
            <NeonCard
              key={i}
              href={item.href}
              icon={item.icon}
              title={item.title}
              color={item.color}
              className={`animate-slide-up ${item.fullWidth ? 'col-span-2' : ''}`}
            />
          ))}
        </div>

        {/* フッター */}
        <div className="text-center mt-8 text-xs text-gray-600 animate-fade-in" style={{ animationDelay: '400ms' }}>
          <p>TradeAssist MVP</p>
        </div>
      </main>
    </div>
  );
}

