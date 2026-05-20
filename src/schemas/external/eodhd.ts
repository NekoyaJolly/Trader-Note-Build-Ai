/**
 * 外部 API Zod スキーマ - EODHD (Phase A A-3、2026-05-21)
 *
 * 目的: EODHD SDK レスポンスを ResearchAIService が扱う「外部要因 context」5 種の
 * ドメイン型へ narrow + summarize する境界レイヤー。
 *
 * 設計方針:
 * - AI に渡すのは要約 (full SDK response はトークン無駄)
 * - 各 context は Zod schema で型固定 + フィールドは AI が解釈しやすい命名に
 * - SDK 型 → ドメイン型変換関数 (toXxxContext) を併設、SDK の出力欠落を補正
 *
 * 関連: docs/architecture/EODHD_PHASE_A_WBS.md PR #2 A-3
 */

import { z } from 'zod';
import type {
  NewsArticle,
  SentimentItem,
  EconomicEventsResponse,
  MacroIndicatorItem,
  CalendarEarningsResponse,
  FundamentalsData,
} from 'eodhd';

// ===========================================
// News context
// ===========================================

export const NewsItemSchema = z.object({
  date: z.string(),
  title: z.string(),
  /** Sentiment polarity (-1.0 〜 +1.0) — SDK 提供時のみ */
  sentimentPolarity: z.number().min(-1).max(1).optional(),
  /** タグ (例: "earnings", "merger") */
  tags: z.array(z.string()).optional(),
  link: z.string().optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const NewsContextSchema = z.object({
  symbol: z.string(),
  fetchedAt: z.string(),
  totalCount: z.number(),
  topItems: z.array(NewsItemSchema),
});
export type NewsContext = z.infer<typeof NewsContextSchema>;

/**
 * SDK News レスポンス → NewsContext 要約 (top N 件、デフォルト 5)
 */
export function toNewsContext(
  symbol: string,
  articles: NewsArticle[],
  topN = 5,
): NewsContext {
  const topItems: NewsItem[] = articles.slice(0, topN).map((a) => {
    const item: NewsItem = {
      date: a.date,
      title: a.title,
    };
    const polarity = a.sentiment?.polarity;
    if (typeof polarity === 'number') {
      item.sentimentPolarity = polarity;
    }
    if (Array.isArray(a.tags) && a.tags.length > 0) {
      item.tags = a.tags;
    }
    if (a.link) {
      item.link = a.link;
    }
    return item;
  });
  return NewsContextSchema.parse({
    symbol,
    fetchedAt: new Date().toISOString(),
    totalCount: articles.length,
    topItems,
  });
}

// ===========================================
// Sentiment context
// ===========================================

export const SentimentPointSchema = z.object({
  date: z.string(),
  /** 投稿件数 */
  count: z.number(),
  /** 正規化センチメント (-1.0 〜 +1.0) — SDK 提供時のみ */
  normalized: z.number().optional(),
});
export type SentimentPoint = z.infer<typeof SentimentPointSchema>;

export const SentimentContextSchema = z.object({
  symbol: z.string(),
  fetchedAt: z.string(),
  points: z.array(SentimentPointSchema),
});
export type SentimentContext = z.infer<typeof SentimentContextSchema>;

/**
 * SDK Sentiments レスポンス → SentimentContext 要約
 *
 * SDK は `Record<symbol, SentimentItem[]>` を返すので、第一エントリを採用する。
 * 直近 N 件 (default 14) を取り出す。
 */
export function toSentimentContext(
  symbol: string,
  raw: Record<string, SentimentItem[]>,
  lastN = 14,
): SentimentContext {
  const items = raw[symbol] ?? Object.values(raw)[0] ?? [];
  const points: SentimentPoint[] = items.slice(-lastN).map((s) => {
    const p: SentimentPoint = { date: s.date, count: s.count };
    if (typeof s.normalized === 'number') {
      p.normalized = s.normalized;
    }
    return p;
  });
  return SentimentContextSchema.parse({
    symbol,
    fetchedAt: new Date().toISOString(),
    points,
  });
}

// ===========================================
// EconomicEvents context
// ===========================================

export const EconomicEventItemSchema = z.object({
  date: z.string(),
  country: z.string().optional(),
  type: z.string().optional(),
  /** EODHD の `comparison` 値 (mom/qoq/yoy) */
  comparison: z.string().optional(),
  /** 数値が取れたフィールド (actual / estimate / previous / change_percentage) */
  actual: z.number().optional(),
  estimate: z.number().optional(),
  previous: z.number().optional(),
  changePercentage: z.number().optional(),
});
export type EconomicEventItem = z.infer<typeof EconomicEventItemSchema>;

export const EconomicEventsContextSchema = z.object({
  fetchedAt: z.string(),
  country: z.string().optional(),
  totalCount: z.number(),
  topItems: z.array(EconomicEventItemSchema),
});
export type EconomicEventsContext = z.infer<typeof EconomicEventsContextSchema>;

/**
 * SDK が返す数値フィールド (number | string | null | undefined) を number に正規化。
 * 入力は Zod で narrow 済の型 (number | string | null | undefined) のみを受け付ける。
 */
function toNumberOrUndef(v: number | string | null | undefined): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * SDK EconomicEvents レスポンス → EconomicEventsContext 要約 (top N 件)
 *
 * SDK の `EconomicEventsResponse.data` 各フィールドは optional + 型がまちまちのため、
 * 数値系は parseFloat で広く取り込み、無効値は undefined にする。
 */
export function toEconomicEventsContext(
  raw: EconomicEventsResponse,
  topN = 20,
  country?: string,
): EconomicEventsContext {
  const events = raw.data ?? [];
  const topItems: EconomicEventItem[] = events.slice(0, topN).map((e) => ({
    date: e.date,
    country: e.country,
    type: e.type,
    comparison: e.comparison ?? undefined,
    actual: toNumberOrUndef(e.actual),
    estimate: toNumberOrUndef(e.estimate),
    previous: toNumberOrUndef(e.previous),
    changePercentage: toNumberOrUndef(e.change_percentage),
  }));
  return EconomicEventsContextSchema.parse({
    fetchedAt: new Date().toISOString(),
    country,
    totalCount: events.length,
    topItems,
  });
}

// ===========================================
// Macro context
// ===========================================

export const MacroIndicatorPointSchema = z.object({
  date: z.string(),
  value: z.number(),
});
export type MacroIndicatorPoint = z.infer<typeof MacroIndicatorPointSchema>;

export const MacroContextSchema = z.object({
  country: z.string(),
  indicator: z.string().optional(),
  fetchedAt: z.string(),
  points: z.array(MacroIndicatorPointSchema),
});
export type MacroContext = z.infer<typeof MacroContextSchema>;

/**
 * SDK MacroIndicator レスポンス → MacroContext 要約 (直近 N 件、default 12)
 */
export function toMacroContext(
  country: string,
  items: MacroIndicatorItem[],
  indicator?: string,
  lastN = 12,
): MacroContext {
  const points: MacroIndicatorPoint[] = items
    .filter((it) => typeof it.Value === 'number' && Number.isFinite(it.Value))
    .slice(-lastN)
    .map((it) => ({ date: it.Date, value: it.Value }));
  return MacroContextSchema.parse({
    country,
    indicator,
    fetchedAt: new Date().toISOString(),
    points,
  });
}

// ===========================================
// Fundamentals context
// ===========================================

/**
 * SDK Fundamentals レスポンスの subset を narrow する Zod スキーマ。
 *
 * SDK 型 `FundamentalsData` は再帰的な巨大 object のため、AI 入力に必要な
 * General + Highlights の主要フィールドだけを Zod で取り出す方針。
 * passthrough() で未定義フィールドは保持しつつ型は narrow しない。
 */
const FundamentalsRawSchema = z
  .object({
    General: z
      .object({
        Sector: z.string().optional(),
        Industry: z.string().optional(),
      })
      .passthrough()
      .optional(),
    Highlights: z
      .object({
        MarketCapitalization: z.union([z.number(), z.string(), z.null()]).optional(),
        PERatio: z.union([z.number(), z.string(), z.null()]).optional(),
        EPSEstimateCurrentYear: z.union([z.number(), z.string(), z.null()]).optional(),
        EPSEstimateNextYear: z.union([z.number(), z.string(), z.null()]).optional(),
        DividendYield: z.union([z.number(), z.string(), z.null()]).optional(),
        BookValue: z.union([z.number(), z.string(), z.null()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const FundamentalsContextSchema = z.object({
  symbol: z.string(),
  fetchedAt: z.string(),
  /** API 対応シンボル (US/ETF/INDX) 以外では null */
  available: z.boolean(),
  /** 利用可能な場合のみ含まれる主要メタ */
  highlights: z
    .object({
      marketCapitalization: z.number().optional(),
      peRatio: z.number().optional(),
      epsEstimateCurrentYear: z.number().optional(),
      epsEstimateNextYear: z.number().optional(),
      dividendYield: z.number().optional(),
      bookValue: z.number().optional(),
      sector: z.string().optional(),
      industry: z.string().optional(),
    })
    .optional(),
});
export type FundamentalsContext = z.infer<typeof FundamentalsContextSchema>;

/**
 * SDK Fundamentals レスポンス → FundamentalsContext 要約
 *
 * 非対応シンボル (FX/Crypto/Commodity 等) では `null` が渡される。
 * その場合は `available: false` を返す。
 *
 * Fundamentals レスポンスは巨大なので、AI に渡す重要フィールドだけ抽出する。
 */
export function toFundamentalsContext(
  symbol: string,
  raw: FundamentalsData | null,
): FundamentalsContext {
  if (!raw) {
    return FundamentalsContextSchema.parse({
      symbol,
      fetchedAt: new Date().toISOString(),
      available: false,
    });
  }
  // SDK 型は再帰的で具体構造を持たない (index signature 経由) ため、Zod で必要部分のみ narrow。
  const parsed = FundamentalsRawSchema.parse(raw);
  const general = parsed.General ?? {};
  const highlights = parsed.Highlights ?? {};

  return FundamentalsContextSchema.parse({
    symbol,
    fetchedAt: new Date().toISOString(),
    available: true,
    highlights: {
      marketCapitalization: toNumberOrUndef(highlights.MarketCapitalization),
      peRatio: toNumberOrUndef(highlights.PERatio),
      epsEstimateCurrentYear: toNumberOrUndef(highlights.EPSEstimateCurrentYear),
      epsEstimateNextYear: toNumberOrUndef(highlights.EPSEstimateNextYear),
      dividendYield: toNumberOrUndef(highlights.DividendYield),
      bookValue: toNumberOrUndef(highlights.BookValue),
      sector: general.Sector,
      industry: general.Industry,
    },
  });
}

// ===========================================
// CalendarEarnings context (オプション、aiOrchestrator から呼び出さない場合は未使用)
// ===========================================

export const CalendarEarningsContextSchema = z.object({
  fetchedAt: z.string(),
  totalCount: z.number(),
});
export type CalendarEarningsContext = z.infer<typeof CalendarEarningsContextSchema>;

/**
 * SDK CalendarEarnings レスポンス → CalendarEarningsContext (件数サマリのみ)
 *
 * Phase A 時点では aiOrchestrator から呼び出さない (件数ログ程度の用途)。
 */
export function toCalendarEarningsContext(
  raw: CalendarEarningsResponse,
): CalendarEarningsContext {
  const earnings = raw.earnings ?? [];
  return CalendarEarningsContextSchema.parse({
    fetchedAt: new Date().toISOString(),
    totalCount: earnings.length,
  });
}
