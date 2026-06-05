/**
 * EODHD read-only リサーチスキル 6 種 (P3)
 *
 * `eodhdResearchClient` の 6 メソッド (news/sentiment/economic_events/macro/earnings/
 * fundamentals) を SkillRegistry に登録する。すべて **read-only** で、発注/台帳書込/DB変更は
 * 一切しない。将来 FundamentalsResearcher (認知第1号) が有界 tool-use ループで使う
 * 「read-only ツールのみ」の正体 (= 認知層に発注系を絶対渡さない安全弁) を構成する。
 *
 * description / 制約は公式 Claude スキル `eodhd-api`(`references/endpoints.md`) を正に蒸留。
 * ACI ベストプラクティス (Anthropic「Building Effective Agents」付録) に従い、各ツールの
 * 用途・入力・他ツールとの境界・制約を明記する。
 *
 * 1 ファイルに集約する理由: 6 スキルは「同一クライアントを薄く包む read-only リサーチ
 * ファミリ」で凝集が高く、近似的な 6 ファイル増殖を避ける (AGENTS §5.3)。
 */
import { z } from 'zod';
import type { Skill } from '../types';
import type { SkillRegistry } from '../registry';
import {
  fetchNews,
  fetchSentiments,
  fetchEconomicEvents,
  fetchMacroIndicator,
  fetchCalendarEarnings,
  fetchFundamentals,
  type FetchNewsInput,
  type FetchSentimentsInput,
  type FetchEconomicEventsInput,
  type FetchMacroIndicatorInput,
  type FetchCalendarEarningsInput,
  type FetchFundamentalsInput,
} from '../../research/eodhdResearchClient';
import { isEodhdFundamentalsSupported } from '../../../utils/symbolNormalization';

// 出力は eodhd 型に直接結合せず、fetch 関数の戻り型から導出する。
type NewsOutput = Awaited<ReturnType<typeof fetchNews>>;
type SentimentsOutput = Awaited<ReturnType<typeof fetchSentiments>>;
type EconomicEventsOutput = Awaited<ReturnType<typeof fetchEconomicEvents>>;
type MacroIndicatorOutput = Awaited<ReturnType<typeof fetchMacroIndicator>>;
type CalendarEarningsOutput = Awaited<ReturnType<typeof fetchCalendarEarnings>>;
type FundamentalsOutput = Awaited<ReturnType<typeof fetchFundamentals>>;

/** ISO 日付 (YYYY-MM-DD) の緩い検証。空文字は弾く。 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください')
  .optional();

/** 6 スキルの fetch 関数を差し替えるための DI (テスト用)。未指定は実クライアント。 */
export interface EodhdResearchSkillsDeps {
  fetchNews?: typeof fetchNews;
  fetchSentiments?: typeof fetchSentiments;
  fetchEconomicEvents?: typeof fetchEconomicEvents;
  fetchMacroIndicator?: typeof fetchMacroIndicator;
  fetchCalendarEarnings?: typeof fetchCalendarEarnings;
  fetchFundamentals?: typeof fetchFundamentals;
}

// ============================================================
// 1. ニュース
// ============================================================
const NewsInputSchema = z.object({
  symbol: z.string().min(1),
  from: isoDate,
  to: isoDate,
  limit: z.number().int().min(1).max(100).optional(),
});

export function createFetchEodhdNewsSkill(
  deps: EodhdResearchSkillsDeps = {},
): Skill<FetchNewsInput, NewsOutput> {
  const fn = deps.fetchNews ?? fetchNews;
  return {
    name: 'fetch_eodhd_news',
    description: [
      '指定シンボルの金融ニュース記事を EODHD から取得する (read-only)。',
      '各記事は title / content / date / 関連シンボル等を持つ。',
      '市場のセンチメント変化やイベントの「事実」収集に使う。',
      '数値スコア化されたセンチメントが欲しい場合は fetch_eodhd_sentiments を使う。',
      'from/to は YYYY-MM-DD。limit 既定 10 / 上限 100。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'EODHD 形式シンボル (例: AAPL.US, EURUSD.FOREX)' },
        from: { type: 'string', description: '取得開始日 YYYY-MM-DD (省略可)' },
        to: { type: 'string', description: '取得終了日 YYYY-MM-DD (省略可)' },
        limit: { type: 'number', description: '取得件数。既定 10、上限 100' },
      },
      required: ['symbol'],
    },
    async execute(raw) {
      const input = NewsInputSchema.parse(raw ?? {});
      return fn(input);
    },
  };
}

