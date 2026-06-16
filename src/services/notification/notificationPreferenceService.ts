/**
 * 通知粒度のユーザー設定サービス (Phase β-2a)
 *
 * 目的:
 * - NotificationPreference (scope=user/profile/note/strategy) の CRUD
 * - マッチングパイプライン向けの「有効設定」解決 (note > user > システム既定)
 * - 条件アラート向けの「有効設定」解決 (strategy > user > システム既定)
 *
 * 階層解決の方針 (completion-roadmap 決定4 / NOTE_SIMILARITY_FOUNDATION §6.3-6.4):
 * - 項目ごとに最も近いスコープの非 NULL 値を採用する (部分上書き)
 * - ノートマッチ: note > user > システム既定
 * - 条件アラート: strategy > user > システム既定
 * - profile スコープは DB には存在するが、TradeNote に profileId が永続されていないため
 *   現時点では解決対象外。ノート→プロファイル紐付け導入後に note/profile/user の順へ拡張する
 * - maxPerDay は per-user 通知カウントで実際に適用する
 *
 * 新規ファイルの理由: 通知設定の解決は柱1 (ノートマッチ) と柱2 (条件アラート) の
 * 共通層になる恒久的な責務で、既存サービス (トリガ判定/送信) とは関心が異なる。
 */

import type { PrismaClient, NotificationPreference, SimilarityMatchLevel } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import {
  DEFAULT_SIMILARITY_TRIGGER_THRESHOLD,
  DEFAULT_SIMILARITY_LEVELS,
} from '../../shared/similarity/similarityEngine';

type NotificationPreferencePrismaClient = Pick<
  PrismaClient,
  'notificationPreference' | 'tradeNote' | 'strategy'
>;

/** クールダウン既定 (NotificationTriggerService と同じ env を参照して一貫させる)。
 * env が不正値 (NaN / 非正数) の場合は安全な既定 1 時間にフォールバックする */
const PARSED_COOLDOWN_MS = parseInt(process.env.NOTIFICATION_COOLDOWN_MS || '3600000', 10);
const DEFAULT_COOLDOWN_MS =
  Number.isFinite(PARSED_COOLDOWN_MS) && PARSED_COOLDOWN_MS > 0 ? PARSED_COOLDOWN_MS : 3600000;
/** 24時間あたり通知上限のシステム既定。env が不正な場合は従来値 30 に戻す。 */
const PARSED_MAX_PER_DAY = parseInt(process.env.DAILY_NOTIFICATION_LIMIT || '30', 10);
export const DEFAULT_MAX_NOTIFICATIONS_PER_DAY =
  Number.isFinite(PARSED_MAX_PER_DAY) && PARSED_MAX_PER_DAY > 0 ? PARSED_MAX_PER_DAY : 30;

/** maxPerDay をどの scope から採用したかを skip reason に残すための値。 */
export type NotificationPreferenceLimitSource = 'note' | 'profile' | 'strategy' | 'user' | 'system';

type MergePreferenceScope = 'note' | 'strategy';

type PreferenceMergeFields = Pick<
  NotificationPreference,
  'threshold' | 'minMatchLevel' | 'cooldownMinutes' | 'maxPerDay'
>;

/**
 * 階層解決後の「実際に効く」通知設定。
 * 全フィールドが解決済み (システム既定で埋まる) であることを型で保証する。
 */
export interface EffectiveNotificationPreference {
  /** 類似度スコアしきい値 (0〜1) */
  threshold: number;
  /** 通知する最小一致レベル */
  minMatchLevel: SimilarityMatchLevel;
  /** 再通知クールダウン (ミリ秒) */
  cooldownMs: number;
  /** 24時間あたりの通知上限。null はここに来る前にシステム既定で埋める */
  maxPerDay: number;
  /** maxPerDay を採用した scope。運用時の skip reason に残す */
  maxPerDaySource: NotificationPreferenceLimitSource;
  /**
   * レンズ比較エンジンへ渡す有効しきい値。
   * minMatchLevel の帯下限 (strong 0.9 / medium 0.8 / weak 0.7) と threshold の
   * 大きい方。エンジンの triggered = score >= threshold の意味論を変えずに
   * 「このレベル以上で通知」を実現する (§6.4 一致レベル)。
   */
  effectiveThreshold: number;
}

