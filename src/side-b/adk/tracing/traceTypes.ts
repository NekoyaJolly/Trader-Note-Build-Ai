/**
 * AdkTraceEvent / TracePayloadSummary 型定義 (Step 2 Phase 2)
 *
 * adapter (`skillRegistryToAdkTools`) の `execute` 内で生成する内部 trace event の型。
 *
 * 設計書: docs/architecture/STEP_2_ADK_TRACING_SPIKE.md §3
 * 上位設計: docs/architecture/STEP_2_KICKOFF.md §5
 *
 * 重要な実装方針 (KICKOFF §5.2 / Spike §3.1):
 * - **raw payload を保存しない** (= LLM prompt / response / 売買仮説全文 / DB row 等は禁止)
 * - args / result は `TracePayloadSummary` (field 数 + 上位キー名のみ) に縮約してから記録
 * - error message は保存 OK だが、巨大文字列は短縮して保存
 * - error details (元 Error / stack trace 等) は保存しない
 * - 保存可能な ID 系は ADK Context 由来のみ (agentName / invocationId / functionCallId)
 *
 * 依存方向: adk → 標準ライブラリ のみ。`adapters/` / `skills/` から本書を import しない (逆方向)
 */

// ============================================================================
// trace event の種類
// ============================================================================

/**
 * trace event の kind (start / completed / failed)。
 *
 * **Skill 実行 (Step 2 Phase 3 で導入)**:
 * - `adk.skill.started`: adapter が `execute` 内に入った直後 (Zod parse 後)
 * - `adk.skill.completed`: Skill が成功 (`SkillResult.ok === true`) して return
 * - `adk.skill.failed`: Skill が失敗 (`SkillResult.ok === false`) または adapter 外で throw
 *
 * **Sub-Agent 実行 (Step 3 Phase 2 で追加)**:
 * - `adk.subagent.started`: SequentialAgent の sub-agent が `runAsync` を開始
 * - `adk.subagent.completed`: sub-agent が正常完了 (例外なく runAsync が終了)
 * - `adk.subagent.failed`: sub-agent 実行中に例外が発生
 *
 * Sub-Agent 系の event では、`skillName` フィールドを **step 識別子 (= sub-agent 名)**
 * として再利用する。`kind` 値が discriminant となり、Skill 名と sub-agent 名のどちらを
 * 指しているかが判別できる。新規フィールドの追加は行わず、Step 1/2 の既存テストを
 * 未改変で全 pass にする (KICKOFF §3.1)。
 */
export type AdkTraceEventKind =
  | 'adk.skill.started'
  | 'adk.skill.completed'
  | 'adk.skill.failed'
  | 'adk.subagent.started'
  | 'adk.subagent.completed'
  | 'adk.subagent.failed';

/**
 * trace event の結果状態。
 *
 * - `started`: 開始 event 専用 (まだ結果が出ていない)
 * - `ok`: Skill が `SkillResult.ok === true` で完了
 * - `error`: Skill が `SkillResult.ok === false` で完了 (= invoke が wrap した想定内エラー)
 * - `thrown`: ADK の Zod validation 等で adapter 外側で throw が発生 (想定外)
 */
export type AdkTraceStatus = 'started' | 'ok' | 'error' | 'thrown';

// ============================================================================
// payload summary
// ============================================================================

/**
 * args / result の payload を直接保存しないための要約型。
 *
 * **絶対に保存しない**:
 * - LLM prompt / response の全文
 * - 売買仮説 / バックテスト結果の本体
 * - DB row 全体
 * - API key / token / cookie
 * - user input 全文
 *
 * **保存してよい**:
 * - field 数 (`fieldCount`): object のキー数や array の要素数
 * - 上位キー名 (`topLevelKeys`): object の直下 key 名 (上限あり)
 * - primitive 型名 (`primitiveType`): object/array でない場合の typeof 結果 (`'string'` / `'number'` 等)
 *
 * `redacted: true` リテラルは「これは要約であり raw payload ではない」という型レベルのマーカー。
 * うっかり raw payload を保存しようとすると型エラーになる。
 */