// ============================================================
// 2. センチメント (日次スコア)
// ============================================================
const SentimentsInputSchema = z.object({
  symbol: z.string().min(1),
  from: isoDate,
  to: isoDate,
});

export function createFetchEodhdSentimentsSkill(
  deps: EodhdResearchSkillsDeps = {},
): Skill<FetchSentimentsInput, SentimentsOutput> {
  const fn = deps.fetchSentiments ?? fetchSentiments;
  return {
    name: 'fetch_eodhd_sentiments',
    description: [
      '指定シンボルの日次集計センチメントスコア (正規化数値) を EODHD から取得する (read-only)。',
      '戻り値は { シンボル: 日次センチメント配列 } 形式。',
      'ニュースの「数値的な強気/弱気」を時系列で見たいときに使う。',
      '生のニュース本文が欲しい場合は fetch_eodhd_news を使う。from/to は YYYY-MM-DD。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'EODHD 形式シンボル' },
        from: { type: 'string', description: '取得開始日 YYYY-MM-DD (省略可)' },
        to: { type: 'string', description: '取得終了日 YYYY-MM-DD (省略可)' },
      },
      required: ['symbol'],
    },
    async execute(raw) {
      const input = SentimentsInputSchema.parse(raw ?? {});
      return fn(input);
    },
  };
}

// ============================================================
// 3. 経済イベントカレンダー
// ============================================================
const EconomicEventsInputSchema = z.object({
  country: z.string().optional(),
  from: isoDate,
  to: isoDate,
  comparison: z.enum(['mom', 'qoq', 'yoy']).optional(),
  type: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export function createFetchEodhdEconomicEventsSkill(
  deps: EodhdResearchSkillsDeps = {},
): Skill<FetchEconomicEventsInput, EconomicEventsOutput> {
  const fn = deps.fetchEconomicEvents ?? fetchEconomicEvents;
  return {
    name: 'fetch_eodhd_economic_events',
    description: [
      '経済指標発表カレンダー (CPI/雇用統計/金利決定 等の予定と実績) を EODHD から取得する (read-only)。',
      'country (ISO 国コード, 例 US/JP) で絞り込み、comparison は mom/qoq/yoy。',
      'マクロイベントリスク (発表前後のボラ要因) の把握に使う。',
      '長期マクロ指標の時系列が欲しい場合は fetch_eodhd_macro_indicator を使う。from/to は YYYY-MM-DD。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO 国コード (例: US, JP)。省略で全件' },
        from: { type: 'string', description: '開始日 YYYY-MM-DD (省略可)' },
        to: { type: 'string', description: '終了日 YYYY-MM-DD (省略可)' },
        comparison: { type: 'string', description: '比較基準: mom / qoq / yoy', enum: ['mom', 'qoq', 'yoy'] },
        type: { type: 'string', description: '指標タイプで絞り込み (省略可)' },
        limit: { type: 'number', description: '取得件数 (省略可、上限 1000)' },
      },
    },
    async execute(raw) {
      const input = EconomicEventsInputSchema.parse(raw ?? {});
      return fn(input);
    },
  };
}

// ============================================================
// 4. マクロ指標 (長期時系列)
// ============================================================
const MacroIndicatorInputSchema = z.object({
  country: z.string().min(1),
  indicator: z.string().optional(),
});

export function createFetchEodhdMacroIndicatorSkill(
  deps: EodhdResearchSkillsDeps = {},
): Skill<FetchMacroIndicatorInput, MacroIndicatorOutput> {
  const fn = deps.fetchMacroIndicator ?? fetchMacroIndicator;
  return {
    name: 'fetch_eodhd_macro_indicator',
    description: [
      '国別のマクロ経済指標の長期時系列 (GDP/インフレ/失業率/金利 等) を EODHD から取得する (read-only)。',
      'country (ISO 国コード) は必須。indicator は EODHD コード (例 gdp_current_usd)、省略時は既定指標。',
      'マクロレジーム (金融引締/緩和局面 等) の判定材料に使う。',
      '直近の発表カレンダーが欲しい場合は fetch_eodhd_economic_events を使う。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO 国コード (例: US, JP)。必須' },
        indicator: { type: 'string', description: 'EODHD マクロ指標コード (例: gdp_current_usd)。省略可' },
      },
      required: ['country'],
    },
    async execute(raw) {
      const input = MacroIndicatorInputSchema.parse(raw ?? {});
      return fn(input);
    },
  };
}

