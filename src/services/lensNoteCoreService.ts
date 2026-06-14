/**
 * LensNoteCoreService — Note コア行の生成とレンズ類似度シャドー評価
 *
 * 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §7-§9
 *
 * 責務:
 * 1. Side-A ノート作成時に Note コア行(lensSnapshot + userId + 来歴)を生成する
 * 2. 【移行戦略 §9-2 シャドー評価】アクティブノートをレンズ類似度で評価し、
 *    結果を観測ログとして出力する。**通知挙動には一切影響しない**(旧マッチングと並行)。
 *    切替(§9-3)の妥当性判断材料になる
 *
 * 市場側スナップショットの指標レンズは、ノート側 lensSnapshot に保存された lensId
 * 集合から逆解決する(parseIndicatorLensId)。これにより「同じ Profile・同じ params」
 * (§5.3)の比較がプロファイルの現在状態に依存せず成立する。
 */

import type { TradeNote as PrismaTradeNote, TradeSide } from '@prisma/client';
import { LensSnapshotBuilder } from './lensSnapshotBuilder';
import { NoteCoreRepository } from '../backend/repositories/noteCoreRepository';
import { TradeNoteService } from './tradeNoteService';
import {
  parseIndicatorLensId,
  resolveIndicatorLensSpecs,
  INDICATOR_LENS_PREFIX,
  type IndicatorLensSourceConfig,
  type IndicatorLensSpec,
} from '../shared/similarity/indicatorLenses';
import {
  parseNoteLensSnapshot,
  type JsonLike,
  type NoteLensSnapshot,
} from '../shared/similarity/lensSnapshotTypes';
import {
  compareLensSnapshots,
  type SimilarityMatchLevel,
  type SnapshotSimilarityResult,
} from '../shared/similarity/similarityEngine';
import { NotificationPreferenceService } from './notification/notificationPreferenceService';
import type { EffectiveNotificationPreference } from './notification/notificationPreferenceService';

/** Side-A ノート作成時の Note コア生成入力 */
export interface CreateSideANoteCoreInput {
  readonly tradeNoteId: string;
  readonly userId: string;
  readonly symbol: string;
  readonly side: TradeSide;
  readonly timeframe: string;
  readonly entryPrice?: number;
  /** トレード時刻(= lensSnapshot.eventTime) */
  readonly eventTime: Date;
  /** プロファイルのインジケーター設定(空 = 状態レンズのみ) */
  readonly indicatorConfigs: ReadonlyArray<IndicatorLensSourceConfig>;
  readonly correlationId?: string;
}

/** Note コア生成の結果 */
export interface CreateSideANoteCoreResult {
  readonly noteCoreId: string;
  /** lensSnapshot が生成できたか(false = null で登録、バックフィル対象) */
  readonly snapshotGenerated: boolean;
  readonly warnings: string[];
}

/** シャドー評価のノート単位の結果 */
export interface LensShadowNoteResult {
  readonly tradeNoteId: string;
  readonly symbol: string;
  readonly comparable: boolean;
  readonly score: number | null;
  readonly level: SimilarityMatchLevel | null;
  readonly triggered: boolean;
  readonly skipReason?: string;
}

/** ノート単位のレンズ評価詳細(マッチング/シャドー共用。Phase α-3) */
export interface LensNoteEvaluation {
  /** 評価対象ノート(マッチング側で MatchResult/EvaluationLog 永続化に使う) */
  readonly note: PrismaTradeNote;
  /** 評価に使った時間足(ノート未設定時は '15m' 既定) */
  readonly timeframe: string;
  /** レンズ比較結果(score/level/triggered/threshold/breakdown) */
  readonly comparison: SnapshotSimilarityResult;
  /**
   * 解決済みの通知粒度設定 (Phase β-2a)。マッチング側がクールダウン等を
   * 通知トリガ判定へ引き渡すために載せる。解決失敗時は undefined (既定動作)
   */
  readonly preference?: EffectiveNotificationPreference;
}

