/**
 * トレーディングアカウント情報フック
 * 
 * 目的: cTrader口座の残高・ポジション情報をフェッチし、SSEでリアルタイム更新
 * 
 * 機能:
 * - 口座情報取得（残高、証拠金、証拠金維持率）
 * - ポジション一覧取得
 * - SSE接続によるリアルタイムポジション更新
 * 
 * 使用例:
 * ```tsx
 * const { accountInfo, positions, loading, error } = useTradingAccount();
 * ```
 */

import { useState, useEffect, useRef } from 'react';
import type {
  AccountInfoResponse,
  PositionResponse,
} from '@/schemas/api/trading';
import {
  AccountInfoResponseSchema,
  PositionsResponseSchema,
  PositionUpdateEventSchema
} from '@/schemas/api/trading';
import { apiFetch } from '@/lib/apiClient';
import { z } from 'zod';

// バックエンドは cTrader 障害時に { error } イベントを同一 SSE ストリームへ流す。
// これは PositionUpdate ではないため、ポジション更新として parse せず区別する。
const StreamErrorEventSchema = z.object({ error: z.string() });

// ========================================
// カスタムフック
// ========================================

export function useTradingAccount(enabled: boolean = true) {
  const [accountInfo, setAccountInfo] = useState<AccountInfoResponse | null>(null);
  const [positions, setPositions] = useState<PositionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

  /**
   * 初回データ取得とSSE接続
   */
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    /**
     * 口座情報を取得
     */
    const fetchAccountInfo = async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/trading/account`);

        const data = await response.json();

        if (data.success) {
          // Zodバリデーション
          const result = AccountInfoResponseSchema.safeParse(data.data);
          if (result.success) {
            setAccountInfo(result.data);
          } else {
            console.error('[useTradingAccount] 口座情報バリデーションエラー:', result.error);
            setError('口座情報の形式が不正です');
          }
        } else {
          setError(data.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '口座情報の取得に失敗しました');
      }
    };

    /**
     * ポジション一覧を取得
     */
    const fetchPositions = async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/trading/positions`);

        const data = await response.json();

        if (data.success) {
          // Zodバリデーション
          const result = PositionsResponseSchema.safeParse(data.data);
          if (result.success) {
            setPositions(result.data);
          } else {
            console.error('[useTradingAccount] ポジションバリデーションエラー:', result.error);
            setError('ポジション情報の形式が不正です');
          }
        } else {
          setError(data.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ポジション情報の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchAccountInfo();
    fetchPositions();

    // SSE接続（リアルタイム更新）
    const eventSource = new EventSource(`${API_BASE}/api/trading/stream`, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);

        // エラーイベント ({ error }) は PositionUpdate として扱わず警告ログのみ
        const errorEvent = StreamErrorEventSchema.safeParse(parsedData);
        if (errorEvent.success) {
          console.warn('[useTradingAccount] SSE エラーイベント:', errorEvent.data.error);
          return;
        }

        // Zodバリデーション
        const result = PositionUpdateEventSchema.safeParse(parsedData);
        if (!result.success) {
          console.error('[useTradingAccount] SSEバリデーションエラー:', result.error);
          return;
        }

        const update = result.data;

        if (update.type === 'OPEN') {
          // 新規ポジション追加
          setPositions((prev) => [...prev, update.position]);
        } else if (update.type === 'CLOSE') {
          // ポジション削除
          setPositions((prev) =>
            prev.filter((p) => p.positionId !== update.position.positionId)
          );
        } else if (update.type === 'MODIFY') {
          // ポジション更新
          setPositions((prev) =>
            prev.map((p) =>
              p.positionId === update.position.positionId ? update.position : p
            )
          );
        }

        // 口座情報も再取得（証拠金が変わるため）
        fetchAccountInfo();
      } catch (parseError) {
        console.error('[useTradingAccount] SSEメッセージパースエラー:', parseError);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[useTradingAccount] SSE接続エラー:', err);
      eventSource.close();
    };

    eventSourceRef.current = eventSource;

    // クリーンアップ
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled, API_BASE]);

  /**
   * 手動リフレッシュ
   */
  const refetch = async () => {
    if (!enabled) return;

    setLoading(true);

    try {
      // 口座情報を取得
      const accountResponse = await apiFetch(`${API_BASE}/api/trading/account`);
      const accountData = await accountResponse.json();
      if (accountData.success) {
        const result = AccountInfoResponseSchema.safeParse(accountData.data);
        if (result.success) {
          setAccountInfo(result.data);
        }
      }

      // ポジション一覧を取得
      const positionsResponse = await apiFetch(`${API_BASE}/api/trading/positions`);
      const positionsData = await positionsResponse.json();
      if (positionsData.success) {
        const result = PositionsResponseSchema.safeParse(positionsData.data);
        if (result.success) {
          setPositions(result.data);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの再取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return {
    accountInfo,
    positions,
    loading,
    error,
    refetch,
  };
}
