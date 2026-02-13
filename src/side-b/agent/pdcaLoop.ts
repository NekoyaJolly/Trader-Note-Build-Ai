/**
 * PDCA Loop Orchestrator — 自律型トレーディングAIのメインループ
 * 
 * 目的: AgentMemory の状態に基づいてPDCAサイクルを駆動
 * 
 * 設計思想:
 * - 既存の SideBScheduler の固定インターバル(1hr/4hr)を、
 *   AIの判断に基づく動的スケジューリングに拡張
 * - AgentMemory を中心に状態遷移を管理
 * - 各フェーズは独立した関数に分離
 * 
 * PDCA サイクル:
 *   IDLE → SESSION_OPEN（セッション開始 = 戦略立案）
 *        → MONITORING（定期監視 = 条件チェック）
 *        → EVALUATING_ENTRY（エントリー条件接近時）
 *        → MANAGING_POSITION（ポジション保有中）
 *        → REFLECTING（トレード完了後 = 振り返り）
 *        → REVISING_STRATEGY（市場変化 = 戦略修正）
 *        → IDLE or MONITORING
 * 
 * 既存コードとの関係:
 * - SideBScheduler: 引き続き監視/検証の実行インフラとして使用
 * - AIOrchestrator: Research → Plan パイプラインはそのまま
 * - AgentMemory: 状態管理と学習のストア
 */

import {
    AgentMemory,
    agentMemory,
    type AgentState,
    type TradeResultSummary,
    type TodayStrategyContext,
} from './agentMemory';
import type { MarketAnalysis } from '../models/marketAnalysis';
import { isFXMarketOpen } from '../utils/marketHours';

// ===========================================
// 型定義
// ===========================================

/**
 * PDCAループ設定
 */
export interface PDCALoopConfig {
    /** 有効/無効 */
    enabled: boolean;
    /** 監視対象シンボル */
    symbols: string[];
    /** 通常時の監視間隔（ミリ秒） */
    normalIntervalMs: number;
    /** 条件接近時の監視間隔（ミリ秒） */
    activeIntervalMs: number;
    /** ポジション保有時の監視間隔（ミリ秒） */
    positionIntervalMs: number;
    /** ログ出力するか */
    verbose: boolean;
}

const DEFAULT_PDCA_CONFIG: PDCALoopConfig = {
    enabled: false,
    symbols: ['XAUUSD'],
    normalIntervalMs: 60 * 60 * 1000,    // 1時間（通常時）
    activeIntervalMs: 15 * 60 * 1000,     // 15分（条件接近時）
    positionIntervalMs: 5 * 60 * 1000,    // 5分（ポジション保有時）
    verbose: true,
};

/**
 * PDCA ティック結果（1サイクルの実行結果）
 */
export interface PDCATickDetails {
    positions?: Array<{ symbol: string; direction: string; pnlPips: number }>;
    winRate?: number;
    totalTrades?: number;
}

export interface PDCATickResult {
    state: AgentState;
    action: string;
    nextCheckMs: number;
    details?: PDCATickDetails;
}

/**
 * PDCAサイクルのログエントリ
 */
export interface ThinkingLogEntry {
    timestamp: Date;
    cycle: number;
    state: AgentState;
    action: string;
    reasoning?: string;
    data?: PDCATickDetails;
}

// ===========================================
// PDCA Loop クラス
// ===========================================

export class PDCALoop {
    private config: PDCALoopConfig;
    private memory: AgentMemory;
    private isRunning: boolean = false;
    private timerId?: NodeJS.Timeout;
    private thinkingLog: ThinkingLogEntry[] = [];

    constructor(config?: Partial<PDCALoopConfig>) {
        this.config = { ...DEFAULT_PDCA_CONFIG, ...config };
        this.memory = agentMemory;
    }

    // --- ライフサイクル ---

    /**
     * PDCAループを開始
     */
    start(): void {
        if (this.isRunning) {
            this.log('PDCAループは既に実行中です');
            return;
        }

        if (!this.config.enabled) {
            this.log('PDCAループは無効です');
            return;
        }

        this.isRunning = true;
        this.memory.setWatchSymbols(this.config.symbols);
        this.log('PDCAループを開始します');
        this.log(`  監視シンボル: ${this.config.symbols.join(', ')}`);
        this.log(`  通常間隔: ${this.config.normalIntervalMs / 1000}秒`);
        this.log(`  アクティブ間隔: ${this.config.activeIntervalMs / 1000}秒`);
        this.log(`  ポジション間隔: ${this.config.positionIntervalMs / 1000}秒`);

        // 初回ティックを即時実行
        this.scheduleTick(0);
    }