/** レンズ評価実行全体の詳細結果(Phase α-3 マッチング切替の入力) */
export interface LensEvaluationDetail {
  /** 対象になったアクティブノート数 */
  readonly activeNotes: number;
  /** lensSnapshot を持っていたノート数 */
  readonly notesWithSnapshot: number;
  /** 評価したシンボル × 時間足グループ数 */
  readonly symbols: number;
  /** ノート単位の評価結果(lensSnapshot 無しのノートは含まれない) */
  readonly evaluations: LensNoteEvaluation[];
  /** シンボル単位の評価エラー(非致命) */
  readonly errors: string[];
}

/** シャドー評価のサマリー(MatchingPipelineRunResult に additive に載せる) */
export interface LensShadowSummary {
  /** 対象になったアクティブノート数 */
  readonly activeNotes: number;
  /** lensSnapshot を持っていたノート数 */
  readonly notesWithSnapshot: number;
  /** 比較が成立したノート数 */
  readonly comparable: number;
  /** しきい値を超えた(レンズ基盤なら通知候補になっていた)ノート数 */
  readonly triggered: number;
  /** 評価したシンボル数 */
  readonly symbols: number;
  /** 比較成立ノートの平均スコア(なければ null) */
  readonly averageScore: number | null;
  /** シンボル単位の評価エラー(非致命) */
  readonly errors: string[];
}

/** LensNoteCoreService の依存(テスト差し替え用) */
export interface LensNoteCoreServiceDeps {
  builder?: Pick<LensSnapshotBuilder, 'build'>;
  noteCoreRepository?: Pick<
    NoteCoreRepository,
    'upsertForTradeNote' | 'findByTradeNoteIds'
  >;
  tradeNoteService?: Pick<TradeNoteService, 'loadActiveNotesForMatchingAsPrisma'>;
  /** 通知粒度設定の解決 (Phase β-2a)。テストで差し替え可能 */
  preferenceService?: Pick<NotificationPreferenceService, 'resolveForNotes'>;
}

export class LensNoteCoreService {
  private readonly builder: Pick<LensSnapshotBuilder, 'build'>;
  private readonly noteCoreRepository: Pick<
    NoteCoreRepository,
    'upsertForTradeNote' | 'findByTradeNoteIds'
  >;
  private readonly tradeNoteService: Pick<TradeNoteService, 'loadActiveNotesForMatchingAsPrisma'>;
  private readonly preferenceService: Pick<NotificationPreferenceService, 'resolveForNotes'>;

  constructor(deps: LensNoteCoreServiceDeps = {}) {
    this.builder = deps.builder ?? new LensSnapshotBuilder();
    this.noteCoreRepository = deps.noteCoreRepository ?? new NoteCoreRepository();
    this.tradeNoteService = deps.tradeNoteService ?? new TradeNoteService();
    this.preferenceService = deps.preferenceService ?? new NotificationPreferenceService();
  }

