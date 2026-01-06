'use client';

/**
 * NeonCard コンポーネント
 * 
 * D+C+A スタイル: グラスモーフィズム + アイコングロー + ホバー時グローイングボーダー
 * アイコン + タイトルの1行構成
 */

import Link from 'next/link';
import { ReactNode } from 'react';

// グロー色のプリセット
export const GLOW_COLORS = {
  blue: { rgb: '59,130,246', gradient: 'from-blue-400 to-cyan-400' },
  purple: { rgb: '168,85,247', gradient: 'from-purple-400 to-pink-400' },
  green: { rgb: '34,197,94', gradient: 'from-green-400 to-emerald-400' },
  orange: { rgb: '249,115,22', gradient: 'from-orange-400 to-amber-400' },
  pink: { rgb: '236,72,153', gradient: 'from-pink-400 to-rose-400' },
  cyan: { rgb: '6,182,212', gradient: 'from-cyan-400 to-teal-400' },
  slate: { rgb: '148,163,184', gradient: 'from-slate-400 to-slate-500' },
} as const;

export type GlowColor = keyof typeof GLOW_COLORS;

interface NeonCardProps {
  /** アイコン（絵文字 or ReactNode） */
  icon: ReactNode;
  /** タイトル */
  title: string;
  /** リンク先（指定時は Link になる） */
  href?: string;
  /** クリックハンドラ（href がない場合） */
  onClick?: () => void;
  /** グロー色 */
  color?: GlowColor;
  /** 追加のクラス名 */
  className?: string;
}

export function NeonCard({
  icon,
  title,
  href,
  onClick,
  color = 'purple',
  className = '',
}: NeonCardProps) {
  const glowConfig = GLOW_COLORS[color];

  // カード内部コンテンツ
  const cardContent = (
    <>
      {/* カード本体 */}
      <div className="relative rounded-[10px] py-3.5 px-4 bg-slate-900/95 backdrop-blur-md
                      group-hover:bg-slate-900/80 transition-all duration-300">
        <div className="flex items-center">
          {/* アイコン（グロー付き） */}
          <span 
            className="text-xl transition-all duration-300 flex-shrink-0"
            style={{
              filter: `drop-shadow(0 0 8px rgba(${glowConfig.rgb}, 0.6))`,
            }}
          >
            {icon}
          </span>
          <span className="ml-3 text-sm font-semibold text-white/90 group-hover:text-white transition-colors truncate">
            {title}
          </span>
        </div>
      </div>
    </>
  );

  // 共通のラッパースタイル
  const wrapperClassName = `group relative block rounded-xl p-[2px]
    bg-white/10 hover:bg-gradient-to-br ${glowConfig.gradient}
    transition-all duration-300 ${className}`;

  // ホバー時のグロー効果
  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.boxShadow = `0 0 25px rgba(${glowConfig.rgb}, 0.5)`;
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.boxShadow = `0 0 0px rgba(${glowConfig.rgb}, 0)`;
  };

  // リンクの場合
  if (href) {
    return (
      <Link
        href={href}
        className={wrapperClassName}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {cardContent}
      </Link>
    );
  }

  // ボタンの場合
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${wrapperClassName} w-full text-left`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {cardContent}
    </button>
  );
}

export default NeonCard;
