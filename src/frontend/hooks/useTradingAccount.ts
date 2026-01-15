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

import { useState, useEffect, useCallback, useRef } from 'react';

// ========================================
// 型定義
// ========================================

interface AccountInfo {
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

interface Position {
  positionId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  entryPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitLossPips: number;
  swap: number;
  commission: number;
  takeProfit?: number;
  stopLoss?: number;
  openTime: string;
  comment?: string;
}

interface PositionUpdate {
  type: 'OPEN' | 'MODIFY' | 'CLOSE';
  position: Position;
  timestamp: string;
}

// ========================================
// カスタムフック
// ========================================

export function useTradingAccount() {
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

  /**
   * 口座情報を取得
   */
  const fetchAccountInfo = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/trading/account`, {
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success) {
        setAccountInfo(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '口座情報の取得に失敗しました');
    }
  }, [API_BASE]);

  /**
   * ポジション一覧を取得
   */
  const fetchPositions = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/trading/positions`, {
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success) {
        setPositions(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ポジション情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  /**
   * 初回データ取得とSSE接続
   */
  useEffect(() => {
    fetchAccountInfo();
    fetchPositions();

    // SSE接続（リアルタイム更新）
    const eventSource = new EventSource(`${API_BASE}/api/trading/stream`, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        const update: PositionUpdate = JSON.parse(event.data);
        
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
  }, [API_BASE, fetchAccountInfo, fetchPositions]);

  /**
   * 手動リフレッシュ
   */
  const refetch = useCallback(() => {
    setLoading(true);
    fetchAccountInfo();
    fetchPositions();
  }, [fetchAccountInfo, fetchPositions]);

  return {
    accountInfo,
    positions,
    loading,
    error,
    refetch,
  };
}