    /**
     * PDCAループを停止
     */
    stop(): void {
        if (!this.isRunning) return;

        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = undefined;
        }

        this.isRunning = false;
        this.memory.setState('IDLE');
        this.log('PDCAループを停止しました');
    }

    // --- メインティック ---

    /**
     * 1ティック実行 — 現在の状態に基づいてアクションを決定
     * 
     * これがPDCAサイクルの心臓部。
     * AgentMemory の currentState を見て、何をすべきか判断する。
     */
    async tick(): Promise<PDCATickResult> {
        const cycle = this.memory.incrementCycle();
        const state = this.memory.getState();
        const marketOpen = isFXMarketOpen();

        this.log(`--- Cycle #${cycle} | State: ${state} | Market: ${marketOpen ? 'OPEN' : 'CLOSED'} ---`);

        // 市場閉場中は IDLE
        if (!marketOpen) {
            if (state !== 'IDLE') {
                this.memory.setState('IDLE');
                this.memory.clearTodayStrategies();
            }
            return {
                state: 'IDLE',
                action: '市場閉場中 — 次の開場まで待機',
                nextCheckMs: this.config.normalIntervalMs,
            };
        }

        // 状態に基づいた処理
        switch (state) {
            case 'IDLE':
                return this.handleIdle();
            case 'SESSION_OPEN':
                return this.handleSessionOpen();
            case 'MONITORING':
                return this.handleMonitoring();
            case 'EVALUATING_ENTRY':
                return this.handleEvaluatingEntry();
            case 'MANAGING_POSITION':
                return this.handleManagingPosition();
            case 'REFLECTING':
                return this.handleReflecting();
            case 'REVISING_STRATEGY':
                return this.handleRevisingStrategy();
            default:
                return {
                    state: 'IDLE',
                    action: `不明な状態: ${state}`,
                    nextCheckMs: this.config.normalIntervalMs,
                };
        }
    }

    // --- 状態ハンドラー ---

    /**
     * IDLE → SESSION_OPEN
     * 市場が開いたら、セッション開始フェーズに移行
     */
    private handleIdle(): PDCATickResult {
        this.memory.setState('SESSION_OPEN');

        this.addThinkingLog('SESSION_OPEN', 'セッション開始 — 市場分析と戦略立案を開始',
            '市場が開場したため、新しいセッションを開始します。まず市場分析（Research AI）を実行し、その結果に基づいて戦略を立案（Plan AI）します。');

        return {
            state: 'SESSION_OPEN',
            action: 'セッション開始 — 市場分析と戦略立案を開始',
            nextCheckMs: 0, // 即時次のティック
        };
    }

    /**
     * SESSION_OPEN → MONITORING
     * Research AI + Plan AI を実行して戦略を立案
     * （実際のAI呼び出しはSideBSchedulerのexecutePlanJobが行う）
     */
    private handleSessionOpen(): PDCATickResult {
        // ここでは状態遷移のみ。実際のAI実行はschedulerの
        // executePlanJob / orchestrator が行い、その結果を
        // PDCALoop が AgentMemory に反映する。

        this.memory.setState('MONITORING');
        this.memory.setLastAnalysis(new Date());

        this.addThinkingLog('MONITORING', '監視モードに移行 — エントリー条件を定期チェック',
            '戦略立案完了（又は進行中）。監視モードに移行し、エントリー条件の到達をチェックします。');

        return {
            state: 'MONITORING',
            action: '監視モードに移行',
            nextCheckMs: this.config.normalIntervalMs,
        };
    }

    /**
     * MONITORING — 定期チェック
     * ポジションがあれば MANAGING_POSITION に、
     * 条件接近があれば EVALUATING_ENTRY に遷移
     */
    private handleMonitoring(): PDCATickResult {
        const openPositions = this.memory.getOpenPositions();

        // ポジションがあれば管理モードに
        if (openPositions.length > 0) {
            this.memory.setState('MANAGING_POSITION');
            this.addThinkingLog('MANAGING_POSITION', `ポジション管理モード — ${openPositions.length}件の保有ポジションを監視`,
                `オープンポジションを検出したため、ポジション管理モードに移行します。`);

            return {
                state: 'MANAGING_POSITION',
                action: `ポジション管理: ${openPositions.length}件`,
                nextCheckMs: this.config.positionIntervalMs,
            };
        }

        // 戦略修正が必要か判断（4時間ごと）
        const lastAnalysis = this.memory.getFullState().lastAnalysisAt;
        const hoursSinceAnalysis = lastAnalysis
            ? (Date.now() - lastAnalysis.getTime()) / (1000 * 60 * 60)
            : Infinity;

        if (hoursSinceAnalysis >= 4) {
            this.memory.setState('REVISING_STRATEGY');
            this.addThinkingLog('REVISING_STRATEGY', '定期戦略見直し — 4時間経過のため再分析',
                `前回の分析から${hoursSinceAnalysis.toFixed(1)}時間経過。市場状況の変化を確認するため再分析します。`);

            return {
                state: 'REVISING_STRATEGY',
                action: '定期戦略見直し',
                nextCheckMs: 0, // 即時
            };
        }

        // 通常の監視継続
        this.memory.setLastMonitor(new Date());

        return {
            state: 'MONITORING',
            action: '監視継続 — 条件チェック中',
            nextCheckMs: this.config.normalIntervalMs,
        };
    }

    /**
     * EVALUATING_ENTRY — エントリー条件精密チェック
     * （将来: AIが価格の近接度を判断して高頻度チェクに切り替え）
     */
    private handleEvaluatingEntry(): PDCATickResult {
        // 現段階ではMONITORINGに戻す
        // Phase 3で: AIが条件到達を判断 → エントリー実行
        this.memory.setState('MONITORING');

        this.addThinkingLog('MONITORING', 'エントリー評価完了 — 監視に戻る',
            'エントリー条件の精密チェックを実施。条件未到達のため監視モードに復帰。');

        return {
            state: 'MONITORING',
            action: 'エントリー評価完了 — 監視に復帰',
            nextCheckMs: this.config.activeIntervalMs,
        };
    }

    /**
     * MANAGING_POSITION — ポジション管理
     * SL/TP到達チェック。決済されたら REFLECTING に遷移
     */
    private handleManagingPosition(): PDCATickResult {
        const openPositions = this.memory.getOpenPositions();

        if (openPositions.length === 0) {
            // ポジションが全て決済された → 振り返りへ
            this.memory.setState('REFLECTING');
            this.addThinkingLog('REFLECTING', '全ポジション決済完了 — 振り返りフェーズへ',
                'オープンポジションが全て決済されました。トレード結果を分析し、学びを記録します。');

            return {
                state: 'REFLECTING',
                action: 'ポジション決済完了 — 振り返り開始',
                nextCheckMs: 0, // 即時
            };
        }

        // ポジション保有中 — 高頻度監視を継続
        return {
            state: 'MANAGING_POSITION',
            action: `ポジション監視中: ${openPositions.length}件`,
            nextCheckMs: this.config.positionIntervalMs,
            details: {
                positions: openPositions.map(p => ({
                    symbol: p.symbol,
                    direction: p.direction,
                    pnlPips: p.currentPnlPips,
                })),
            },
        };
    }

    /**
     * REFLECTING — 振り返り
     * 直近のトレード結果を分析し、学びを記録
     */
    private handleReflecting(): PDCATickResult {
        const results = this.memory.getRecentResults();
        const winRate = this.memory.getWinRate();

        // 学びの自動生成（Phase 3で: Reflection AI が詳細分析）
        const lastResult = results[0];
        if (lastResult && !lastResult.reflection) {
            // 簡易反省（Phase 3で本格的なReflection AIに置き換え）
            const simpleReflection = lastResult.outcome === 'loss'
                ? `${lastResult.symbol} ${lastResult.direction} で ${lastResult.pnlPips.toFixed(1)}pips の損失。${lastResult.exitReason}による決済。`
                : `${lastResult.symbol} ${lastResult.direction} で ${lastResult.pnlPips.toFixed(1)}pips の利益。戦略通りの展開。`;

            lastResult.reflection = simpleReflection;
        }

        this.addThinkingLog('MONITORING', `振り返り完了 — 勝率: ${winRate.toFixed(0)}%`,
            `直近${results.length}件のトレード結果を確認。勝率: ${winRate.toFixed(0)}%。監視モードに復帰します。`);

        this.memory.setState('MONITORING');

        return {
            state: 'MONITORING',
            action: `振り返り完了 — 勝率 ${winRate.toFixed(0)}%`,
            nextCheckMs: this.config.normalIntervalMs,
            details: { winRate, totalTrades: results.length },
        };
    }

    /**
     * REVISING_STRATEGY — 戦略修正
     * 市場状況が変化した場合、または定期的に戦略を見直す
     */
    private handleRevisingStrategy(): PDCATickResult {
        // 戦略修正 → SESSION_OPEN に戻して再分析
        this.memory.setState('SESSION_OPEN');
        this.memory.setLastAnalysis(new Date());

        this.addThinkingLog('SESSION_OPEN', '戦略修正 — 再分析を開始',
            '市場状況が変化した可能性があるため、新しいMarket Analysisを実行します。');

        return {
            state: 'SESSION_OPEN',
            action: '戦略修正 — 再分析開始',
            nextCheckMs: 0, // 即時次のティック
        };
    }

    // --- 外部からのイベント通知 ---

    /**
     * トレード完了を通知（SideBScheduler から呼ばれる）
     */
    notifyTradeCompleted(result: TradeResultSummary): void {
        this.memory.addTradeResult(result);

        // ポジション管理中なら、ポジション一覧を更新
        this.memory.removeOpenPosition(result.id);

        this.addThinkingLog(this.memory.getState(),
            `トレード完了: ${result.symbol} ${result.outcome} ${result.pnlPips > 0 ? '+' : ''}${result.pnlPips.toFixed(1)}pips`,
            result.strategyRationale);
    }

    /**
     * 新しい市場分析を受信（Research AI 完了時に呼ばれる）
     */
    notifyAnalysisComplete(symbol: string, analysis: MarketAnalysis): void {
        const context: TodayStrategyContext = {
            baseAnalysis: analysis,
            strategies: [],
            generatedAt: new Date(),
            revisedCount: 0,
        };
        this.memory.setTodayStrategy(symbol, context);
        this.memory.setLastAnalysis(new Date());

        this.addThinkingLog(this.memory.getState(),
            `${symbol} 市場分析完了: ${analysis.regime} / ${analysis.direction}`,
            analysis.reasoning.keyObservation);
    }

    /**
     * 新しい戦略を受信（Plan AI 完了時に呼ばれる）
     */
    notifyStrategyComplete(symbol: string, scenarios: Array<{ name: string; direction: 'long' | 'short'; entryPrice: number; confidence: number }>): void {
        const existing = this.memory.getTodayStrategy(symbol);
        if (existing) {
            existing.strategies = scenarios.map(s => ({
                ...s,
                status: 'waiting' as const,
            }));
            existing.revisedCount++;
            existing.lastRevisedAt = new Date();
        }

        this.addThinkingLog(this.memory.getState(),
            `${symbol} 戦略更新: ${scenarios.length}個のシナリオ`,
            scenarios.map(s => `${s.direction} @${s.entryPrice} (信頼度${s.confidence}%)`).join(', '));
    }

    // --- 情報取得 ---

    /**
     * 現在の状態サマリー
     */
    getStatus(): {
        isRunning: boolean;
        state: AgentState;
        summary: string;
        config: PDCALoopConfig;
        recentLog: ThinkingLogEntry[];
    } {
        return {
            isRunning: this.isRunning,
            state: this.memory.getState(),
            summary: this.memory.getSummary(),
            config: this.config,
            recentLog: this.thinkingLog.slice(-20),
        };
    }

    /**
     * 思考ログを取得
     */
    getThinkingLog(limit: number = 50): ThinkingLogEntry[] {
        return this.thinkingLog.slice(-limit);
    }

    // --- 内部ヘルパー ---

    /**
     * 次のティックをスケジュール
     */
    private scheduleTick(delayMs: number): void {
        if (!this.isRunning) return;

        this.timerId = setTimeout(async () => {
            try {
                const result = await this.tick();
                this.log(`  → ${result.action} (次回: ${(result.nextCheckMs / 1000).toFixed(0)}秒後)`);
                this.scheduleTick(result.nextCheckMs);
            } catch (error) {
                console.error('[PDCALoop] ティックエラー:', error);
                // エラー時は通常間隔でリトライ
                this.scheduleTick(this.config.normalIntervalMs);
            }
        }, delayMs);
    }

    /**
     * 思考ログを追加
     */
    private addThinkingLog(state: AgentState, action: string, reasoning?: string, data?: PDCATickDetails): void {
        const entry: ThinkingLogEntry = {
            timestamp: new Date(),
            cycle: this.memory.getCycleCount(),
            state,
            action,
            reasoning,
            data,
        };

        this.thinkingLog.push(entry);

        // 最新200件を保持
        if (this.thinkingLog.length > 200) {
            this.thinkingLog = this.thinkingLog.slice(-200);
        }
    }

    /**
     * ログ出力
     */
    private log(message: string): void {
        if (this.config.verbose) {
            console.log(`[PDCALoop] ${message}`);
        }
    }
}

// シングルトンインスタンス
export const pdcaLoop = new PDCALoop();
