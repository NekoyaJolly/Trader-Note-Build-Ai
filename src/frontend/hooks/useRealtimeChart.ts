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

import { useState, useEffect, useCallback } from 'react';
import { EventSourcePolyfill } from 'event-source-polyfill';

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
  /** 市場が閉まっている可能性があるか（5分以上Tick未受信） */
  isMarketClosed: boolean;
  /** 接続開始 */
  connect: () => Promise<void>;
  /** 切断 */
  disconnect: () => void;
  /** シンボル購読 */
  subscribe: (symbols: string[]) => Promise<void>;
  /** 自動接続を有効化するフラグ（初期表示・復帰時に使用） */
  setAutoConnectEnabled: (enabled: boolean) => void;
}

/**
 * フックのオプション
 */
export interface UseRealtimeChartOptions {
  /** 時間足（秒） */
  timeframe?: number;
  /** コンポーネントのアンマウントでも接続を維持するか */
  persistConnection?: boolean;
  /** マウント時に自動接続するか */
  autoConnect?: boolean;
}

// ========================================
// 共有ステート（ページ跨ぎの接続維持用）
// ========================================

interface SharedState {
  bars: OHLCVBar[];
  pendingBar: PendingBar | null;
  latestTick: TickData | null;
  status: ConnectionStatus;
  error: string | null;
  isLoading: boolean;
  isMarketClosed: boolean;
  lastTickTime: number | null;
  symbol: string | null;
  timeframe: number;
  autoConnectEnabled: boolean;
}

let sharedEventSource: EventSourcePolyfill | null = null;
let sharedState: SharedState = {
  bars: [],
  pendingBar: null,
  latestTick: null,
  status: 'disconnected',
  error: null,
  isLoading: false,
  isMarketClosed: false,
  lastTickTime: null,
  symbol: null,
  timeframe: 60,
  autoConnectEnabled: false,
};

type Subscriber = (snapshot: SharedState) => void;
const subscribers = new Set<Subscriber>();

const emitSharedState = () => {
  const snapshot = { ...sharedState };
  subscribers.forEach((cb) => cb(snapshot));
};

const disconnectShared = () => {
  if (sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }
  sharedState = {
    ...sharedState,
    bars: [],
    pendingBar: null,
    latestTick: null,
    status: 'disconnected',
    error: null,
    isLoading: false,
    isMarketClosed: false,
    lastTickTime: null,
    symbol: null,
  };
  emitSharedState();
};

// ========================================
// カスタムフック
// ========================================

