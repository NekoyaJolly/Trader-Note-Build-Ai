"use client";

import React, { useId, useMemo, useState } from 'react';
import {
  CreateOrderRequestSchema,
  TradingOrderResponseSchema,
  type CreateOrderRequest,
} from '@/schemas/api/trading';
import { apiFetch } from '@/lib/apiClient';

interface OrderPanelProps {
  symbol: string;
  disabled?: boolean;
  onOrderPlaced?: () => void;
  /** チャート上オーバーレイ用のコンパクト表示 (余白・文字を詰め、TP/SL は詳細で折りたたむ) */
  compact?: boolean;
  /** 無効化されている理由 (市場閉場 / ブローカー未接続 等)。disabled 時に表示する */
  disabledReason?: string;
}

type Side = 'BUY' | 'SELL';

export function OrderPanel({ symbol, disabled = false, onOrderPlaced, compact = false, disabledReason }: OrderPanelProps) {
  // 詳細領域の id (同一ページに複数 OrderPanel が並んでも衝突しないよう useId で生成)
  const detailsId = useId();
  const [volume, setVolume] = useState<number>(0.01);
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // TP/SL/コメントは既定で折りたたむ (コンパクト・通常どちらも「詳細」で展開)
  const [showDetails, setShowDetails] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

  const canSubmit = useMemo(() => {
    if (disabled || submitting) return false;
    return volume > 0;
  }, [disabled, submitting, volume]);

  const parseOptionalNumber = (value: string): number | undefined => {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const submitOrder = async (side: Side) => {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const payloadCandidate: CreateOrderRequest = {
        symbol,
        side,
        volume,
        takeProfit: parseOptionalNumber(takeProfit),
        stopLoss: parseOptionalNumber(stopLoss),
        comment: comment.trim() || undefined,
      };

      const parsedPayload = CreateOrderRequestSchema.safeParse(payloadCandidate);
      if (!parsedPayload.success) {
        setError('入力内容が不正です');
        return;
      }

      const response = await apiFetch(`${apiBase}/api/trading/orders`, {
        method: 'POST',
        body: JSON.stringify(parsedPayload.data),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '注文送信に失敗しました');
      }

      const parsedResponse = TradingOrderResponseSchema.safeParse(result.data);
      if (!parsedResponse.success) {
        throw new Error('注文APIレスポンスの形式が不正です');
      }

      setMessage(`${side} 注文を送信しました`);
      onOrderPlaced?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '注文送信中にエラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`bg-gray-800/90 border border-gray-700 rounded-lg ${
        compact ? 'p-2 space-y-2 backdrop-blur-sm shadow-lg' : 'p-3 space-y-3'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className={`font-semibold text-white ${compact ? 'text-xs' : 'text-sm'}`}>ワンクリック注文</h3>
        <span className="text-[11px] text-gray-400">{symbol}</span>
      </div>

      <label className="block text-[11px] text-gray-400">
        ロット数
        <input
          type="number"
          min={0.01}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="mt-0.5 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submitOrder('BUY')}
          className="rounded bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm font-semibold py-2"
        >
          BUY
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submitOrder('SELL')}
          className="rounded bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm font-semibold py-2"
        >
          SELL
        </button>
      </div>

      {/* TP/SL/コメントは普段折りたたみ、必要時のみ展開してパネルを小さく保つ */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        aria-controls={detailsId}
        className="text-[11px] text-gray-400 hover:text-gray-200 transition"
      >
        詳細 (TP/SL/コメント) {showDetails ? '▴' : '▾'}
      </button>

      {showDetails && (
        <div id={detailsId} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-gray-400">
              TP（任意）
              <input
                type="number"
                step="0.01"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                className="mt-0.5 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
                placeholder="例: 2350.25"
              />
            </label>
            <label className="text-[11px] text-gray-400">
              SL（任意）
              <input
                type="number"
                step="0.01"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="mt-0.5 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
                placeholder="例: 2320.75"
              />
            </label>
          </div>
          <label className="block text-[11px] text-gray-400">
            コメント
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-0.5 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
              placeholder="任意"
            />
          </label>
        </div>
      )}

      {message && <p className="text-[11px] text-green-400">{message}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {disabled && !message && !error && (
        <p className="text-[11px] text-gray-500">{disabledReason ?? '現在は発注できません'}</p>
      )}
    </div>
  );
}

export default OrderPanel;
