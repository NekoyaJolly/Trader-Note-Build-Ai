"use client";

import React, { useMemo, useState } from 'react';
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
}

type Side = 'BUY' | 'SELL';

export function OrderPanel({ symbol, disabled = false, onOrderPlaced }: OrderPanelProps) {
  const [volume, setVolume] = useState<number>(0.01);
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="bg-gray-800/80 border border-gray-700 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">ワンクリック注文</h3>
        <span className="text-xs text-gray-400">{symbol}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          ロット数
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
          />
        </label>
        <label className="text-xs text-gray-400">
          コメント
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
            placeholder="任意"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-400">
          TP（任意）
          <input
            type="number"
            step="0.01"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
            placeholder="例: 2350.25"
          />
        </label>
        <label className="text-xs text-gray-400">
          SL（任意）
          <input
            type="number"
            step="0.01"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1 text-sm text-white"
            placeholder="例: 2320.75"
          />
        </label>
      </div>

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

      {message && <p className="text-xs text-green-400">{message}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export default OrderPanel;
