/**
 * Agent Memory（エージェント記憶）
 * 
 * 目的: AIエージェントが過去の判断・結果を覚え、学習する仕組み
 * 
 * 設計思想:
 * - 直近のトレード結果を保持（メモリ内 + DB）
 * - 今日の戦略コンテキストを保持
 * - 学習メモ（lessons）をシンボル別に蓄積し、次のPDCAサイクルで参照
 * - 繰り返し出現する学びは「確信ルール」として永続保存
 * - PDCA循環の「Act」フェーズで更新される
 */

import type { MarketAnalysis } from '../models/marketAnalysis';
import type { LensFeatureSnapshot } from '../lenses';
import { lessonSimilarityService } from '../services/lessonSimilarityService';
// Filter Evolution Phase D-1a (2026-05-09): GenerationReflectionAgent が出した世代単位
// lesson を取得するための DB 経路。Phase D-1b で mutation/crossover prompt に流す。
import {
    generationLessonRepository as defaultGenerationLessonRepo,
    type GenerationLessonCategory,
    type GenerationLessonPersister,
    type GenerationLessonRecord,
} from '../../backend/repositories/generationLessonRepository';

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

// ===========================================
// 学習メモ型定義
// ===========================================

/**
 * 学びの発生源(Phase 5.5 で追加)。
 * Reflection AI / Strategist Agent からの呼び出しを主に想定。
 * 将来の日次サマリーシステムで集計軸として利用する。
 */
export const LESSON_SOURCES = ['reflection', 'strategist', 'discovery', 'other'] as const;
export type LessonSource = (typeof LESSON_SOURCES)[number];

/**
 * 学びに付随するメタデータ(Phase 5.5 で追加)。全フィールドオプショナル。
 * 記録経路の追跡と、日次サマリーシステムでの集計・クロス参照用。
 */
export interface LessonMetadata {
    /** 発生源(reflection / strategist / discovery / other) */
    source?: LessonSource;
    /** 関連する AITradeNote の ID 群 */
    linkedNoteIds?: string[];
    /** 関連する EdgeHypothesis の ID 群 */
    linkedHypothesisIds?: string[];
}

/** 個別の学び */
export interface LessonEntry {
    /** 学びのテキスト */
    text: string;
    /** 対象シンボル */
    symbol: string;
    /** 元トレードID */
    tradeId?: string;
    /** 追加日時 */
    addedAt: Date;
    /** 付随メタデータ(Phase 5.5 以降)。後方互換のためオプショナル。 */
    metadata?: LessonMetadata;
}

/** 確信ルール（繰り返し出現した学び） */
export interface ConsolidatedLesson {
    /** 統合された代表テキスト */
    text: string;
    /** 対象シンボル（'*' = 銘柄横断） */
    symbol: string;
    /** 出現回数 */
    count: number;
    /** 初回出現日時 */
    firstSeen: Date;
    /** 最新出現日時 */
    lastSeen: Date;
    /** 統合前の元テキスト群 */
    sourceTexts: string[];
}

/** シンボル別学習ストア */
export interface SymbolLessons {
    /** 通常の学び（max 30, FIFO） */
    entries: LessonEntry[];
    /** 確信ルール（消えない） */
    consolidated: ConsolidatedLesson[];
}

