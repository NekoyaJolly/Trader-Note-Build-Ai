/**
 * 進化ループ再設計 Phase 4: EvolutionPopulation Repository。
 *
 * regime 別の戦略集団スナップショットを DB 永続化し、cron 起動を跨いで population を持ち越す。
 * これにより cold-start の種注入が真に「初回のみ」になる（P4: ephemeral fs で毎ラン再注入していた）。
 *
 * 設計方針（evolutionInstanceCarryRepository と同じ）:
 * - members は StrategyDSLSchema で load 時に厳密検証（不正データで EvolutionLoop が壊れない）
 * - 復元失敗（Zod 不適合 / DB 例外）はその regime をスキップ（= 空のまま、種注入経路に倒れる）
 * - 1 regime = 1 行（最新スナップショット）。saveAll は regime ごとに upsert。
 */

import { z } from 'zod';

import { prisma } from '../db/client';
import { toPrismaJsonValue } from '../../utils/prismaJson';
import { StrategyDSLSchema, type StrategyDSL } from '../../side-b/strategy_dsl/schema';

const MembersSchema = z.array(StrategyDSLSchema);

export type EvolutionPopulationRepoMethods = 'loadAll' | 'saveAll';

export class EvolutionPopulationRepository {
  /**
   * 全 regime の population スナップショットを読み込む。
   * 不正 JSON / Zod 不適合の member は除外し、regime は valid な member のみで復元する。
   */
  async loadAll(): Promise<Record<string, StrategyDSL[]>> {
    const rows = await prisma.evolutionPopulation.findMany();
    const out: Record<string, StrategyDSL[]> = {};
    for (const row of rows) {
      const parsed = MembersSchema.safeParse(row.members);
      if (parsed.success) {
        out[row.regime] = parsed.data;
      } else {
        // member 配列ごと不適合なら、要素単位で救済（壊れた 1 件で regime 全滅させない）。
        const arr = Array.isArray(row.members) ? row.members : [];
        const valid: StrategyDSL[] = [];
        for (const item of arr) {
          const r = StrategyDSLSchema.safeParse(item);
          if (r.success) valid.push(r.data);
        }
        out[row.regime] = valid;
      }
    }
    return out;
  }

  /** 全 regime の population を upsert で保存する（regime をキーに最新スナップショットを置換）。 */
  async saveAll(populations: Record<string, readonly StrategyDSL[]>): Promise<void> {
    for (const [regime, members] of Object.entries(populations)) {
      const json = toPrismaJsonValue([...members]);
      await prisma.evolutionPopulation.upsert({
        where: { regime },
        create: { regime, members: json },
        update: { members: json },
      });
    }
  }
}

export const evolutionPopulationRepository = new EvolutionPopulationRepository();
