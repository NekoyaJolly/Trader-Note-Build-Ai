/**
 * ストラテジーサービス
 * 
 * 目的:
 * - ストラテジーの CRUD 操作
 * - バージョン管理（保存時に常に新バージョン作成）
 * - 条件の検証
 */

import type { StrategyStatus, StrategyDirection } from '@prisma/client';
import { prisma } from '../db/client';

// ============================================
// 型定義
// ============================================

/**
 * ストラテジー作成リクエスト
 */
export interface CreateStrategyInput {
  name: string;
  description?: string;
  symbol: string;
  /** 対象時間足（1m/5m/15m/30m/1h/4h/1d）。ストラテジーの基準足。 */
  timeframe: string;
  side: StrategyDirection;
  entryConditions: object; // ConditionGroup JSON（side=both では「買い用」）
  /** 売り用エントリー条件（side=both のときのみ使用） */
  shortEntryConditions?: object;
  exitSettings: object;    // ExitSettings JSON
  entryTiming?: string;
  tags?: string[];
}

/**
 * ストラテジー更新リクエスト
 */
export interface UpdateStrategyInput {
  name?: string;
  description?: string;
  symbol?: string;
  timeframe?: string;
  side?: StrategyDirection;
  entryConditions?: object;
  shortEntryConditions?: object;
  exitSettings?: object;
  entryTiming?: string;
  status?: StrategyStatus;
  tags?: string[];
  changeNote?: string;
}

/**
 * ストラテジー一覧取得パラメータ
 */
export interface ListStrategiesParams {
  status?: StrategyStatus;
  symbol?: string;
  limit?: number;
  offset?: number;
}

/**
 * ストラテジーサマリー（一覧表示用）
 */
export interface StrategySummary {
  id: string;
  name: string;
  symbol: string;
  timeframe: string | null;
  side: StrategyDirection;
  status: StrategyStatus;
  versionCount: number;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

/**
 * ストラテジー詳細（バージョン情報含む）
 */
export interface StrategyDetail {
  id: string;
  name: string;
  description: string | null;
  symbol: string;
  timeframe: string | null;
  side: StrategyDirection;
  status: StrategyStatus;
  currentVersionId: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  currentVersion: {
    id: string;
    versionNumber: number;
    entryConditions: object;
    shortEntryConditions: object | null;
    exitSettings: object;
    entryTiming: string;
    changeNote: string | null;
    createdAt: Date;
  } | null;
  versions: {
    id: string;
    versionNumber: number;
    changeNote: string | null;
    createdAt: Date;
  }[];
}

// ============================================
// 対応シンボル（バリデーション用）
// ============================================

const SUPPORTED_SYMBOLS = [
  'USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY',
  'EURUSD', 'GBPUSD', 'AUDUSD', 'XAUUSD',
];

// 対応時間足（API 文字列）。strategyRoutes の zod enum / BacktestTimeframe と一致させる。
const SUPPORTED_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

// ============================================
// サービス関数
// ============================================

/**
 * ストラテジー一覧を取得
 */
export async function listStrategies(params: ListStrategiesParams = {}): Promise<StrategySummary[]> {
  const { status, symbol, limit = 50, offset = 0 } = params;

  // フィルタ条件を構築
  const where: {
    status?: StrategyStatus;
    symbol?: string;
  } = {};
  if (status) where.status = status;
  if (symbol) where.symbol = symbol;

  const strategies = await prisma.strategy.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    skip: offset,
    include: {
      _count: {
        select: { versions: true },
      },
    },
  });

  return strategies.map(s => ({
    id: s.id,
    name: s.name,
    symbol: s.symbol,
    timeframe: s.timeframe,
    side: s.side,
    status: s.status,
    versionCount: s._count.versions,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    tags: s.tags,
  }));
}

/**
 * ストラテジー詳細を取得
 */