// ============================================================
// 5. 決算カレンダー
// ============================================================
const CalendarEarningsInputSchema = z.object({
  symbols: z.string().optional(),
  from: isoDate,
  to: isoDate,
});

export function createFetchEodhdEarningsSkill(
  deps: EodhdResearchSkillsDeps = {},
): Skill<FetchCalendarEarningsInput, CalendarEarningsOutput> {
  const fn = deps.fetchCalendarEarnings ?? fetchCalendarEarnings;
  return {
    name: 'fetch_eodhd_earnings',
    description: [
      '決算発表カレンダー (予定日・EPS 予想/実績) を EODHD から取得する (read-only)。',
      'symbols はカンマ区切りシンボル (省略時は期間内全件)。株式 (US 等) が対象。',
      '決算イベントリスクの把握に使う。FX/コモディティに決算は無いので使わない。from/to は YYYY-MM-DD。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'string', description: 'カンマ区切りシンボル (省略可)' },
        from: { type: 'string', description: '開始日 YYYY-MM-DD (省略可)' },
        to: { type: 'string', description: '終了日 YYYY-MM-DD (省略可)' },
      },
    },
    async execute(raw) {
      const input = CalendarEarningsInputSchema.parse(raw ?? {});
      return fn(input);
    },
  };
}

// ============================================================
// 6. ファンダメンタルズ (US/ETF/INDX のみ)
// ============================================================
const FundamentalsInputSchema = z.object({
  symbol: z.string().min(1),
  filter: z.string().optional(),
  historical: z.union([z.literal(0), z.literal(1)]).optional(),
});

export function createFetchEodhdFundamentalsSkill(
  deps: EodhdResearchSkillsDeps = {},
): Skill<FetchFundamentalsInput, FundamentalsOutput> {
  const fn = deps.fetchFundamentals ?? fetchFundamentals;
  return {
    name: 'fetch_eodhd_fundamentals',
    description: [
      '企業/ETF/指数のファンダメンタルズ (財務諸表・バリュエーション・比率) を EODHD から取得する (read-only)。',
      '**EODHD 仕様上、US 株 / ETF / 指数 (シンボル末尾 .US / .ETF / .INDX) のみ対応**。',
      'FX・ゴールド・コモディティは非対応 (=このツールを使わず news/sentiment/macro で代替)。',
      'filter で特定セクション取得、historical=1 で過去分。対象外シンボルは呼ばずにエラーを返す (poka-yoke)。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'EODHD 形式シンボル (.US / .ETF / .INDX のみ)' },
        filter: { type: 'string', description: '取得セクションの絞り込み (省略可)' },
        historical: { type: 'number', description: '1 で過去分も取得、0 で最新のみ (省略可)', enum: [0, 1] },
      },
      required: ['symbol'],
    },
    async execute(raw) {
      const input = FundamentalsInputSchema.parse(raw ?? {});
      // poka-yoke: 非対応シンボル (FX/コモディティ等) は API を叩かず明示エラーにする。
      if (!isEodhdFundamentalsSupported(input.symbol)) {
        throw new Error(
          `fetch_eodhd_fundamentals: '${input.symbol}' は非対応。EODHD fundamentals は .US / .ETF / .INDX のみ対応 (FX/コモディティは news/sentiment/macro を使う)`,
        );
      }
      return fn(input);
    },
  };
}

/**
 * 6 種の EODHD read-only リサーチスキルを registry に登録する。
 * register() は呼び出しごとに各スキルの具体型 (TInput/TOutput) を保つため、
 * 配列で homogenize せず個別 register することで `unknown` を回避する。
 */
export function registerEodhdResearchSkills(
  registry: SkillRegistry,
  deps: EodhdResearchSkillsDeps = {},
): void {
  registry.register(createFetchEodhdNewsSkill(deps));
  registry.register(createFetchEodhdSentimentsSkill(deps));
  registry.register(createFetchEodhdEconomicEventsSkill(deps));
  registry.register(createFetchEodhdMacroIndicatorSkill(deps));
  registry.register(createFetchEodhdEarningsSkill(deps));
  registry.register(createFetchEodhdFundamentalsSkill(deps));
}