/** upsert 入力 (scope と対象 ID の組はルート層で検証済みであること) */
export interface UpsertPreferenceInput {
  scope: 'user' | 'note' | 'strategy';
  /** scope=note のときの対象ノート ID */
  noteId?: string;
  /** scope=strategy のときの対象ストラテジー ID (Phase γ: 条件アラート粒度) */
  strategyId?: string;
  threshold?: number | null;
  minMatchLevel?: SimilarityMatchLevel | null;
  cooldownMinutes?: number | null;
  maxPerDay?: number | null;
}

/** 条件アラート (柱2) 向けの解決結果。柱2 は二値判定 (matchScore=1.0) のため
 *  threshold/minMatchLevel は実質 no-op で、cooldown のみ通知粒度として効く。
 *  cooldownMinutes が null のときは呼び出し側で StrategyAlert 固有値にフォールバックする。 */
export interface StrategyEffectivePreference {
  /** strategy/user スコープで明示設定された再通知クールダウン (分)。未設定は null */
  cooldownMinutes: number | null;
  /** 全項目解決済みの有効設定 (将来 柱1/柱2 合流時に threshold 等も使う) */
  effective: EffectiveNotificationPreference;
}

/** システム既定の解決値 (設定行が 1 つも無いときの挙動 = 従来挙動) */
export function systemDefaultPreference(): EffectiveNotificationPreference {
  return {
    threshold: DEFAULT_SIMILARITY_TRIGGER_THRESHOLD,
    minMatchLevel: 'weak',
    cooldownMs: DEFAULT_COOLDOWN_MS,
    maxPerDay: DEFAULT_MAX_NOTIFICATIONS_PER_DAY,
    maxPerDaySource: 'system',
    effectiveThreshold: Math.max(
      DEFAULT_SIMILARITY_TRIGGER_THRESHOLD,
      DEFAULT_SIMILARITY_LEVELS.weak
    ),
  };
}

/**
 * note スコープ → user スコープ → システム既定 の順で項目ごとにマージする (純粋関数)。
 * テスト容易性のため DB アクセスから分離。
 */
export function mergePreferences(
  scopedPref: PreferenceMergeFields | null,
  userPref: PreferenceMergeFields | null,
  scopedPrefScope: MergePreferenceScope = 'note'
): EffectiveNotificationPreference {
  const defaults = systemDefaultPreference();

  const threshold = scopedPref?.threshold ?? userPref?.threshold ?? defaults.threshold;
  const minMatchLevel = scopedPref?.minMatchLevel ?? userPref?.minMatchLevel ?? defaults.minMatchLevel;
  const cooldownMinutes = scopedPref?.cooldownMinutes ?? userPref?.cooldownMinutes ?? null;
  const cooldownMs = cooldownMinutes !== null ? cooldownMinutes * 60 * 1000 : defaults.cooldownMs;
  const maxPerDay = scopedPref?.maxPerDay ?? userPref?.maxPerDay ?? defaults.maxPerDay;
  const maxPerDaySource =
    scopedPref?.maxPerDay !== null && scopedPref?.maxPerDay !== undefined
      ? scopedPrefScope
      : userPref?.maxPerDay !== null && userPref?.maxPerDay !== undefined
        ? 'user'
        : defaults.maxPerDaySource;

  // 一致レベルの帯下限としきい値の大きい方をエンジンへ渡す (§6.4)
  const levelFloor = DEFAULT_SIMILARITY_LEVELS[minMatchLevel];
  const effectiveThreshold = Math.max(threshold, levelFloor);

  return { threshold, minMatchLevel, cooldownMs, maxPerDay, maxPerDaySource, effectiveThreshold };
}

