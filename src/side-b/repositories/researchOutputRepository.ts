/**
 * ResearchOutput リポジトリ (Phase A 新設、2026-05-21)
 *
 * 目的: ResearchAgent (researchAIService) の LLM 出力を専用テーブルに永続化
 *
 * MarketResearch (旧) との違い:
 * - featureVector 列 (v1=12次元 / v2=MarketAnalysis 混在) → rawOutput 列 (Zod 検証済み構造化 JSON のみ)
 * - 外部要因 context 5 種 (News/Sentiment/EconomicEvents/Macro/Fundamentals) を input snapshot として保持
 *
 * 責務:
 * - リサーチ出力の作成・読み取り
 * - キャッシュ有効期限の管理
 * - 期限切れリサーチの削除
 */

import type { PrismaClient, ResearchOutput, Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import type { FeatureVector12D, OHLCVSnapshot } from '../models';
import {
  type MarketAnalysis,
  safeValidateMarketAnalysis,
  analysisToLegacyFeatureVector,
  createEmptyFeatureVector,
} from '../models';
import { normalizeTimeframe } from '../constants/timeframes';
import { toPrismaJsonValueOrDbNull } from '../../utils/prismaJson';

// ===========================================
// 型定義
// ===========================================

/**
 * EODHD 外部要因 context (Phase A で配線、PR #2 で実取得)
 * 現時点では shape のプレースホルダ。PR #2 で Zod スキーマ化。
 */
export type ResearchContextSnapshot = Prisma.JsonObject;

/**
 * リサーチ出力作成用の入力データ
 *
 * featureVector はここでは受け取らない: marketAnalysis から
 * `analysisToLegacyFeatureVector()` で読み取り時に派生させる方針
 * (旧 MarketResearch の v1/v2 混在問題を避けるため)。
 */
export interface CreateResearchOutputInput {
  symbol: string;
  timeframe?: string;
  /** 構造化分析データ (v2 MarketAnalysis 相当) */
  marketAnalysis: MarketAnalysis;
  ohlcvSnapshot?: OHLCVSnapshot;
  /** EODHD News context (PR #2 で実取得) */
  newsContext?: ResearchContextSnapshot;
  /** EODHD Sentiment context (PR #2 で実取得) */
  sentimentContext?: ResearchContextSnapshot;
  /** EODHD Economic Events context (PR #2 で実取得) */
  economicEvents?: ResearchContextSnapshot;
  /** EODHD Macro Indicators context (PR #2 で実取得) */
  macroContext?: ResearchContextSnapshot;
  /** EODHD Fundamentals context (PR #2 で実取得、API 対応シンボルのみ) */
  fundamentalsContext?: ResearchContextSnapshot;
  aiModel: string;
  tokenUsage?: number;
  /** EODHD API call cost 合計 (1/5/10 重み付け、PR #2 で計算) */
  apiCallCost?: number;
  expiresAt: Date;
}

/**
 * リサーチ検索オプション
 */
export interface FindResearchOutputOptions {
  symbol?: string;
  validOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * DB から取得した ResearchOutput をアプリ型に変換した型
 *
 * `MarketResearchWithTypes` と shape を揃え、Plan AI 等の呼び出し側を最小変更で済むようにする。
 * 追加フィールド: rawOutput, newsContext, sentimentContext, economicEvents, macroContext,
 * fundamentalsContext, apiCallCost。
 */
export interface ResearchOutputWithTypes {
  id: string;
  symbol: string;
  timeframe: string;
  featureVector: FeatureVector12D;
  /**
   * 構造化分析データ。新規データでは必ず存在 (create() 時に必須)、
   * 読み取り時は rawOutput からの復元失敗で undefined になり得る (corruption ケース)。
   * MarketResearchWithTypes と shape を揃え呼び出し側を最小変更で済ませる。
   */
  marketAnalysis?: MarketAnalysis;
  ohlcvSnapshot?: OHLCVSnapshot;
  /** 構造化 LLM 出力 (rawOutput 列の生データ参照) */
  rawOutput: Prisma.JsonObject;
  newsContext?: ResearchContextSnapshot;
  sentimentContext?: ResearchContextSnapshot;
  economicEvents?: ResearchContextSnapshot;
  macroContext?: ResearchContextSnapshot;
  fundamentalsContext?: ResearchContextSnapshot;
  aiModel: string;
  tokenUsage: number | null;
  apiCallCost: number | null;
  expiresAt: Date;
  createdAt: Date;
}

// ===========================================
// リポジトリクラス
// ===========================================

export class ResearchOutputRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * リサーチ出力を作成
   *
   * rawOutput 列に MarketAnalysis 全体を保存 (v2 マーカー付き)。
   * 外部要因 context は PR #2 で配線。
   */
  async create(input: CreateResearchOutputInput): Promise<ResearchOutputWithTypes> {
    const rawOutputData = { ...input.marketAnalysis, _version: 2 } satisfies Prisma.JsonObject;

    const output = await this.prisma.researchOutput.create({
      data: {
        symbol: input.symbol,
        timeframe: normalizeTimeframe(input.timeframe),
        rawOutput: rawOutputData,
        // すべて nullable JSON 列 (`Json?`)。input が undefined のときは SQL NULL を入れる。
        ohlcvSnapshot: toPrismaJsonValueOrDbNull(input.ohlcvSnapshot),
        newsContext: toPrismaJsonValueOrDbNull(input.newsContext),
        sentimentContext: toPrismaJsonValueOrDbNull(input.sentimentContext),
        economicEvents: toPrismaJsonValueOrDbNull(input.economicEvents),
        macroContext: toPrismaJsonValueOrDbNull(input.macroContext),
        fundamentalsContext: toPrismaJsonValueOrDbNull(input.fundamentalsContext),
        aiModel: input.aiModel,
        tokenUsage: input.tokenUsage,
        apiCallCost: input.apiCallCost,
        expiresAt: input.expiresAt,
      },
    });

    return this.toTypedOutput(output);
  }

  async findById(id: string): Promise<ResearchOutputWithTypes | null> {
    const output = await this.prisma.researchOutput.findUnique({ where: { id } });
    return output ? this.toTypedOutput(output) : null;
  }

  async findValidBySymbol(symbol: string): Promise<ResearchOutputWithTypes | null> {
    const output = await this.prisma.researchOutput.findFirst({
      where: {
        symbol,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    return output ? this.toTypedOutput(output) : null;
  }

  async findMany(options: FindResearchOutputOptions = {}): Promise<ResearchOutputWithTypes[]> {
    const { symbol, validOnly = false, limit = 50, offset = 0 } = options;
    const where: Prisma.ResearchOutputWhereInput = {};
    if (symbol) where.symbol = symbol;
    if (validOnly) where.expiresAt = { gt: new Date() };

    const outputs = await this.prisma.researchOutput.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return outputs.map((o) => this.toTypedOutput(o));
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.researchOutput.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }

  async deleteBySymbol(symbol: string): Promise<number> {
    const result = await this.prisma.researchOutput.deleteMany({ where: { symbol } });
    return result.count;
  }

  async count(
    options: Pick<FindResearchOutputOptions, 'symbol' | 'validOnly'> = {},
  ): Promise<number> {
    const { symbol, validOnly = false } = options;
    const where: Prisma.ResearchOutputWhereInput = {};
    if (symbol) where.symbol = symbol;
    if (validOnly) where.expiresAt = { gt: new Date() };
    return this.prisma.researchOutput.count({ where });
  }

  // ===========================================
  // プライベートメソッド
  // ===========================================

  private toTypedOutput(output: ResearchOutput): ResearchOutputWithTypes {
    const rawValue = output.rawOutput;
    const rawObject: Prisma.JsonObject =
      rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)
        ? rawValue
        : {};

    // rawOutput は v2 (MarketAnalysis + _version: 2) 形式のみ想定。
    // ただし読み取り時の validation 失敗はキャッシュミス相当として扱い、
    // marketAnalysis を undefined にして継続させる (1 レコードの corruption で
    // findValidBySymbol() 全体が落ちないように、Copilot review #233 指摘)。
    const { _version, ...analysisData } = rawObject;
    void _version;
    const marketAnalysis = safeValidateMarketAnalysis(analysisData) ?? undefined;
    const featureVector: FeatureVector12D = marketAnalysis
      ? analysisToLegacyFeatureVector(marketAnalysis)
      : createEmptyFeatureVector();

    const snapshotRaw = output.ohlcvSnapshot;
    const ohlcvSnapshot: OHLCVSnapshot | undefined =
      snapshotRaw !== null && typeof snapshotRaw === 'object' && !Array.isArray(snapshotRaw)
        ? reviveOhlcvSnapshot(snapshotRaw)
        : undefined;

    return {
      id: output.id,
      symbol: output.symbol,
      timeframe: output.timeframe,
      featureVector,
      marketAnalysis,
      ohlcvSnapshot,
      rawOutput: rawObject,
      newsContext: jsonObjectOrUndef(output.newsContext),
      sentimentContext: jsonObjectOrUndef(output.sentimentContext),
      economicEvents: jsonObjectOrUndef(output.economicEvents),
      macroContext: jsonObjectOrUndef(output.macroContext),
      fundamentalsContext: jsonObjectOrUndef(output.fundamentalsContext),
      aiModel: output.aiModel,
      tokenUsage: output.tokenUsage,
      apiCallCost: output.apiCallCost,
      expiresAt: output.expiresAt,
      createdAt: output.createdAt,
    };
  }
}

function jsonObjectOrUndef(v: Prisma.JsonValue | null): Prisma.JsonObject | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v;
}

function reviveOhlcvSnapshot(raw: Prisma.JsonObject): OHLCVSnapshot | undefined {
  const numOrUndef = (v: Prisma.JsonValue | undefined): number | undefined =>
    typeof v === 'number' ? v : undefined;
  const latestPrice = numOrUndef(raw.latestPrice);
  if (latestPrice === undefined) return undefined;
  const recentHigh = numOrUndef(raw.recentHigh);
  const recentLow = numOrUndef(raw.recentLow);
  const dataPoints = numOrUndef(raw.dataPoints);
  const closes = raw.recentCloses;
  const recentCloses: number[] = Array.isArray(closes)
    ? closes.filter((v): v is number => typeof v === 'number')
    : [];
  if (recentHigh === undefined || recentLow === undefined || dataPoints === undefined) {
    return undefined;
  }
  return { latestPrice, recentHigh, recentLow, dataPoints, recentCloses };
}

// デフォルトインスタンス
export const researchOutputRepository = new ResearchOutputRepository();
