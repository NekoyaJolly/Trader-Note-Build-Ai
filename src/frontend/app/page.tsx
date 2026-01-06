'use client';

/**
 * TradeAssist - ホーム画面
 * 
 * NeonCard コンポーネントを使用
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
        <div className="text-center mb-8 sm:mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            <span className="neon-text">TradeAssist</span>
          </h1>
          <p className="text-sm text-gray-400">
            トレードノート自動生成システム
          </p>
        </div>

        {/* メニューカード */}
        <div className="grid grid-cols-2 gap-3 p-4 rounded-3xl bg-slate-900/30 backdrop-blur-sm">
          {menuItems.map((item, i) => (
            <NeonCard
              key={i}
              href={item.href}
              icon={item.icon}
              title={item.title}
              color={item.color}
              className={item.fullWidth ? 'col-span-2' : ''}
            />
          ))}
        </div>

        {/* フッター */}
        <div className="text-center mt-8 text-xs text-gray-600">
          <p>TradeAssist MVP</p>
        </div>
      </main>
    </div>
  );
}
