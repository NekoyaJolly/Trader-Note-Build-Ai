/**
 * 通知粒度のユーザー設定サービス (Phase β-2a)
 *
 * 目的:
 * - NotificationPreference (scope=user/profile/note/strategy) の CRUD
 * - マッチングパイプライン向けの「有効設定」解決 (note > user > システム既定)
 *
 * 階層解決の方針 (completion-roadmap 決定4 / NOTE_SIMILARITY_FOUNDATION §6.3-6.4):
 * - 項目ごとに最も近いスコープの非 NULL 値を採用する (部分上書き)
 * - β-2a で配線するのは note / user スコープ。profile スコープはノート→プロファイル
 *   紐付けの導入後、strategy スコープは Phase γ (条件アラート) で配線する
 * - maxPerDay は保存/取得のみ (per-user 通知カウント源の整備後に配線)
 *
 * 新規ファイルの理由: 通知設定の解決は柱1 (ノートマッチ) と柱2 (条件アラート) の
 * 共通層になる恒久的な責務で、既存サービス (トリガ判定/送信) とは関心が異なる。
 */

import type { PrismaClient, NotificationPreference, SimilarityMatchLevel } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import {
  DEFAULT_SIMILARITY_TRIGGER_THRESHOLD,
  DEFAULT_SIMILARITY_LEVELS,
} from '../../shared/similarity/similarityEngine';

/** クールダウン既定 (NotificationTriggerService と同じ env を参照して一貫させる) */
const DEFAULT_COOLDOWN_MS = parseInt(process.env.NOTIFICATION_COOLDOWN_MS || '3600000', 10);

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
  scope: 'user' | 'note';
  /** scope=note のときの対象ノート ID */
  noteId?: string;
  threshold?: number | null;
  minMatchLevel?: SimilarityMatchLevel | null;
  cooldownMinutes?: number | null;
  maxPerDay?: number | null;
}

/** システム既定の解決値 (設定行が 1 つも無いときの挙動 = 従来挙動) */
export function systemDefaultPreference(): EffectiveNotificationPreference {
  return {
    threshold: DEFAULT_SIMILARITY_TRIGGER_THRESHOLD,
    minMatchLevel: 'weak',
    cooldownMs: DEFAULT_COOLDOWN_MS,
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
  notePref: Pick<NotificationPreference, 'threshold' | 'minMatchLevel' | 'cooldownMinutes'> | null,
  userPref: Pick<NotificationPreference, 'threshold' | 'minMatchLevel' | 'cooldownMinutes'> | null
): EffectiveNotificationPreference {
  const defaults = systemDefaultPreference();

  const threshold = notePref?.threshold ?? userPref?.threshold ?? defaults.threshold;
  const minMatchLevel = notePref?.minMatchLevel ?? userPref?.minMatchLevel ?? defaults.minMatchLevel;
  const cooldownMinutes = notePref?.cooldownMinutes ?? userPref?.cooldownMinutes ?? null;
  const cooldownMs = cooldownMinutes !== null ? cooldownMinutes * 60 * 1000 : defaults.cooldownMs;

  // 一致レベルの帯下限としきい値の大きい方をエンジンへ渡す (§6.4)
  const levelFloor = DEFAULT_SIMILARITY_LEVELS[minMatchLevel];
  const effectiveThreshold = Math.max(threshold, levelFloor);

  return { threshold, minMatchLevel, cooldownMs, effectiveThreshold };
}

/**
 * 通知粒度設定の CRUD + 解決サービス
 */
export class NotificationPreferenceService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
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
    // scope=note は対象ノートの所有チェック (他ユーザーのノートへの設定登録を防ぐ。Phase α-4 と同方針)
    if (input.scope === 'note') {
      const ownedNote = await this.prisma.tradeNote.findFirst({
        where: { id: input.noteId, userId },
        select: { id: true },
      });
      if (!ownedNote) {
        throw new Error('ノートが見つかりませんでした');
      }
    }

    const where =
      input.scope === 'note'
        ? { userId, scope: 'note' as const, noteId: input.noteId ?? null }
        : { userId, scope: 'user' as const };

    const data = {
      threshold: input.threshold ?? null,
      minMatchLevel: input.minMatchLevel ?? null,
      cooldownMinutes: input.cooldownMinutes ?? null,
      maxPerDay: input.maxPerDay ?? null,
    };

    const existing = await this.prisma.notificationPreference.findFirst({ where, select: { id: true } });
    if (existing) {
      return this.prisma.notificationPreference.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.notificationPreference.create({
      data: {
        userId,
        scope: input.scope,
        noteId: input.scope === 'note' ? input.noteId : undefined,
        ...data,
      },
    });
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
}