export interface TracePayloadSummary {
  readonly fieldCount?: number;
  readonly topLevelKeys?: readonly string[];
  readonly primitiveType?:
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'undefined'
    | 'bigint'
    | 'symbol'
    | 'function';
  /** redacted: 必ず true。型レベルで raw 保存を防ぐマーカー。 */
  readonly redacted: true;
}

// ============================================================================
// trace event 本体
// ============================================================================

/**
 * ADK 経由の実行を表す内部 trace event。
 *
 * **対応する実行系統** (kind で discriminant):
 * - `adk.skill.*` (Step 2 Phase 3 で導入): adapter (`skillRegistryToAdkTools`) の `execute` 内で
 *   生成され、`TraceSink.record()` に渡される。`skillName` には `Skill.name` が入る。
 * - `adk.subagent.*` (Step 3 Phase 2 で追加): SequentialAgent の sub-agent (BaseAgent サブクラス) の
 *   `runAsyncImpl` 内で生成され、同じ `TraceSink.record()` 経路で渡される。`skillName` には
 *   sub-agent 名 (`BaseAgent.name`) が入る (step 識別子としての再利用)。
 *
 * **重要 (両系統共通)**:
 * - `argsSummary` / `resultSummary` は `TracePayloadSummary` のみ。raw object は保存しない
 * - `errorMessage` は保存 OK だが、巨大文字列は呼び出し側 (`traceSummaries.shortenErrorMessage`) で短縮
 * - `errorDetails` フィールドは**存在しない** (= 型レベルで元 Error 等の保存を禁止)
 * - `traceId` は emitter (adapter / sub-agent) が生成 (UUID 等)。`parentTraceId` で started と
 *   completed/failed を紐付ける
 * - `TraceSink.record()` の失敗は emitter 側で握りつぶし、本処理を壊さない (`KICKOFF` §6.3)
 */
export interface AdkTraceEvent {
  /** event の kind (start / completed / failed)。 */
  readonly kind: AdkTraceEventKind;

  /** この event 固有の ID (adapter が生成。UUID 想定)。 */
  readonly traceId: string;

  /** 連続イベントの紐付け用。started → completed/failed で同じ親 ID を参照。 */
  readonly parentTraceId?: string;

  /** ADK `Context.invocationId` (取れる場合のみ)。 */
  readonly invocationId?: string;

  /** ADK `Context.functionCallId` (取れる場合のみ)。LLM が割り振った tool call ID。 */
  readonly functionCallId?: string;

  /** ADK `Context.agentName` または adapter のフォールバック値。 */
  readonly agentName: string;

  /**
   * step 識別子。
   * - `adk.skill.*` event では adapter が把握している Skill 名 (= `Skill.name`)
   * - `adk.subagent.*` event では SequentialAgent の sub-agent 名 (= `BaseAgent.name`)
   *
   * `kind` を discriminant にしてどちらを指しているか判別する。新規フィールドの追加
   * を避け Step 1/2 既存テストの互換性を維持する目的で、命名は `skillName` のまま維持。
   */
  readonly skillName: string;

  /** adapter 側の固定文字列 (Step 1 で確立した `ADK_DEFAULT_CALLER_REASON`)。 */
  readonly callerReason: string;

  /** event 開始時刻 (started では event 発生時刻、completed/failed では Skill 開始時刻)。 */
  readonly startedAt: Date;

  /** event 終了時刻 (completed/failed のみ)。 */
  readonly endedAt?: Date;

  /** 経過時間 (completed/failed のみ、`endedAt - startedAt`)。 */
  readonly durationMs?: number;

  /** event 結果状態。 */
  readonly status: AdkTraceStatus;

  /** error code (`SkillResult.error.code` または `'EXCEPTION'` 等。失敗時のみ)。 */
  readonly errorCode?: string;

  /** error message (短縮済み。失敗時のみ)。raw stack trace や details は保存しない。 */
  readonly errorMessage?: string;

  /** args の要約 (raw 引数は保存しない)。 */
  readonly argsSummary?: TracePayloadSummary;

  /** result の要約 (raw 結果は保存しない)。 */
  readonly resultSummary?: TracePayloadSummary;
}
