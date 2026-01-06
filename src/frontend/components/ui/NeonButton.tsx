'use client';

/**
 * NeonButton コンポーネント
 * 
 * D+C+A スタイル: グラスモーフィズム + ホバー時グローイングボーダー
 */

import Link from 'next/link';
import { ReactNode } from 'react';
import { GLOW_COLORS, GlowColor } from './NeonCard';

type ButtonSize = 'sm' | 'md' | 'lg';
type ButtonVariant = 'solid' | 'outline' | 'ghost';

interface NeonButtonProps {
  /** ボタンテキスト or 子要素 */
  children: ReactNode;
  /** リンク先（指定時は Link になる） */
  href?: string;
  /** クリックハンドラ */
  onClick?: () => void;
  /** グロー色 */
  color?: GlowColor;
  /** サイズ */
  size?: ButtonSize;
  /** バリアント */
  variant?: ButtonVariant;
  /** 無効状態 */
  disabled?: boolean;
  /** ボタンタイプ */
  type?: 'button' | 'submit' | 'reset';
  /** 追加のクラス名 */
  className?: string;
  /** アイコン（左側） */
  icon?: ReactNode;
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'py-2 px-3 text-xs',
  md: 'py-2.5 px-4 text-sm',
  lg: 'py-3 px-5 text-base',
};

export function NeonButton({
  children,
  href,
  onClick,
  color = 'purple',
  size = 'md',
  variant = 'solid',
  disabled = false,
  type = 'button',
  className = '',
  icon,
}: NeonButtonProps) {
  const glowConfig = GLOW_COLORS[color];

  // バリアントに応じた背景スタイル（内側div用）
  const variantStyles = {
    solid: 'bg-slate-900/95 group-hover:bg-slate-900/80',
    outline: 'bg-transparent',
    ghost: 'bg-transparent group-hover:bg-white/5',
  };

  // outline用のボーダースタイル（直接borderを使用）
  const outlineBorderStyle = variant === 'outline' 
    ? { borderWidth: '2px', borderStyle: 'solid', borderColor: `rgba(${glowConfig.rgb}, 0.6)` }
    : {};

  // ボタン内部コンテンツ
  const buttonContent = (
    <div 
      className={`relative rounded-[10px] ${sizeClasses[size]} ${variantStyles[variant]}
                  backdrop-blur-md transition-all duration-300
                  flex items-center justify-center gap-2 font-semibold w-full
                  text-white/90 group-hover:text-white`}
      style={outlineBorderStyle}
    >
      {icon && (
        <span 
          className="transition-all duration-300"
          style={{
            filter: `drop-shadow(0 0 6px rgba(${glowConfig.rgb}, 0.6))`,
          }}
        >
          {icon}
        </span>
      )}
      {children}
    </div>
  );

  // バリアントに応じたラッパー背景
  // outline/ghost: 透明
  // solid: 薄い背景
  const wrapperBg = variant === 'solid' 
    ? 'bg-white/10' 
    : 'bg-transparent';

  // 共通のラッパースタイル
  const wrapperClassName = `group relative isolate inline-block rounded-xl ${variant === 'outline' || variant === 'ghost' ? '' : 'p-[2px]'}
    ${wrapperBg} ${variant === 'solid' ? `hover:bg-gradient-to-br ${glowConfig.gradient}` : ''}
    transition-all duration-300
    ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}
    ${className}`;

  // ホバー時のグロー効果
  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!disabled) {
      e.currentTarget.style.boxShadow = `0 0 20px rgba(${glowConfig.rgb}, 0.5)`;
    }
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.boxShadow = `0 0 0px rgba(${glowConfig.rgb}, 0)`;
  };

  // リンクの場合
  if (href && !disabled) {
    return (
      <Link
        href={href}
        className={wrapperClassName}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {buttonContent}
      </Link>
    );
  }

  // ボタンの場合
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={wrapperClassName}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {buttonContent}
    </button>
  );
}

export default NeonButton;