export async function getStrategy(id: string): Promise<StrategyDetail | null> {
  const strategy = await prisma.strategy.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
      },
    },
  });

  if (!strategy) return null;

  // 現在のバージョンを取得
  const currentVersion = strategy.currentVersionId
    ? strategy.versions.find(v => v.id === strategy.currentVersionId)
    : strategy.versions[0]; // 最新バージョンをフォールバック

  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    symbol: strategy.symbol,
    timeframe: strategy.timeframe,
    side: strategy.side,
    status: strategy.status,
    currentVersionId: strategy.currentVersionId,
    tags: strategy.tags,
    createdAt: strategy.createdAt,
    updatedAt: strategy.updatedAt,
    currentVersion: currentVersion ? {
      id: currentVersion.id,
      versionNumber: currentVersion.versionNumber,
      entryConditions: currentVersion.entryConditions as object,
      shortEntryConditions: (currentVersion.shortEntryConditions as object | null) ?? null,
      exitSettings: currentVersion.exitSettings as object,
      entryTiming: currentVersion.entryTiming,
      changeNote: currentVersion.changeNote,
      createdAt: currentVersion.createdAt,
    } : null,
    versions: strategy.versions.map(v => ({
      id: v.id,
      versionNumber: v.versionNumber,
      changeNote: v.changeNote,
      createdAt: v.createdAt,
    })),
  };
}

/**
 * 特定バージョンの詳細を取得
 */
export async function getStrategyVersion(strategyId: string, versionNumber: number) {
  const version = await prisma.strategyVersion.findFirst({
    where: {
      strategyId,
      versionNumber,
    },
  });

  if (!version) return null;

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    entryConditions: version.entryConditions as object,
    shortEntryConditions: (version.shortEntryConditions as object | null) ?? null,
    exitSettings: version.exitSettings as object,
    entryTiming: version.entryTiming,
    changeNote: version.changeNote,
    createdAt: version.createdAt,
  };
}

/**
 * 指定バージョンへロールバック（復元）する
 * 
 * 仕様:
 * - 既存の履歴を壊さないため、ロールバック操作も「新バージョン」として保存する
 * - StrategyVersion に symbol/side が保存されている場合はそれも復元対象に含める
 */
export async function rollbackStrategyVersion(params: {
  strategyId: string;
  versionNumber: number;
  changeNote?: string;
}): Promise<StrategyDetail> {
  const { strategyId, versionNumber, changeNote } = params;

  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
    include: {
      versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  });
  if (!strategy) {
    throw new Error('ストラテジーが見つかりません');
  }

  const target = await prisma.strategyVersion.findFirst({
    where: { strategyId, versionNumber },
  });
  if (!target) {
    throw new Error(`指定バージョンが見つかりません: v${versionNumber}`);
  }

  const latestVersionNumber = strategy.versions[0]?.versionNumber ?? 0;
  const newVersionNumber = latestVersionNumber + 1;

  const rollbackSymbol = target.symbol ?? strategy.symbol;
  const rollbackTimeframe = target.timeframe ?? strategy.timeframe;
  const rollbackSide = target.side ?? strategy.side;

  await prisma.$transaction(async (tx) => {
    const newVersion = await tx.strategyVersion.create({
      data: {
        strategyId,
        versionNumber: newVersionNumber,
        symbol: rollbackSymbol,
        timeframe: rollbackTimeframe,
        side: rollbackSide,
        entryConditions: target.entryConditions as object,
        shortEntryConditions: (target.shortEntryConditions as object | null) ?? undefined,
        exitSettings: target.exitSettings as object,
        entryTiming: target.entryTiming,
        changeNote: changeNote?.trim() || `ロールバック: v${versionNumber} → v${newVersionNumber}`,
      },
    });

    await tx.strategy.update({
      where: { id: strategyId },
      data: {
        symbol: rollbackSymbol,
        timeframe: rollbackTimeframe,
        side: rollbackSide,
        currentVersionId: newVersion.id,
      },
    });
  });

  const detail = await getStrategy(strategyId);
  if (!detail) throw new Error('ロールバック後のストラテジー取得に失敗しました');
  return detail;
}

