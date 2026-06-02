/**
 * レジーム別戦略集団（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.4
 */

import fs from 'fs/promises';
import path from 'path';

import type { StrategyDSL } from '../strategy_dsl/schema';
import { StrategyDSLSchema } from '../strategy_dsl/schema';
import type { DiversityEnforcer } from './DiversityEnforcer';

const DEFAULT_MAX = 50;

export interface StrategyPopulationPersistShape {
  version: 1;
  populations: Record<string, StrategyDSL[]>;
}

/**
 * 進化ループ再設計 Phase 4: population の永続化バックエンド抽象。
 * EvolutionPopulationRepository が構造的にこれを満たす（DB 永続化）。
 * 注入されていれば load/save は file ではなく DB 経由になる（ephemeral fs 対策）。
 */
export interface PopulationStore {
  loadAll(): Promise<Record<string, StrategyDSL[]>>;
  saveAll(populations: Record<string, readonly StrategyDSL[]>): Promise<void>;
}

export class StrategyPopulation {
  private populations: Map<string, StrategyDSL[]> = new Map();

  readonly maxSize = DEFAULT_MAX;

  /**
   * @param persistPath file 永続化パス（store 未注入時のみ使用、後方互換）
   * @param store       DB 永続化ストア（注入時はこちらを優先、cron 跨ぎ durable）
   */
  constructor(
    private readonly persistPath?: string,
    private readonly store?: PopulationStore,
  ) {}

  add(regime: string, strategy: StrategyDSL): void {
    const list = this.populations.get(regime) ?? [];
    list.push(strategy);
    if (list.length > this.maxSize) {
      list.shift();
    }
    this.populations.set(regime, list);
  }

  getByRegime(regime: string): StrategyDSL[] {
    return [...(this.populations.get(regime) ?? [])];
  }

  replaceRegime(regime: string, strategies: StrategyDSL[]): void {
    this.populations.set(regime, [...strategies].slice(-this.maxSize));
  }

  getElites(regime: string, count: number, scores: Map<string, number>): StrategyDSL[] {
    const list = this.getByRegime(regime);
    const ranked = [...list].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    return ranked.slice(0, count);
  }

  getLosers(regime: string, count: number, scores: Map<string, number>): StrategyDSL[] {
    const list = this.getByRegime(regime);
    const ranked = [...list].sort((a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0));
    return ranked.slice(0, count);
  }

  /** スコアが低い順に削除し、削除 ID を返す */
  pruneBySize(regime: string, scores: Map<string, number>): string[] {
    let list = this.getByRegime(regime);
    if (list.length <= this.maxSize) return [];
    const overflow = list.length - this.maxSize;
    const sortedWorst = [...list].sort(
      (a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0),
    );
    const removeIds = sortedWorst.slice(0, overflow).map((s) => s.id);
    const removeSet = new Set(removeIds);
    list = list.filter((s) => !removeSet.has(s.id));
    this.populations.set(regime, list);
    return removeIds;
  }

  /** スコアが低い順に count 件を集団から除く */
  removeWorst(regime: string, count: number, scores: Map<string, number>): void {
    const losers = this.getLosers(regime, count, scores);
    const ids = new Set(losers.map((l) => l.id));
    const list = this.getByRegime(regime).filter((s) => !ids.has(s.id));
    this.populations.set(regime, list);
  }

  pruneBySimilarity(regime: string, enforcer: DiversityEnforcer, threshold = 0.85): StrategyDSL[] {
    const list = this.getByRegime(regime);
    const removed: StrategyDSL[] = [];
    const kept: StrategyDSL[] = [];
    for (const s of list) {
      const dup = kept.some((k) => enforcer.similarity(k, s) >= threshold);
      if (dup) removed.push(s);
      else kept.push(s);
    }
    this.populations.set(regime, kept);
    return removed;
  }

  async save(): Promise<void> {
    // Phase 4: store 注入時は DB 永続化（best-effort、失敗してもループは継続）。
    if (this.store) {
      try {
        await this.store.saveAll(Object.fromEntries(this.populations.entries()));
      } catch (err) {
        // 保存失敗は次サイクルで再保存されるが、障害切り分けのため warn を残す。
        console.warn(
          `[StrategyPopulation] DB save 失敗（次サイクルで再保存）: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return;
    }
    if (!this.persistPath) return;
    const dir = path.dirname(this.persistPath);
    await fs.mkdir(dir, { recursive: true });
    const data: StrategyPopulationPersistShape = {
      version: 1,
      populations: Object.fromEntries(this.populations.entries()),
    };
    await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(): Promise<void> {
    // Phase 4: store 注入時は DB から復元（cron 跨ぎ durable）。失敗時は空集団で確定（種注入経路へ）。
    if (this.store) {
      // 先に clear して「復元失敗 → 空集団」を決定的にする（複数回 load でも空 fallback が成立）。
      this.populations.clear();
      try {
        const pops = await this.store.loadAll();
        for (const [regime, arr] of Object.entries(pops)) {
          this.populations.set(regime, arr.slice(-this.maxSize));
        }
      } catch (err) {
        console.warn(
          `[StrategyPopulation] DB load 失敗、空集団で継続（cold-start 種注入へ）: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return;
    }
    if (!this.persistPath) return;
    try {
      const raw = await fs.readFile(this.persistPath, 'utf-8');
      const parsed = JSON.parse(raw) as StrategyPopulationPersistShape;
      if (parsed.version !== 1 || !parsed.populations) return;
      this.populations.clear();
      for (const [regime, arr] of Object.entries(parsed.populations)) {
        const valid: StrategyDSL[] = [];
        for (const item of arr) {
          const r = StrategyDSLSchema.safeParse(item);
          if (r.success) valid.push(r.data);
        }
        this.populations.set(regime, valid.slice(-this.maxSize));
      }
    } catch {
      // ファイルなしは空のまま
    }
  }
}