/** シンボル別 entries の最大件数 */
const MAX_ENTRIES_PER_SYMBOL = 30;

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

    /** 直近のレンズスナップショット（Phase 3: Reflection 用。シンボルごと） */
    currentLensSnapshots: Map<string, LensFeatureSnapshot>;

    /** 学習メモ — シンボル別管理 */
    lessonsBySymbol: Map<string, SymbolLessons>;

    /**
     * Discovery 週次レポートの hintsForHG キャッシュ(Critical-7 配線)。
     * DiscoveryAgent.analyze の最後に setLatestDiscoveryHints で書き込み、
     * 次の plan 生成時に orchestrator が参照して HypothesisGenerator に渡す。
     * Discovery が走るまで undefined。
     */
    latestDiscoveryHints?: {
        hints: Array<{
            promisingDirection: string;
            lensFocusAreas: string[];
            rationale: string;
        }>;
        capturedAt: Date;
        analyzedTradeCount: number;
    };

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
            currentLensSnapshots: new Map(),
            lessonsBySymbol: new Map(),
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

    // --- レンズスナップショット（Phase 3） ---

    /**
     * シンボル別に直近のレンズスナップショットを保存する。
     * Plan 生成時 → Reflection 時までのブリッジとして使う。
     */
    setCurrentLensSnapshot(symbol: string, snapshot: LensFeatureSnapshot): void {
        this.state.currentLensSnapshots.set(symbol, snapshot);
    }

    /**
     * 指定シンボルの直近レンズスナップショットを取得する。
     */
    getCurrentLensSnapshot(symbol: string): LensFeatureSnapshot | undefined {
        return this.state.currentLensSnapshots.get(symbol);
    }

    clearCurrentLensSnapshot(symbol: string): void {
        this.state.currentLensSnapshots.delete(symbol);
    }

    // --- Discovery hints キャッシュ(Phase 6.7c / Critical-7) ---

    /**
     * DiscoveryAgent.analyze 完了時に hintsForHG を保存する。
     * 直前の Plan 生成サイクルで HG が参照する。
     */
    setLatestDiscoveryHints(
        hints: Array<{
            promisingDirection: string;
            lensFocusAreas: string[];
            rationale: string;
        }>,
        analyzedTradeCount: number,
    ): void {
        this.state.latestDiscoveryHints = {
            hints,
            capturedAt: new Date(),
            analyzedTradeCount,
        };
        console.log(
            `[AgentMemory] Discovery hints キャッシュ更新: ${hints.length}件 (analyzedTradeCount=${analyzedTradeCount})`,
        );
    }

    /**
     * 直近の Discovery hints を取得する。Discovery が走っていなければ undefined。
     * orchestrator が plan 生成サイクルで参照する。
     */
    getLatestDiscoveryHints(): AgentMemoryState['latestDiscoveryHints'] | undefined {
        return this.state.latestDiscoveryHints;
    }

    /** Discovery hints の有効期限切れ等で明示的にクリアする(現状は使わないが保守用)。 */
    clearLatestDiscoveryHints(): void {
        this.state.latestDiscoveryHints = undefined;
    }

    // --- 学習メモ（シンボル別管理） ---

    /**
     * シンボル別の SymbolLessons を取得（なければ初期化）
     */
    private getOrCreateSymbolLessons(symbol: string): SymbolLessons {
        let sl = this.state.lessonsBySymbol.get(symbol);
        if (!sl) {
            sl = { entries: [], consolidated: [] };
            this.state.lessonsBySymbol.set(symbol, sl);
        }
        return sl;
    }

    /**
     * 学びを追加（シンボル別 + AI類似判定 + 確信ルール昇格）
     *
     * @param lesson - 学びのテキスト
     * @param symbol - 対象シンボル
     * @param tradeId - 元トレードID（任意）
     * @param metadata - 付随メタデータ(Phase 5.5 以降、任意)
     */
    async addLesson(
        lesson: string,
        symbol: string,
        tradeId?: string,
        metadata?: LessonMetadata,
    ): Promise<void> {
        const sl = this.getOrCreateSymbolLessons(symbol);
        const now = new Date();

        // 1. 既存の entries + consolidated テキストと類似判定
        const allExistingTexts = [
            ...sl.entries.map(e => e.text),
            ...sl.consolidated.map(c => c.text),
        ];

        try {
            const similarResult = await lessonSimilarityService.findSimilar(lesson, allExistingTexts);

            if (similarResult) {
                const entriesCount = sl.entries.length;

                if (similarResult.index < entriesCount) {
                    // entries 内の既存レッスンと類似 → 確信ルールに昇格
                    const matchedEntry = sl.entries[similarResult.index];
                    const mergedText = similarResult.mergedText || lesson;

                    sl.consolidated.push({
                        text: mergedText,
                        symbol,
                        count: 2,
                        firstSeen: matchedEntry.addedAt,
                        lastSeen: now,
                        sourceTexts: [matchedEntry.text, lesson],
                    });

                    // 元の entry を削除（consolidated に移動したため）
                    sl.entries.splice(similarResult.index, 1);

                    console.log(`[AgentMemory] 📌 確信ルール昇格 [${symbol}]: "${mergedText}" (類似度${similarResult.similarity}%)`);
                    return;
                } else {
                    // consolidated 内の既存ルールと類似 → カウント増加
                    const consolidatedIndex = similarResult.index - entriesCount;
                    const existing = sl.consolidated[consolidatedIndex];

                    existing.count++;
                    existing.lastSeen = now;
                    existing.sourceTexts.push(lesson);
                    // 統合テキストが提供されていれば更新
                    if (similarResult.mergedText) {
                        existing.text = similarResult.mergedText;
                    }

                    console.log(`[AgentMemory] 📌 確信ルール強化 [${symbol}]: "${existing.text}" (${existing.count}回目, 類似度${similarResult.similarity}%)`);
                    return;
                }
            }
        } catch (error) {
            console.warn('[AgentMemory] 類似判定エラー（通常追加にフォールバック）:', error);
        }

        // 2. 類似なし → 通常の entry として追加
        sl.entries.push({
            text: lesson,
            symbol,
            tradeId,
            addedAt: now,
            metadata,
        });

        // 3. FIFO: max 30 件を超えたら古いものから削除
        if (sl.entries.length > MAX_ENTRIES_PER_SYMBOL) {
            sl.entries = sl.entries.slice(-MAX_ENTRIES_PER_SYMBOL);
        }

        console.log(`[AgentMemory] 📝 学習メモ追加 [${symbol}]: "${lesson}" (${sl.entries.length}/${MAX_ENTRIES_PER_SYMBOL})`);
    }

    /**
     * 全シンボル横断で lessons テキストを返す（後方互換）
     */
    getLessons(): string[] {
        const allLessons: string[] = [];
        for (const [, sl] of this.state.lessonsBySymbol) {
            for (const c of sl.consolidated) {
                allLessons.push(`📌 ${c.text}`);
            }
            for (const e of sl.entries) {
                allLessons.push(e.text);
            }
        }
        return allLessons;
    }

    /**
     * 特定シンボルの学びを取得
     */
    getLessonsForSymbol(symbol: string): SymbolLessons {
        return this.getOrCreateSymbolLessons(symbol);
    }

    /**
     * 全シンボルの学習データを取得（API用）
     */
    getAllLessonsBySymbol(): Map<string, SymbolLessons> {
        return this.state.lessonsBySymbol;
    }

    /**
     * 学習統計を取得
     */
    getLessonStats(): { totalEntries: number; totalConsolidated: number; symbolCount: number } {
        let totalEntries = 0;
        let totalConsolidated = 0;
        for (const [, sl] of this.state.lessonsBySymbol) {
            totalEntries += sl.entries.length;
            totalConsolidated += sl.consolidated.length;
        }
        return {
            totalEntries,
            totalConsolidated,
            symbolCount: this.state.lessonsBySymbol.size,
        };
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
     * 
     * 優先順位:
     * 1. 📌 そのシンボルの確信ルール（consolidated）← 最優先
     * 2. 📝 そのシンボルの直近 entries（最新 10 件）
     * 3. 💡 他シンボルの確信ルール（クロスシンボル学習）
     * 4. 💬 直近の負けトレードの振り返り
     */
    getLessonsForStrategy(symbol?: string): string[] {
        const lessons: string[] = [];
        const targetSymbol = symbol || this.state.watchSymbols[0] || 'XAUUSD';
        const targetSL = this.state.lessonsBySymbol.get(targetSymbol);

        // 1. そのシンボルの確信ルール
        if (targetSL) {
            for (const c of targetSL.consolidated) {
                lessons.push(`📌 [確信ルール/${c.symbol}] ${c.text} (${c.count}回確認)`);
            }
        }

        // 2. そのシンボルの直近 entries（最新 10 件）
        if (targetSL) {
            const recentEntries = targetSL.entries.slice(-10);
            for (const e of recentEntries) {
                lessons.push(`📝 [${e.symbol}] ${e.text}`);
            }
        }

        // 3. 他シンボルの確信ルール（クロスシンボル学習）
        for (const [sym, sl] of this.state.lessonsBySymbol) {
            if (sym === targetSymbol) continue;
            for (const c of sl.consolidated) {
                lessons.push(`💡 [他銘柄/${c.symbol}] ${c.text} (${c.count}回確認)`);
            }
        }

        // 4. 直近の負けトレードからの学び
        const recentLosses = this.state.recentTradeResults
            .filter(r => r.outcome === 'loss')
            .slice(0, 3);

        for (const loss of recentLosses) {
            if (loss.reflection) {
                lessons.push(`💬 [直近の損失/${loss.symbol}] ${loss.reflection}`);
            }
        }

        return lessons;
    }

    /**
     * Filter Evolution Phase D-1a (2026-05-09): 世代単位 reflection lessons を取得する。
     *
     * `GenerationReflectionAgent` (= Phase D-1b 以降に実装) が `GenerationLesson` テーブルへ
     * 永続化した lessons を、mutation/crossover の prompt 注入用に整形して返す。
     *
     * 整形: `getLessonsForStrategy` と同じく emoji prefix で人間語に統一する。
     *   - 🎯 [breakthrough/breakout gen=3] Gen 3 で time_session filter で promotion top-K に到達
     *   - 📉 [stagnation/breakout gen=4] mutation 由来 child の Lift がほぼ全て 1.0
     *
     * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.D / §5.E.2
     *
     * @param options - regime / limit / lessonRepo (test 用 inject)
     * @returns 整形済み lesson 文字列の配列。DB 取得失敗時は空配列 + warning ログで fallback。
     */
    async getGenerationLessons(options?: {
        readonly regime?: string;
        readonly limit?: number;
        /** test 互換 / DI 用。未指定なら本番 prisma 経由の repo singleton を使う。 */
        readonly lessonRepo?: GenerationLessonPersister;
    }): Promise<string[]> {
        const repo = options?.lessonRepo ?? defaultGenerationLessonRepo;
        const limit = options?.limit ?? 10;
        try {
            let records: GenerationLessonRecord[];
            if (options?.regime) {
                records = await repo.findRecentByRegime(options.regime, limit);
            } else {
                // regime 未指定 = cross-symbol 学習 / 全体観察。findRecent は repo に存在するが
                // GenerationLessonPersister Pick 経由では見えないため、findRecentByRegime に
                // 'all-regimes-marker' のような特殊文字列は使わず、lessonRepo に findRecent も
                // 含めるよう Persister 型を拡張するべき場面 — Phase D-1b で必要に応じて拡張する。
                // 現状は regime 指定必須で運用 (= mutation/crossover も symbol→regime で限定するため)。
                console.warn(
                    '[AgentMemory.getGenerationLessons] regime 未指定の呼び出しは現状サポート外、空配列を返す',
                );
                return [];
            }

            return records.map((r) => emojiForCategory(r.category) +
                ` [${r.category}/${r.regime} gen=${r.generation}] ${r.lesson}`,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
                `[AgentMemory.getGenerationLessons] DB 取得失敗、空配列で fallback: ${msg}`,
            );
            return [];
        }
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

/**
 * Filter Evolution Phase D-1a: GenerationLessonCategory に対応する emoji prefix を返す。
 *
 * `getLessonsForStrategy` の emoji 体系 (📌 / 📝 / 💡 / 💬) と区別できる新カテゴリ:
 *   - 🎯 breakthrough         (= 突破)
 *   - 📉 stagnation           (= 停滞)
 *   - 🔻 mutation_decay       (= mutation 由来 child の Lift 停滞)
 *   - ✨ novelty_emerged      (= 新規パターン出現)
 *   - 🌪 regime_shift_detected (= regime 切替検出)
 *   - 🧪 filter_efficacy_increased (= filter 効果上昇)
 *   - 🌀 other / fallback     (= 想定外カテゴリ)
 *
 * PR #144 Copilot review #2: 引数を `GenerationLessonCategory` union 型にすることで、
 * カテゴリ追加時にコンパイルエラーで取りこぼしを検知できる (= switch の網羅性チェック)。
 */
function emojiForCategory(category: GenerationLessonCategory): string {
    switch (category) {
        case 'breakthrough':
            return '🎯';
        case 'stagnation':
            return '📉';
        case 'mutation_decay':
            return '🔻';
        case 'novelty_emerged':
            return '✨';
        case 'regime_shift_detected':
            return '🌪';
        case 'filter_efficacy_increased':
            return '🧪';
        case 'other':
            return '🌀';
        default: {
            // 網羅性チェック: 新カテゴリ追加時に never 型違反でコンパイルエラーになる
            const _exhaustive: never = category;
            return _exhaustive;
        }
    }
}

// シングルトンインスタンス
export const agentMemory = new AgentMemory();