/**
 * ストラテジーを作成
 */
export async function createStrategy(input: CreateStrategyInput): Promise<StrategyDetail> {
  // バリデーション
  if (!input.name || input.name.trim() === '') {
    throw new Error('ストラテジー名は必須です');
  }
  if (!SUPPORTED_SYMBOLS.includes(input.symbol)) {
    throw new Error(`対応していないシンボルです: ${input.symbol}`);
  }
  if (!SUPPORTED_TIMEFRAMES.includes(input.timeframe)) {
    throw new Error(`対応していない時間足です: ${input.timeframe}`);
  }
  if (!['buy', 'sell', 'both'].includes(input.side)) {
    throw new Error('売買方向は buy / sell / both を指定してください');
  }
  // both（買い+売り）は売り用条件が必須（買い=entryConditions と対）。
  if (input.side === 'both' && !input.shortEntryConditions) {
    throw new Error('Buy & Sell では売り用エントリー条件（shortEntryConditions）が必須です');
  }

  // トランザクションで作成
  const result = await prisma.$transaction(async (tx) => {
    // ストラテジー本体を作成
    const strategy = await tx.strategy.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        symbol: input.symbol,
        timeframe: input.timeframe,
        side: input.side,
        status: 'draft',
        tags: input.tags || [],
      },
    });

    // 初期バージョンを作成
    const version = await tx.strategyVersion.create({
      data: {
        strategyId: strategy.id,
        versionNumber: 1,
        symbol: input.symbol,
        timeframe: input.timeframe,
        side: input.side,
        entryConditions: input.entryConditions,
        // both 以外では売り用条件を保存しない（buy/sell は entryConditions のみ使用）
        shortEntryConditions: input.side === 'both' ? input.shortEntryConditions : undefined,
        exitSettings: input.exitSettings,
        entryTiming: input.entryTiming || 'next_open',
        changeNote: '初期バージョン',
      },
    });

    // currentVersionId を更新
    await tx.strategy.update({
      where: { id: strategy.id },
      data: { currentVersionId: version.id },
    });

    return { strategy, version };
  });

  // 詳細を返却
  const detail = await getStrategy(result.strategy.id);
  if (!detail) throw new Error('作成したストラテジーの取得に失敗しました');
  return detail;
}

/**
 * ストラテジーを更新（常に新バージョンを作成）
 */
