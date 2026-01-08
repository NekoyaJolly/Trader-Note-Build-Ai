/**
 * リアルタイムチャート用カスタムフック
 * 
 * 目的: cTrader WebSocket → SSE 経由でリアルタイム OHLCV データを受信し、
 *       チャートコンポーネントに供給
 * 
 * 機能:
 * - SSE 接続管理
 * - Tick/Bar データのリアルタイム更新
 * - 進行中バーの表示
 * - 接続状態の監視
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ========================================
// 型定義
// ========================================

/**
 * Tick データ
 */
export interface TickData {
  symbol: string;
  timestamp: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  volume?: number;
}

/**
 * OHLCV バー
 */
export interface OHLCVBar {
  symbol: string;
  timeframe: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
}

/**
 * 進行中バー
 */
export interface PendingBar {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
  startTime: string;
}

/**
 * 接続状態
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

/**
 * フックの戻り値
 */
export interface UseRealtimeChartResult {
  /** 確定済みバー */
  bars: OHLCVBar[];
  /** 進行中バー（未確定） */
  pendingBar: PendingBar | null;
  /** 最新 Tick */
  latestTick: TickData | null;
  /** 接続状態 */
  status: ConnectionStatus;
  /** エラーメッセージ */
  error: string | null;
  /** 接続中か */
  isConnected: boolean;
  /** ローディング中か */
  isLoading: boolean;
  /** 接続開始 */
  connect: () => Promise<void>;
  /** 切断 */
  disconnect: () => void;
  /** シンボル購読 */
  subscribe: (symbols: string[]) => Promise<void>;
}

/**
 * フックのオプション
 */
export interface UseRealtimeChartOptions {
  /** 時間足（秒） */
  timeframe?: number;
}

// ========================================
// カスタムフック
// ========================================

export function useRealtimeChart(
  symbol: string,
  options: UseRealtimeChartOptions = {}
): UseRealtimeChartResult {
  const { timeframe = 10 } = options;
  const [bars, setBars] = useState<OHLCVBar[]>([]);
  const [pendingBar, setPendingBar] = useState<PendingBar | null>(null);
  const [latestTick, setLatestTick] = useState<TickData | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const eventSourceRef = useRef<AbortController | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3100';

  /**
   * SSE 接続を開始
   */
  const connect = useCallback(async () => {
    if (eventSourceRef.current) {
      console.log('[useRealtimeChart] 既に接続中です');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. まず cTrader に接続
      const connectRes = await fetch(`${apiBase}/api/realtime/connect?timeframe=${timeframe}`, {
        method: 'POST',
      });
      const connectData = await connectRes.json();

      if (!connectData.success) {
        throw new Error(connectData.error || '接続に失敗しました');
      }

      // 2. シンボルを購読
      const subscribeRes = await fetch(`${apiBase}/api/realtime/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [symbol], timeframe }),
      });
      const subscribeData = await subscribeRes.json();

      if (!subscribeData.success) {
        throw new Error(subscribeData.error || '購読に失敗しました');
      }

      // 3. SSE ストリームに接続（fetch ベース）
      console.log('[useRealtimeChart] SSE 接続開始...');
      
      const abortController = new AbortController();
      eventSourceRef.current = abortController;

      const sseUrl = `${apiBase}/api/realtime/stream/${symbol}?timeframe=${timeframe}`;
      
      fetch(sseUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
        },
        signal: abortController.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`SSE 接続失敗: ${response.status}`);
        }
        
        console.log('[useRealtimeChart] SSE 接続成功');
        setStatus('connected');
        setIsLoading(false);

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('ReadableStream not supported');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            } else if (line === '' && eventData) {
              // イベント処理
              try {
                const data = JSON.parse(eventData);
                
                switch (eventType) {
                  case 'connected':
                    console.log('[useRealtimeChart] SSE connected:', data);
                    break;
                  case 'init':
                    console.log('[useRealtimeChart] 初期データ受信:', data.bars?.length, 'バー');
                    setBars(data.bars || []);
                    setPendingBar(data.pendingBar || null);
                    break;
                  case 'tick':
                    setLatestTick(data);
                    break;
                  case 'bar':
                    console.log('[useRealtimeChart] バー確定:', data.timestamp);
                    setBars(prev => {
                      const exists = prev.some(b => b.timestamp === data.timestamp);
                      if (exists) return prev;
                      const newBars = [...prev, data];
                      return newBars.slice(-60);
                    });
                    break;
                  case 'pendingBar':
                    setPendingBar(data);
                    break;
                  case 'status':
                    setStatus(data.status);
                    break;
                  case 'heartbeat':
                    // 接続維持確認
                    break;
                }
              } catch (parseError) {
                console.error('[useRealtimeChart] JSON パースエラー:', parseError);
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      }).catch((err) => {
        if (err.name === 'AbortError') {
          console.log('[useRealtimeChart] SSE 接続がキャンセルされました');
          return;
        }
        console.error('[useRealtimeChart] SSE エラー:', err);
        setStatus('error');
        setError(err.message || 'SSE 接続エラー');
        setIsLoading(false);
      });

    } catch (err) {
      console.error('[useRealtimeChart] 接続エラー:', err);
      setError(err instanceof Error ? err.message : '接続エラー');
      setStatus('error');
      setIsLoading(false);
    }
  }, [apiBase, symbol, timeframe]);

  /**
   * 切断
   */
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.abort();
      eventSourceRef.current = null;
    }
    setStatus('disconnected');
    console.log('[useRealtimeChart] 切断しました');
  }, []);

  /**
   * シンボル購読
   */
  const subscribe = useCallback(async (symbols: string[]) => {
    try {
      const res = await fetch(`${apiBase}/api/realtime/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || '購読に失敗しました');
      }
    } catch (err) {
      console.error('[useRealtimeChart] 購読エラー:', err);
      setError(err instanceof Error ? err.message : '購読エラー');
    }
  }, [apiBase]);

  /**
   * シンボルまたは時間足変更時に再接続
   */
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [symbol, timeframe, disconnect]);

  return {
    bars,
    pendingBar,
    latestTick,
    status,
    error,
    isConnected: status === 'connected',
    isLoading,
    connect,
    disconnect,
    subscribe,
  };
}