/**
 * 通知粒度設定の CRUD + 解決サービス
 */
export class NotificationPreferenceService {
  private prisma: NotificationPreferencePrismaClient;

  constructor(prismaClient?: NotificationPreferencePrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * ユーザーの全設定行を取得 (設定 UI 用)
   */
  async listPreferences(userId: string): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 設定を upsert する。
   * user スコープは複合 unique が NULL 列で効かない (PostgreSQL の NULL distinct) ため、
   * findFirst → update/create で一意性をサービス層が担保する。
   */
  async upsertPreference(userId: string, input: UpsertPreferenceInput): Promise<NotificationPreference> {
    // scope=note は noteId 必須 (Zod でも検証するが、サービス単体でも安全にする。
    // 未指定のまま進むと findFirst の id 条件が落ちて所有チェックをすり抜ける)
    if (input.scope === 'note') {
      if (input.noteId === undefined) {
        throw new Error('scope=note では noteId が必須です');
      }
      // 対象ノートの所有チェック (他ユーザーのノートへの設定登録を防ぐ。Phase α-4 と同方針)
      const ownedNote = await this.prisma.tradeNote.findFirst({
        where: { id: input.noteId, userId },
        select: { id: true },
      });
      if (!ownedNote) {
        throw new Error('ノートが見つかりませんでした');
      }
    }
    // scope=strategy は strategyId 必須 + 所有チェック (Phase γ: 条件アラート粒度)
    if (input.scope === 'strategy') {
      if (input.strategyId === undefined) {
        throw new Error('scope=strategy では strategyId が必須です');
      }
      const ownedStrategy = await this.prisma.strategy.findFirst({
        where: { id: input.strategyId, userId },
        select: { id: true },
      });
      if (!ownedStrategy) {
        throw new Error('ストラテジーが見つかりませんでした');
      }
    }

    const where =
      input.scope === 'note'
        ? { userId, scope: 'note' as const, noteId: input.noteId }
        : input.scope === 'strategy'
          ? { userId, scope: 'strategy' as const, strategyId: input.strategyId }
          : { userId, scope: 'user' as const };

    // 省略 (undefined) は「現状維持」、明示 null は「既定に戻す」。
    // 省略フィールドまで null 上書きすると既存設定が意図せず消える (Copilot レビュー対応)
    const data = {
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
      ...(input.minMatchLevel !== undefined ? { minMatchLevel: input.minMatchLevel } : {}),
      ...(input.cooldownMinutes !== undefined ? { cooldownMinutes: input.cooldownMinutes } : {}),
      ...(input.maxPerDay !== undefined ? { maxPerDay: input.maxPerDay } : {}),
    };

    const existing = await this.prisma.notificationPreference.findFirst({ where, select: { id: true } });
    if (existing) {
      return this.prisma.notificationPreference.update({
        where: { id: existing.id },
        data,
      });
    }
    try {
      return await this.prisma.notificationPreference.create({
        data: {
          userId,
          scope: input.scope,
          noteId: input.scope === 'note' ? input.noteId : undefined,
          strategyId: input.scope === 'strategy' ? input.strategyId : undefined,
          ...data,
        },
      });
    } catch (error) {
      // 同時リクエストの競合: scope 別 partial unique index (migration 参照) に
      // 弾かれたら、勝った行への update にフォールバックする
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.notificationPreference.findFirst({ where, select: { id: true } });
        if (winner) {
          return this.prisma.notificationPreference.update({ where: { id: winner.id }, data });
        }
      }
      throw error;
    }
  }

  /**
   * 設定行を削除する (所有ユーザーのもののみ)
   */
  async deletePreference(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.notificationPreference.deleteMany({
      where: { id, userId },
    });
    return result.count > 0;
  }

