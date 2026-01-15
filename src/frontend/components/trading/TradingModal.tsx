/**
 * トレーディングモーダルコンポーネント
 * 
 * 目的: マーケット分析ページでトレード情報を表示するモーダル
 * 
 * 機能:
 * - 口座情報表示（AccountInfo）
 * - ポジション一覧表示（PositionList）
 * - モーダル開閉制御
 */

'use client';

import React, { useEffect } from 'react';
import { useTradingAccount } from '@/hooks/useTradingAccount';
import { AccountInfo } from './AccountInfo';
import { PositionList } from './PositionList';

interface TradingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TradingModal({ isOpen, onClose }: TradingModalProps) {
  const { accountInfo, positions, loading, error } = useTradingAccount(isOpen);

  // ESCキーで閉じる
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div 
        className="bg-gray-900 rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-white">トレード情報</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 space-y-6">
          {loading && (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg">読み込み中...</div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-4">
              <div className="text-red-400 font-semibold">エラー</div>
              <div className="text-red-300 text-sm mt-1">{error}</div>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* 口座情報 */}
              {accountInfo && <AccountInfo {...accountInfo} />}

              {/* ポジション一覧 */}
              <PositionList positions={positions} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