export function useRealtimeChart(
  symbol: string,
  options: UseRealtimeChartOptions = {}
): UseRealtimeChartResult {
  const { timeframe = 60, persistConnection = false, autoConnect = false } = options;
  const [bars, setBars] = useState<OHLCVBar[]>(sharedState.bars);
  const [pendingBar, setPendingBar] = useState<PendingBar | null>(sharedState.pendingBar);
  const [latestTick, setLatestTick] = useState<TickData | null>(sharedState.latestTick);
  const [status, setStatus] = useState<ConnectionStatus>(sharedState.status);
  const [error, setError] = useState<string | null>(sharedState.error);
  const [isLoading, setIsLoading] = useState(sharedState.isLoading);
  const [isMarketClosed, setIsMarketClosed] = useState(sharedState.isMarketClosed);
  const [, setRenderTick] = useState(0); // 強制再レンダー用

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

  /**
   * SSE 接続を開始
   */
  const connect = useCallback(async () => {
    if (sharedEventSource) {
      // 同じシンボル・時間足ならそのまま利用
      if (sharedState.symbol === symbol && sharedState.timeframe === timeframe) {
        console.log('[useRealtimeChart] 既に接続中です（共有接続）');
        sharedState = { ...sharedState, isLoading: false, status: 'connected' };
        emitSharedState();
        return;
      }
      // 異なる場合は切断して張り直し
      disconnectShared();
    }

    sharedState = {
      ...sharedState,
      isLoading: true,
      error: null,
      status: 'connecting',
      symbol,
      timeframe,
    };
    emitSharedState();

    try {
      // 1. まず cTrader に接続
      const connectRes = await fetch(`${apiBase}/api/realtime/connect?timeframe=${timeframe}`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!connectRes.ok) {
        const errorText = await connectRes.text();
        throw new Error(`接続リクエストが失敗しました: ${connectRes.status} ${connectRes.statusText} - ${errorText}`);
      }

      const connectData = await connectRes.json();

      if (!connectData.success) {
        const errorMessage = connectData.error || connectData.message || '接続に失敗しました';
        console.error('[useRealtimeChart] 接続エラー詳細:', connectData);
        throw new Error(errorMessage);
      }

      // 2. シンボルを購読
      const subscribeRes = await fetch(`${apiBase}/api/realtime/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [symbol], timeframe }),
        credentials: 'include',
      });
      const subscribeData = await subscribeRes.json();

      if (!subscribeData.success) {
        throw new Error(subscribeData.error || '購読に失敗しました');
      }

      // 3. SSE ストリームに接続（EventSourcePolyfill を使用して CORS 対応）
      // ローカル環境では withCredentials は不要
      const isLocalhost = apiBase.includes('localhost');
      const eventSource = new EventSourcePolyfill(
        `${apiBase}/api/realtime/stream/${symbol}?timeframe=${timeframe}`,
        {
          withCredentials: !isLocalhost, // 本番環境のみ credentials を使用
          heartbeatTimeout: 120000, // 2分のハートビートタイムアウト
        }
      );
      sharedEventSource = eventSource;

      eventSource.onopen = () => {
        console.log('[useRealtimeChart] SSE 接続成功');
        sharedState = { ...sharedState, status: 'connected', isLoading: false, error: null };
        emitSharedState();
      };

      eventSource.onerror = (_e) => {
        // EventSource の readyState を確認
        // 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        const readyState = eventSource.readyState;

        // readyState が CONNECTING (0) の場合は再接続を試みている可能性がある
        // readyState が CLOSED (2) の場合のみエラー扱い
        if (readyState === 2) {
          console.warn('[useRealtimeChart] SSE 接続が切断されました');
          sharedState = {
            ...sharedState,
            status: 'error',
            error: 'SSE 接続が切断されました',
            isLoading: false,
          };
          emitSharedState();
        } else if (readyState === 0) {
          // 接続中のエラーは一時的なものの可能性があるのでログのみ
          console.log('[useRealtimeChart] SSE 再接続中...', { readyState });
        } else {
          // その他のケース（readyState === 1 でエラーなど）
          console.warn('[useRealtimeChart] SSE 警告:', { readyState });
        }
      };

      // SSE カスタムイベント用のヘルパー関数
      // EventSourcePolyfill の addEventListener でカスタムイベントを処理
      const addSSEListener = (eventType: string, handler: (data: string) => void) => {
        (eventSource as EventSource).addEventListener(eventType, ((e: MessageEvent) => {
          handler(e.data);
        }) as EventListener);
      };

      // 初期データ受信
      addSSEListener('init', (data) => {
        const parsed = JSON.parse(data);
        console.log('[useRealtimeChart] 初期データ受信:', parsed.bars?.length, 'バー');
        sharedState = {
          ...sharedState,
          bars: parsed.bars || [],
          pendingBar: parsed.pendingBar || null,
          status: parsed.status || 'connected',
        };
        emitSharedState();
      });

      // Tick 受信
      addSSEListener('tick', (data) => {
        const tick = JSON.parse(data);
        sharedState = {
          ...sharedState,
          latestTick: tick,
          lastTickTime: Date.now(),
          isMarketClosed: false,
        };
        emitSharedState();
      });

      // バー確定
      addSSEListener('bar', (data) => {
        const bar = JSON.parse(data);
        console.log('[useRealtimeChart] バー確定:', bar.timestamp);
        const exists = sharedState.bars.some((b) => b.timestamp === bar.timestamp);
        if (!exists) {
          const newBars = [...sharedState.bars, bar].slice(-60);
          sharedState = { ...sharedState, bars: newBars };
          emitSharedState();
        }
      });

      // 進行中バー更新
      addSSEListener('pendingBar', (data) => {
        const bar = JSON.parse(data);
        sharedState = { ...sharedState, pendingBar: bar };
        emitSharedState();
      });

      // 接続状態変更
      addSSEListener('status', (data) => {
        const parsed = JSON.parse(data);
        sharedState = { ...sharedState, status: parsed.status };
        emitSharedState();
      });

      // ハートビート
      addSSEListener('heartbeat', () => {
        // 接続維持確認
      });

    } catch (err) {
      console.error('[useRealtimeChart] 接続エラー:', err);
      sharedState = {
        ...sharedState,
        error: err instanceof Error ? err.message : '接続エラー',
        status: 'error',
        isLoading: false,
      };
      emitSharedState();
    }
  }, [apiBase, symbol, timeframe]);

  /**
   * 切断
   */
  const disconnect = useCallback(() => {
    disconnectShared();
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
   * 自動接続フラグを共有ステートに設定
   */
  const setAutoConnectEnabled = useCallback((enabled: boolean) => {
    sharedState = { ...sharedState, autoConnectEnabled: enabled };
    emitSharedState();
  }, []);

  /**
   * オプションから自動接続フラグを初期設定
   */
  useEffect(() => {
    if (autoConnect) {
      setAutoConnectEnabled(true);
    }
  }, [autoConnect, setAutoConnectEnabled]);

  /**
   * シンボルまたは時間足変更時に再接続
   */
  useEffect(() => {
    return () => {
      // persistConnection が false の場合のみクリーンアップ
      if (!persistConnection) {
        disconnect();
      }
    };
  }, [symbol, timeframe, disconnect, persistConnection]);

  /**
   * 市場クローズ検出（5分以上Tickが来ていない場合）
   */
  useEffect(() => {
    if (status !== 'connected') {
      setIsMarketClosed(false);
      return;
    }

    const checkInterval = setInterval(() => {
      const lastTickTime = sharedState.lastTickTime;
      if (lastTickTime) {
        const elapsed = Date.now() - lastTickTime;
        const MARKET_CLOSE_THRESHOLD = 5 * 60 * 1000; // 5分
        setIsMarketClosed(elapsed > MARKET_CLOSE_THRESHOLD);
      }
    }, 10000); // 10秒ごとにチェック

    return () => clearInterval(checkInterval);
  }, [status]);

  // 共有ステート購読
  useEffect(() => {
    const handleUpdate: Subscriber = (snapshot) => {
      setBars(snapshot.bars);
      setPendingBar(snapshot.pendingBar);
      setLatestTick(snapshot.latestTick);
      setStatus(snapshot.status);
      setError(snapshot.error);
      setIsLoading(snapshot.isLoading);
      setIsMarketClosed(snapshot.isMarketClosed);
      // autoConnectEnabledがtrueになった場合にマウント直後でも反映させるためのレンダートリガ
      setRenderTick((v) => v + 1);
    };

    subscribers.add(handleUpdate);
    // 初期同期
    handleUpdate(sharedState);

    return () => {
      subscribers.delete(handleUpdate);
      if (!persistConnection && subscribers.size === 0) {
        disconnectShared();
      }
    };
  }, [persistConnection]);

  // 初期マウント/復帰時の自動接続
  useEffect(() => {
    // すでに接続中なら何もしない
    if (sharedState.status === 'connected') return;
    if (autoConnect || sharedState.autoConnectEnabled) {
      void connect();
    }
  }, [autoConnect, connect]);

  return {
    bars,
    pendingBar,
    latestTick,
    status,
    error,
    isConnected: status === 'connected',
    isLoading,
    isMarketClosed,
    connect,
    disconnect,
    subscribe,
    setAutoConnectEnabled,
  };
}

