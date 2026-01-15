/**
 * 口座情報表示コンポーネント
 * 
 * 目的: cTrader口座の残高・証拠金情報を表示
 * 
 * 表示項目:
 * - 残高（Balance）
 * - 有効証拠金（Equity）
 * - 使用証拠金（Margin）
 * - 余剰証拠金（Free Margin）
 * - 証拠金維持率（Margin Level）
 * - Live/Demoバッジ
 */

'use client';

import React from 'react';

interface AccountInfoProps {
  accountId: string;
  ctidTraderAccountId: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  currency: string;
  isLive: boolean;
  leverage: number;
}

export function AccountInfo({
  balance,
  equity,
  margin,
  freeMargin,
  marginLevel,
  currency,
  isLive,
  leverage,
}: AccountInfoProps) {
  /**
   * 通貨フォーマット
   */
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(value);
  };

  /**
   * 証拠金維持率の色（リスクレベル）
   */
  const getMarginLevelColor = (level: number) => {
    if (level >= 200) return 'text-green-400';
    if (level >= 100) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold text-white">口座情報</h3>
        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              isLive ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
            }`}
          >
            {isLive ? 'LIVE' : 'DEMO'}
          </span>
          <span className="text-gray-400 text-sm">
            レバレッジ: {leverage}倍
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* 残高 */}
        <div>
          <div className="text-gray-400 text-sm mb-1">残高</div>
          <div className="text-white text-lg font-mono">{formatCurrency(balance)}</div>
        </div>

        {/* 有効証拠金 */}
        <div>
          <div className="text-gray-400 text-sm mb-1">有効証拠金</div>
          <div className="text-white text-lg font-mono">{formatCurrency(equity)}</div>
        </div>

        {/* 使用証拠金 */}
        <div>
          <div className="text-gray-400 text-sm mb-1">使用証拠金</div>
          <div className="text-white text-lg font-mono">{formatCurrency(margin)}</div>
        </div>

        {/* 余剰証拠金 */}
        <div>
          <div className="text-gray-400 text-sm mb-1">余剰証拠金</div>
          <div className="text-white text-lg font-mono">{formatCurrency(freeMargin)}</div>
        </div>

        {/* 証拠金維持率 */}
        <div className="col-span-2 md:col-span-2">
          <div className="text-gray-400 text-sm mb-1">証拠金維持率</div>
          <div className={`text-3xl font-mono font-bold ${getMarginLevelColor(marginLevel)}`}>
            {marginLevel > 0 ? `${marginLevel.toFixed(2)}%` : '∞'}
          </div>
        </div>
      </div>
    </div>
  );
}
