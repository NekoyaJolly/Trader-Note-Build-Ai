/**
 * Agent Memory（エージェント記憶）
 * 
 * 目的: AIエージェントが過去の判断・結果を覚え、学習する仕組み
 * 
 * 設計思想:
 * - 直近のトレード結果を保持（メモリ内 + DB）
 * - 今日の戦略コンテキストを保持
 * - 学習メモ（lessons）を蓄積し、次のPDCAサイクルで参照
 * - PDCA循環の「Act」フェーズで更新される
 */

import type { MarketAnalysis } from '../models/marketAnalysis';

// ===========================================
// 型定義
// ===========================================

/**
 * トレード結果サマリー（メモリ用）
 */
export interface TradeResultSummary {
    id: string;
    symbol: string;
    direction: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    pnlPips: number;
    outcome: 'win' | 'loss' | 'breakeven';
    exitReason: string;
    strategyRationale: string;  // なぜこのトレードをしたか
    reflection?: string;       // 振り返り
    tradedAt: Date;
    closedAt: Date;
}

/**
 * アクティブポジション情報
 */
export interface ActivePosition {
    tradeId: string;
    symbol: string;
    direction: 'long' | 'short';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    currentPnlPips: number;
    openedAt: Date;
}

/**
 * 今日の戦略コンテキスト
 */
export interface TodayStrategyContext {
    baseAnalysis: MarketAnalysis;
    strategies: Array<{
        name: string;
        direction: 'long' | 'short';
        entryPrice: number;
        status: 'waiting' | 'active' | 'executed' | 'invalidated';
        confidence: number;
    }>;
    generatedAt: Date;
    revisedCount: number;
    lastRevisedAt?: Date;
}

/**
 * エージェントの状態
 */
export type AgentState =
    | 'IDLE'                // 市場閉場 or 待機中
    | 'SESSION_OPEN'        // セッション開始 → ベース戦略立案
    | 'MONITORING'          // 15分〜1時間ごとの監視
    | 'EVALUATING_ENTRY'    // エントリー条件が近い → 精密チェック
    | 'MANAGING_POSITION'   // ポジション保有中 → 出口判断
    | 'REFLECTING'          // トレード完了 → 振り返り
    | 'REVISING_STRATEGY';  // 市場変化 → 戦略修正

/**
 * エージェントメモリ（メイン型）
 */
export interface AgentMemoryState {
    /** 現在のエージェント状態 */
    currentState: AgentState;

    /** 監視対象シンボル */
    watchSymbols: string[];

    /** 直近のトレード結果（最新10件） */
    recentTradeResults: TradeResultSummary[];

    /** 現在のオープンポジション */
    openPositions: ActivePosition[];

    /** 今日の戦略コンテキスト（シンボルごと） */
    todayStrategies: Map<string, TodayStrategyContext>;

    /** 学習メモ（AIが自分で書く） */
    lessons: string[];

    /** PDCAサイクルカウンター */
    cycleCount: number;

    /** 最後の分析時刻 */
    lastAnalysisAt?: Date;

    /** 最後の監視時刻 */
    lastMonitorAt?: Date;
}

// ===========================================
// Agent Memory クラス
// ===========================================

export class AgentMemory {
    private state: AgentMemoryState;

    constructor() {
        this.state = {
            currentState: 'IDLE',
            watchSymbols: ['XAUUSD'],
            recentTradeResults: [],
            openPositions: [],
            todayStrategies: new Map(),
            lessons: [],
            cycleCount: 0,
        };
    }

    // --- 状態管理 ---

    getState(): AgentState {
        return this.state.currentState;
    }

    setState(newState: AgentState): void {
        console.log(`[AgentMemory] 状態遷移: ${this.state.currentState} → ${newState}`);
        this.state.currentState = newState;
    }

    getFullState(): AgentMemoryState {
        return this.state;
    }

    // --- シンボル管理 ---

    getWatchSymbols(): string[] {
        return this.state.watchSymbols;
    }

