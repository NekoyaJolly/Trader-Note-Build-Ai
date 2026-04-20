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

export class StrategyPopulation {
  private populations: Map<string, StrategyDSL[]> = new Map();

  readonly maxSize = DEFAULT_MAX;

  /** 既定の永続化パス（リポジトリルート想定） */
  constructor(private readonly persistPath?: string) {}

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