export async function updateStrategy(id: string, input: UpdateStrategyInput): Promise<StrategyDetail> {
  // 既存ストラテジーを取得
  const existing = await prisma.strategy.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  if (!existing) {
    throw new Error('ストラテジーが見つかりません');
  }

  // バリデーション
  if (input.symbol && !SUPPORTED_SYMBOLS.includes(input.symbol)) {
    throw new Error(`対応していないシンボルです: ${input.symbol}`);
  }
  if (input.timeframe && !SUPPORTED_TIMEFRAMES.includes(input.timeframe)) {
    throw new Error(`対応していない時間足です: ${input.timeframe}`);
  }
  if (input.side && !['buy', 'sell', 'both'].includes(input.side)) {
    throw new Error('売買方向は buy / sell / both を指定してください');
  }

  const latestVersion = existing.versions[0];

  // 更新後の方向が both になる場合、売り用条件が（今回 or 既存バージョンに）存在する必要がある。
  const effectiveSide = input.side ?? existing.side;
  if (effectiveSide === 'both') {
    const hasShort = input.shortEntryConditions ?? (latestVersion?.shortEntryConditions ?? null);
    if (!hasShort) {
      throw new Error('Buy & Sell では売り用エントリー条件（shortEntryConditions）が必須です');
    }
  }

  const needsNewVersion =
    input.entryConditions || input.shortEntryConditions || input.exitSettings || input.entryTiming;

  // トランザクションで更新
  await prisma.$transaction(async (tx) => {
    // ストラテジー本体を更新
    const updateData: {
      name?: string;
      description?: string | null;
      symbol?: string;
      timeframe?: string;
      side?: StrategyDirection;
      status?: StrategyStatus;
      tags?: string[];
      currentVersionId?: string;
    } = {};

    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.description !== undefined) updateData.description = input.description?.trim() || null;
    if (input.symbol !== undefined) updateData.symbol = input.symbol;
    if (input.timeframe !== undefined) updateData.timeframe = input.timeframe;
    if (input.side !== undefined) updateData.side = input.side;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.tags !== undefined) updateData.tags = input.tags;

    // 条件が変更された場合は新バージョンを作成
    let newVersion = null;
    if (needsNewVersion && latestVersion) {
      const newVersionNumber = latestVersion.versionNumber + 1;
      // both 以外では売り用条件を保持しない。both のときは今回入力 → 既存値の順で引き継ぐ。
      const nextShort =
        effectiveSide === 'both'
          ? (input.shortEntryConditions ?? (latestVersion.shortEntryConditions as object | null) ?? undefined)
          : undefined;
      newVersion = await tx.strategyVersion.create({
        data: {
          strategyId: id,
          versionNumber: newVersionNumber,
          // 変更履歴として symbol/timeframe/side も保持（ロールバック用途）
          symbol: input.symbol ?? existing.symbol,
          timeframe: input.timeframe ?? existing.timeframe,
          side: input.side ?? existing.side,
          entryConditions: input.entryConditions || (latestVersion.entryConditions as object),
          shortEntryConditions: nextShort,
          exitSettings: input.exitSettings || (latestVersion.exitSettings as object),
          entryTiming: input.entryTiming || latestVersion.entryTiming,
          changeNote: input.changeNote || `バージョン ${newVersionNumber}`,
        },
      });
      updateData.currentVersionId = newVersion.id;
    }

    await tx.strategy.update({
      where: { id },
      data: updateData,
    });

    return { newVersion };
  });

  // 詳細を返却
  const detail = await getStrategy(id);
  if (!detail) throw new Error('更新後のストラテジーの取得に失敗しました');
  return detail;
}

/**
 * ストラテジーを削除
 */
export async function deleteStrategy(id: string): Promise<void> {
  const existing = await prisma.strategy.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error('ストラテジーが見つかりません');
  }

  // カスケード削除（versions, strategyNotes, backtestRuns も削除される）
  await prisma.strategy.delete({
    where: { id },
  });
}

/**
 * ストラテジーのステータスを変更
 */
export async function updateStrategyStatus(id: string, status: StrategyStatus): Promise<StrategyDetail> {
  const existing = await prisma.strategy.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error('ストラテジーが見つかりません');
  }

  await prisma.strategy.update({
    where: { id },
    data: { status },
  });

  const detail = await getStrategy(id);
  if (!detail) throw new Error('更新後のストラテジーの取得に失敗しました');
  return detail;
}

/**
 * ストラテジーを複製
 */
export async function duplicateStrategy(id: string, newName?: string): Promise<StrategyDetail> {
  const existing = await getStrategy(id);
  if (!existing || !existing.currentVersion) {
    throw new Error('複製元のストラテジーが見つかりません');
  }

  // 新しい名前が指定されていない場合は「(コピー)」を付加
  const name = newName || `${existing.name} (コピー)`;

  return createStrategy({
    name,
    description: existing.description || undefined,
    symbol: existing.symbol,
    // レガシー（timeframe 未設定）の複製はデフォルト足にフォールバックする
    timeframe: existing.timeframe ?? '1h',
    side: existing.side,
    entryConditions: existing.currentVersion.entryConditions,
    // both の複製では売り用条件も引き継ぐ
    shortEntryConditions: existing.currentVersion.shortEntryConditions ?? undefined,
    exitSettings: existing.currentVersion.exitSettings,
    entryTiming: existing.currentVersion.entryTiming,
    tags: existing.tags,
  });
}