    setWatchSymbols(symbols: string[]): void {
        this.state.watchSymbols = symbols.slice(0, 5); // 最大5個
        console.log(`[AgentMemory] 監視シンボル更新: ${this.state.watchSymbols.join(', ')}`);
    }

    // --- トレード結果 ---

    addTradeResult(result: TradeResultSummary): void {
        this.state.recentTradeResults.unshift(result); // 先頭に追加
        if (this.state.recentTradeResults.length > 10) {
            this.state.recentTradeResults = this.state.recentTradeResults.slice(0, 10);
        }
        console.log(`[AgentMemory] トレード結果追加: ${result.symbol} ${result.outcome} ${result.pnlPips > 0 ? '+' : ''}${result.pnlPips.toFixed(1)}pips`);
    }

    getRecentResults(): TradeResultSummary[] {
        return this.state.recentTradeResults;
    }

    getWinRate(): number {
        const results = this.state.recentTradeResults;
        if (results.length === 0) return 0;
        const wins = results.filter(r => r.outcome === 'win').length;
        return (wins / results.length) * 100;
    }

    // --- ポジション管理 ---

    addOpenPosition(position: ActivePosition): void {
        this.state.openPositions.push(position);
    }

    removeOpenPosition(tradeId: string): void {
        this.state.openPositions = this.state.openPositions.filter(p => p.tradeId !== tradeId);
    }

    getOpenPositions(): ActivePosition[] {
        return this.state.openPositions;
    }

    hasOpenPosition(symbol: string): boolean {
        return this.state.openPositions.some(p => p.symbol === symbol);
    }

    // --- 戦略コンテキスト ---

    setTodayStrategy(symbol: string, context: TodayStrategyContext): void {
        this.state.todayStrategies.set(symbol, context);
    }

    getTodayStrategy(symbol: string): TodayStrategyContext | undefined {
        return this.state.todayStrategies.get(symbol);
    }

    clearTodayStrategies(): void {
        this.state.todayStrategies.clear();
    }

    // --- 学習メモ ---

    addLesson(lesson: string): void {
        this.state.lessons.push(lesson);
        if (this.state.lessons.length > 20) {
            this.state.lessons = this.state.lessons.slice(-20); // 最新20件を保持
        }
        console.log(`[AgentMemory] 学習メモ追加: ${lesson}`);
    }

    getLessons(): string[] {
        return this.state.lessons;
    }

    // --- サイクル管理 ---

    incrementCycle(): number {
        this.state.cycleCount++;
        return this.state.cycleCount;
    }

    getCycleCount(): number {
        return this.state.cycleCount;
    }

    setLastAnalysis(date: Date): void {
        this.state.lastAnalysisAt = date;
    }

    setLastMonitor(date: Date): void {
        this.state.lastMonitorAt = date;
    }

    // --- Strategy Thinker 連携 ---

    /**
     * Strategy Thinker に渡す学習メモを取得
     * 直近の失敗からの学びを抽出
     */
    getLessonsForStrategy(): string[] {
        const lessons = [...this.state.lessons];

        // 直近の負けトレードからも学びを追加
        const recentLosses = this.state.recentTradeResults
            .filter(r => r.outcome === 'loss')
            .slice(0, 3);

        for (const loss of recentLosses) {
            if (loss.reflection) {
                lessons.push(`[直近の損失] ${loss.symbol}: ${loss.reflection}`);
            }
        }

        return lessons;
    }

    // --- サマリー ---

    /**
     * 状態サマリー（ログ/ダッシュボード用）
     */
    getSummary(): string {
        const state = this.state;
        const openCount = state.openPositions.length;
        const winRate = this.getWinRate();
        const strategiesCount = state.todayStrategies.size;

        return `[Agent] 状態:${state.currentState} | ` +
            `監視:${state.watchSymbols.join(',')} | ` +
            `OP:${openCount} | 勝率:${winRate.toFixed(0)}%(${state.recentTradeResults.length}件) | ` +
            `戦略:${strategiesCount}件 | サイクル:${state.cycleCount}`;
    }
}

// シングルトンインスタンス
export const agentMemory = new AgentMemory();
