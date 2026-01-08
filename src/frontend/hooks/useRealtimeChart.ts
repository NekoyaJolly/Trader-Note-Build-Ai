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

  const eventSourceRef = useRef<EventSource | null>(null);
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

      // 3. SSE ストリームに接続
      const eventSource = new EventSource(`${apiBase}/api/realtime/stream/${symbol}?timeframe=${timeframe}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[useRealtimeChart] SSE 接続成功');
        setStatus('connected');
        setIsLoading(false);
      };

      eventSource.onerror = (e) => {
        console.error('[useRealtimeChart] SSE エラー:', e);
        setStatus('error');
        setError('SSE 接続エラー');
        setIsLoading(false);
      };

      // 初期データ受信
      eventSource.addEventListener('init', (e) => {
        const data = JSON.parse(e.data);
        console.log('[useRealtimeChart] 初期データ受信:', data.bars?.length, 'バー');
        setBars(data.bars || []);
        setPendingBar(data.pendingBar || null);
        setStatus(data.status || 'connected');
      });

      // Tick 受信
      eventSource.addEventListener('tick', (e) => {
        const tick = JSON.parse(e.data);
        setLatestTick(tick);
      });

      // バー確定
      eventSource.addEventListener('bar', (e) => {
        const bar = JSON.parse(e.data);
        console.log('[useRealtimeChart] バー確定:', bar.timestamp);
        setBars(prev => {
          // 重複を避けて追加
          const exists = prev.some(b => b.timestamp === bar.timestamp);
          if (exists) return prev;
          // 最新60本を保持
          const newBars = [...prev, bar];
          return newBars.slice(-60);
        });
      });

      // 進行中バー更新
      eventSource.addEventListener('pendingBar', (e) => {
        const bar = JSON.parse(e.data);
        setPendingBar(bar);
      });

      // 接続状態変更
      eventSource.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        setStatus(data.status);
      });

      // ハートビート
      eventSource.addEventListener('heartbeat', () => {
        // 接続維持確認
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
      eventSourceRef.current.close();
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

