/**
 * Filter Evolution Phase D-1b (2026-05-09): GenerationLessonCategory の Zod enum を
 * 副作用のないスキーマ専用モジュールに切り出したもの。
 *
 * PR #145 Copilot review #7 対応:
 * - 元は `src/backend/repositories/generationLessonRepository.ts` で定義していたが、
 *   その import が prisma client / DB 層実装を引き連れる副作用を持つため、
 *   Agent 側 (= 副作用ゼロが望ましい) からの参照に独立モジュールを用意。
 * - repo / agent / その他の参照箇所はすべてこのモジュールから import する形に統一。
 *
 * 値の追加時は `GenerationReflectionAgent` の prompt md (= 設計書 §5.D.1) も同期更新する。
 */

import { z } from 'zod';

/**
 * GenerationReflectionAgent が出すカテゴリの Zod 列挙 (= 設計書 §5.D.1)。
 *
 * - `breakthrough`: 当世代で promotion top-K に届く child が増えた等の突破
 * - `stagnation`: 直前世代と比べて改善も劣化も見えない停滞
 * - `mutation_decay`: mutation 由来 child の Lift / promotion 率が継続的に低い
 * - `novelty_emerged`: novelty seed / 新規 filter category 由来の child が初めて promotion 候補に登場
 * - `regime_shift_detected`: regime ごとの結果分布が前世代と大きく変化
 * - `filter_efficacy_increased`: 特定 filter category の Lift / 採用率が上昇
 * - `other`: 上記 6 種のいずれにも当てはまらない観察 (= LLM 判断の fallback)
 */
export const GenerationLessonCategorySchema = z.enum([
  'breakthrough',
  'stagnation',
  'mutation_decay',
  'novelty_emerged',
  'regime_shift_detected',
  'filter_efficacy_increased',
  'other',
]);

export type GenerationLessonCategory = z.infer<typeof GenerationLessonCategorySchema>;