  /**
   * Side-A TradeNote に対応する Note コア行を生成する(冪等)。
   * snapshot 生成に失敗しても Note 行は lensSnapshot=null で登録し、
   * 後からバックフィルできるようにする(取り込みフローを止めない)。
   */
  async createForSideATradeNote(
    input: CreateSideANoteCoreInput
  ): Promise<CreateSideANoteCoreResult> {
    const specs = resolveIndicatorLensSpecs(input.indicatorConfigs);
    let snapshot: NoteLensSnapshot | null = null;
    const warnings: string[] = [];
    try {
      const buildResult = await this.builder.build({
        symbol: input.symbol,
        timeframe: input.timeframe,
        eventTime: input.eventTime,
        indicatorSpecs: specs,
        ensureCoverage: true,
        ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
      });
      snapshot = buildResult.snapshot;
      warnings.push(...buildResult.warnings);
    } catch (error) {
      warnings.push(
        `lensSnapshot 生成に失敗(null で登録、バックフィル対象): ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }

    const row = await this.noteCoreRepository.upsertForTradeNote({
      tradeNoteId: input.tradeNoteId,
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      timeframe: input.timeframe,
      ...(input.entryPrice !== undefined ? { entryPrice: input.entryPrice } : {}),
      eventTime: input.eventTime,
      lensSnapshot: snapshot,
    });

    return {
      noteCoreId: row.id,
      snapshotGenerated: snapshot !== null,
      warnings,
    };
  }

  /**
   * 【マッチング評価】渡されたノート群をレンズ類似度で評価し、ノート単位の詳細を返す。
   *
   * Phase α-3(移行戦略 §9-3): MatchingService の本番マッチング経路(MATCHING_ENGINE=lens)
   * がこの結果から MatchResult/EvaluationLog/通知を生成する。
   * 評価エラーはシンボル単位で握り、他シンボルの評価を継続する。
   */
  async evaluateNotesForMatching(
    notes: ReadonlyArray<PrismaTradeNote>
  ): Promise<LensEvaluationDetail> {
    return this.evaluateNotesDetailed(notes, {
      logPrefix: '[LensMatching]',
      ensureCoverage: process.env.LENS_MATCHING_ENSURE_COVERAGE !== 'false',
    });
  }

  /**
   * 【シャドー評価】アクティブノート(マッチング対象)をレンズ類似度で評価する。
   *
   * 旧マッチングの通知判定には影響しない。観測ログ(console)とサマリーを返すのみ。
   * 評価エラーはシンボル単位で握り、他シンボルの評価を継続する。
   */
  async shadowEvaluateActiveNotes(): Promise<LensShadowSummary> {
    const notes = await this.tradeNoteService.loadActiveNotesForMatchingAsPrisma();
    if (notes.length === 0) {
      return {
        activeNotes: 0,
        notesWithSnapshot: 0,
        comparable: 0,
        triggered: 0,
        symbols: 0,
        averageScore: null,
        errors: [],
      };
    }

    const detail = await this.evaluateNotesDetailed(notes, {
      logPrefix: '[LensShadow]',
      ensureCoverage: process.env.LENS_SHADOW_ENSURE_COVERAGE !== 'false',
    });

    const comparableResults = detail.evaluations.filter(
      (e) => e.comparison.comparable && e.comparison.score !== null
    );
    const averageScore =
      comparableResults.length > 0
        ? comparableResults.reduce((sum, e) => sum + (e.comparison.score ?? 0), 0) /
          comparableResults.length
        : null;

    return {
      activeNotes: detail.activeNotes,
      notesWithSnapshot: detail.notesWithSnapshot,
      comparable: comparableResults.length,
      triggered: detail.evaluations.filter((e) => e.comparison.triggered).length,
      symbols: detail.symbols,
      averageScore,
      errors: detail.errors,
    };
  }

  /**
   * マッチング/シャドー共用のレンズ評価コア。
   *
   * 1. Note コア行から lensSnapshot を一括取得
   * 2. シンボル × 時間足でグループ化(市場側 snapshot を 1 回だけ生成するため)
   * 3. ノート側 lensId 集合から市場側に必要な指標レンズ仕様を逆解決して比較
   */
  private async evaluateNotesDetailed(
    notes: ReadonlyArray<PrismaTradeNote>,
    options: { logPrefix: string; ensureCoverage: boolean }
  ): Promise<LensEvaluationDetail> {
    const errors: string[] = [];

    // 通知粒度設定 (しきい値 / 一致レベル) をノート単位で一括解決する (Phase β-2a)。
    // 解決失敗時はシステム既定 (従来挙動) で評価を継続する
    let preferenceByNoteId = new Map<string, EffectiveNotificationPreference>();
    try {
      preferenceByNoteId = await this.preferenceService.resolveForNotes(
        notes.map((n) => ({ id: n.id, userId: n.userId }))
      );
    } catch (prefError) {
      console.warn(
        `${options.logPrefix} 通知設定の解決に失敗(システム既定で継続):`,
        prefError
      );
    }

    // Note コア行(lensSnapshot)をまとめて取得
    const coreRows = await this.noteCoreRepository.findByTradeNoteIds(notes.map((n) => n.id));
    const snapshotByTradeNoteId = new Map<string, NoteLensSnapshot>();
    for (const row of coreRows) {
      if (row.tradeNoteId === null) {
        continue;
      }
      const parsed = parseNoteLensSnapshot(row.lensSnapshot as JsonLike);
      if (parsed !== null) {
        snapshotByTradeNoteId.set(row.tradeNoteId, parsed);
      }
    }

    // シンボル × 時間足でグループ化(市場側 snapshot を 1 回だけ生成するため)
    const groups = new Map<string, { symbol: string; timeframe: string; notes: PrismaTradeNote[] }>();
    for (const note of notes) {
      const timeframe = note.timeframe ?? '15m';
      const key = `${note.symbol}__${timeframe}`;
      const group = groups.get(key) ?? { symbol: note.symbol, timeframe, notes: [] };
      group.notes.push(note);
      groups.set(key, group);
    }

    const evaluations: LensNoteEvaluation[] = [];
    let notesWithSnapshot = 0;

    for (const group of groups.values()) {
      const groupSnapshots = group.notes
        .map((note) => ({ note, snapshot: snapshotByTradeNoteId.get(note.id) }))
        .filter(
          (item): item is { note: PrismaTradeNote; snapshot: NoteLensSnapshot } =>
            item.snapshot !== undefined
        );
      notesWithSnapshot += groupSnapshots.length;
      if (groupSnapshots.length === 0) {
        continue;
      }

      try {
        // ノート側 lensId 集合から市場側に必要な指標レンズ仕様を逆解決
        const specsByLensId = new Map<string, IndicatorLensSpec>();
        for (const { snapshot } of groupSnapshots) {
          for (const lensId of Object.keys(snapshot.lenses)) {
            if (!lensId.startsWith(INDICATOR_LENS_PREFIX) || specsByLensId.has(lensId)) {
              continue;
            }
            const spec = parseIndicatorLensId(lensId);
            if (spec !== null) {
              specsByLensId.set(lensId, spec);
            }
          }
        }

        // 市場側のカバレッジ/鮮度の自己回復は既定 ON。
        // builder の補完フェッチは「最終バー以降のギャップ分のみ」(15 分 cron なら数本)で、
        // 旧マッチング経路が毎サイクル行う EODHD 取得と同等以下の負荷。レート制限が
        // 問題になった場合は LENS_SHADOW_ENSURE_COVERAGE / LENS_MATCHING_ENSURE_COVERAGE
        // =false で DB キャッシュのみの評価に切り替えられる
        // (その場合は鮮度低下が warnings/精度に現れる)。
        const marketResult = await this.builder.build({
          symbol: group.symbol,
          timeframe: group.timeframe,
          eventTime: new Date(),
          indicatorSpecs: [...specsByLensId.values()],
          ensureCoverage: options.ensureCoverage,
        });
        if (marketResult.snapshot === null) {
          errors.push(
            `市場側 snapshot を生成できませんでした: ${group.symbol} ${group.timeframe}` +
              (marketResult.warnings.length > 0 ? ` (${marketResult.warnings[0]})` : '')
          );
          continue;
        }

        for (const { note, snapshot } of groupSnapshots) {
          // ユーザー設定の有効しきい値 (threshold と一致レベル帯下限の大きい方) で発火判定する。
          // 設定が無いノートはシステム既定 = 従来挙動 (Phase β-2a)
          const preference = preferenceByNoteId.get(note.id);
          const comparison = compareLensSnapshots(
            snapshot,
            marketResult.snapshot,
            preference !== undefined ? { threshold: preference.effectiveThreshold } : undefined
          );
          evaluations.push({
            note,
            timeframe: group.timeframe,
            comparison,
            ...(preference !== undefined ? { preference } : {}),
          });
          console.log(
            `${options.logPrefix} noteId=${note.id} symbol=${group.symbol} ` +
              `score=${comparison.score === null ? 'n/a' : comparison.score.toFixed(3)} ` +
              `level=${comparison.level ?? 'n/a'} triggered=${comparison.triggered} ` +
              `lenses=${comparison.breakdown.length}/${comparison.commonLensCount}` +
              (comparison.skipReason ? ` skip=${comparison.skipReason}` : '')
          );
        }
      } catch (error) {
        errors.push(
          `${group.symbol} ${group.timeframe} のレンズ評価に失敗: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      activeNotes: notes.length,
      notesWithSnapshot,
      symbols: groups.size,
      evaluations,
      errors,
    };
  }
}
