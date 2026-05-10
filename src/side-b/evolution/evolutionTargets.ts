export interface EvolutionTargetSet {
  name: string;
  description: string;
  minPf: number;
  minWinRate?: number;
  minRecoveryFactor?: number;
  minRiskReward?: number;
  maxDrawdown?: number;
}

export const EVOLUTION_TARGETS: EvolutionTargetSet[] = [
  {
    name: "王道・バランス安定型",
    description: "安定稼働EA水準",
    minPf: 1.5,
    minRecoveryFactor: 3.0,
  },
  {
    name: "高勝率・スキャルピング型",
    description: "薄利多売EA水準",
    minWinRate: 0.75,
    minPf: 1.4,
    minRiskReward: 0.5,
  },
  {
    name: "損小利大・トレンドフォロー型",
    description: "大相場狙いEA水準",
    minRiskReward: 2.0,
    minWinRate: 0.40,
    minPf: 1.5,
  },
  {
    name: "資金防衛・堅牢型",
    description: "低リスクEA水準",
    maxDrawdown: 10.0,
    minRecoveryFactor: 4.0,
    minPf: 1.3,
  },
  {
    name: "圧倒的ホームラン型",
    description: "超高収益EA水準",
    minPf: 2.5,
    minRecoveryFactor: 5.0,
  },
];

export const EVOLUTION_TARGETS_PROMPT_TEXT = `
## 進化ループの最終目標（EA運用水準・アーリーストップ条件）
以下のいずれかの条件セットを満たす戦略（最低取引数30回以上）が生成された場合、
その戦略は本番運用に耐えうると判断され、進化ループは即座に終了（ゴール）となります。

1. **王道・バランス安定型 (安定稼働EA水準)**
   - プロフィットファクター(PF): 1.5 以上
   - リカバリーファクター: 3.0 以上

2. **高勝率・スキャルピング型 (薄利多売EA水準)**
   - 勝率: 75% 以上
   - プロフィットファクター(PF): 1.4 以上
   - リスクリワード(RR): 0.5 以上

3. **損小利大・トレンドフォロー型 (大相場狙いEA水準)**
   - リスクリワード(RR): 2.0 以上
   - 勝率: 40% 以上
   - プロフィットファクター(PF): 1.5 以上

4. **資金防衛・堅牢型 (低リスクEA水準)**
   - 最大ドローダウン: 10% 以下
   - リカバリーファクター: 4.0 以上
   - プロフィットファクター(PF): 1.3 以上

5. **圧倒的ホームラン型 (超高収益EA水準)**
   - プロフィットファクター(PF): 2.5 以上
   - リカバリーファクター: 5.0 以上

AIエージェント達は、生成する戦略が上記のいずれかの水準に到達することを究極の目標として、
仮説生成・変異・評価の判断を行ってください。
`;