  /**
   * マッチング対象ノート群の「有効設定」を一括解決する (パイプライン用)。
   *
   * 1 クエリで関係する全設定行 (対象ノートの note スコープ + 関係ユーザーの user スコープ)
   * を取得し、ノート ID → 解決済み設定 の Map を返す。設定が無いノートはシステム既定。
   * cron (ユーザー横断) でも N+1 にならない。
   *
   * profile スコープは現時点では対象外。TradeNote に profileId が永続されていないため、
   * ここで推測解決すると別プロファイルの設定を誤適用するリスクがある。
   */
  async resolveForNotes(
    notes: ReadonlyArray<{ id: string; userId: string | null }>
  ): Promise<Map<string, EffectiveNotificationPreference>> {
    const result = new Map<string, EffectiveNotificationPreference>();
    if (notes.length === 0) return result;

    const noteIds = notes.map((n) => n.id);
    const userIds = [...new Set(notes.map((n) => n.userId).filter((u): u is string => u !== null))];

    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        OR: [
          { scope: 'note', noteId: { in: noteIds } },
          ...(userIds.length > 0 ? [{ scope: 'user' as const, userId: { in: userIds } }] : []),
        ],
      },
    });

    const noteScoped = new Map<string, NotificationPreference>();
    const userScoped = new Map<string, NotificationPreference>();
    for (const row of rows) {
      if (row.scope === 'note' && row.noteId !== null) {
        noteScoped.set(row.noteId, row);
      } else if (row.scope === 'user') {
        userScoped.set(row.userId, row);
      }
    }

    for (const note of notes) {
      const notePref = noteScoped.get(note.id) ?? null;
      const userPref = note.userId !== null ? userScoped.get(note.userId) ?? null : null;
      result.set(note.id, mergePreferences(notePref, userPref));
    }
    return result;
  }

  /**
   * 条件アラート (柱2) 向けの「有効設定」を解決する (Phase γ)。
   * strategy スコープ > user スコープ の順でマージする。
   *
   * 柱2 は条件成立=二値判定 (triggerAlert に matchScore=1.0 が渡る) のため、
   * threshold/minMatchLevel は実質 no-op。意味を持つのは cooldown なので、
   * 明示設定された cooldownMinutes を生値で返し (未設定は null)、呼び出し側で
   * StrategyAlert 固有の cooldownMinutes にフォールバックさせる (既存挙動を壊さない)。
   */
  async resolveForStrategy(
    strategyId: string,
    userId: string | null,
  ): Promise<StrategyEffectivePreference> {
    // 所有者不明 (レガシー行で userId=null) は設定行を引けないので既定で返す。
    // NotificationPreference.userId は必須列のため、所有者不明では設定が存在し得ない。
    // (DB 問い合わせ自体を省くことで、所有者なしアラートの発火経路を軽量に保つ)
    if (userId === null) {
      return { cooldownMinutes: null, effective: mergePreferences(null, null) };
    }
    // strategy スコープも userId で絞る: partial unique index (userId, strategyId) を活かし、
    // かつ他ユーザーの strategy 設定を誤って拾わないようにする (Copilot review PR #397)。
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        OR: [
          { scope: 'strategy', strategyId, userId },
          { scope: 'user', userId },
        ],
      },
    });

    let strategyPref: NotificationPreference | null = null;
    let userPref: NotificationPreference | null = null;
    for (const row of rows) {
      if (row.scope === 'strategy' && row.strategyId === strategyId) {
        strategyPref = row;
      } else if (row.scope === 'user') {
        userPref = row;
      }
    }

    return {
      cooldownMinutes: strategyPref?.cooldownMinutes ?? userPref?.cooldownMinutes ?? null,
      effective: mergePreferences(strategyPref, userPref, 'strategy'),
    };
  }
}
