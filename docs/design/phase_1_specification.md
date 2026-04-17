# フェーズ1 発注仕様書: 並列レンズ基盤の最小実装

> **期間目安**: 1〜2週間
> **目的**: 相場観を排他選択ではなく並列計算するための土台を作る
> **前提読み物**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` のセクション1(設計哲学)と セクション4(並列レンズ仕様)

---

## 1. このフェーズのゴール

既存の MarketAnalysis を壊さず、**レンズという抽象化** を導入する。このフェーズ完了時点で、システムには2つのレンズ(既存機能のラップ + 時間帯判定)が並列で動いており、エッジ台帳は両レンズの出力を同時に記録できる状態になる。

**このフェーズで "新しい相場分析機能" を足すことが目的ではない**。土台だけ作る。

---

## 2. 完了条件

以下の全てを満たす:

- [x] `Lens` インターフェースが `src/side-b/lenses/types.ts` に定義されている
- [x] `CurrentAnalysisLens` クラスが実装され、既存の MarketAnalysis の結果をラップして返す
- [x] `TimeSessionLens` クラスが実装され、主要市場セッションの状態を返す
- [x] `LensAggregator` が実装され、全登録レンズを並列実行して統合結果を返す
- [x] `AITradeNote` スキーマに `lensSnapshot` フィールドが追加されている(オプショナル)
- [x] 既存のトレードフロー(Research → Plan → Trade → Reflection)が従来通り動作する（PDCA 配線は Phase 3 のため、Phase 1 完了時点で既存パイプは無変更）
- [x] 新レンズのユニットテストが書かれている(決定性テスト含む)
- [x] 既存のテストが全て通る（aiTradeNote 45/45, lenses 28/28）

**Phase 1 完了**: 2026-04-17 実装・コミット済み。コミット履歴は `git log --oneline --grep="Phase 1"`。

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)
- `src/side-b/lenses/types.ts` (新規)
- `src/side-b/lenses/LensAggregator.ts` (新規)
- `src/side-b/lenses/CurrentAnalysisLens.ts` (新規)
- `src/side-b/lenses/TimeSessionLens.ts` (新規)
- `src/side-b/lenses/index.ts` (新規、エクスポート集約)
- `src/side-b/tests/lenses/*.test.ts` (新規)

### 触っていい(拡張のみ)
- `src/side-b/models/aiTradeNote.ts` ― `lensSnapshot` フィールドをオプショナルで追加のみ
- `src/side-b/models/index.ts` ― 新規型のエクスポートを追加のみ

### 触ってはいけない
- `src/side-b/agent/pdcaLoop.ts` (フェーズ2以降)
- `src/side-b/services/planAIService.ts` (フェーズ2以降)
- `src/side-b/services/reflectionAIService.ts` (フェーズ2以降)
- `src/side-b/knowledge/*.ts` (フェーズ2以降で整理)
- 既存の MarketAnalysis 関連のコア機能
- UI 関連のコード(このフェーズでは UI 変更なし)

---

## 4. 実装仕様

### 4.1 Lens インターフェース

`src/side-b/lenses/types.ts` に以下を定義する:

```typescript
/**
 * 相場観レンズの入力データ
 * 既存の MarketResearch や OHLCV データをラップした形
 */
export interface LensInput {
  symbol: string;
  timeframe: string;
  timestamp: Date;
  ohlcv?: OHLCVSnapshot;
  indicators?: Record<string, number>;
  // 既存の MarketAnalysis 結果を渡したい場合
  existingAnalysis?: MarketAnalysis;
}

/**
 * レンズが出力する特徴量
 */
export interface LensFeature {
  readonly lensName: string;
  readonly lensVersion: string;
  readonly features: Record<string, number | string | boolean>;
  readonly computedAt: Date;
  readonly computeDurationMs?: number;
  readonly confidence?: number;
}

/**
 * レンズのインターフェース
 * 
 * 実装規約:
 * - 副作用なし(純関数に近い実装)
 * - 他レンズへの依存禁止
 * - 決定性あり(同じ入力 → 同じ出力)
 * - ランダム要素禁止
 */
export interface Lens {
  readonly name: string;
  readonly version: string;
  readonly dependencies: ReadonlyArray<keyof LensInput>;
  
  compute(input: LensInput): Promise<LensFeature>;
}

/**
 * 全レンズ出力の統合結果
 */
export interface LensFeatureSnapshot {
  timestamp: Date;
  symbol: string;
  features: Map<string, LensFeature>;  // lensName をキーとする
  totalComputeDurationMs: number;
}
```

### 4.2 CurrentAnalysisLens

`src/side-b/lenses/CurrentAnalysisLens.ts`

既存の MarketAnalysis を呼び出す薄いラッパー。**既存ロジックは一切変更しない**。単に Lens インターフェースに適合させるだけ。

```typescript
export class CurrentAnalysisLens implements Lens {
  readonly name = 'current_analysis';
  readonly version = '1.0.0';
  readonly dependencies = ['symbol', 'ohlcv'] as const;
  
  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    
    // 既存の MarketAnalysis ロジックを呼ぶ
    // input.existingAnalysis があればそれを使う、なければ新規計算
    const analysis = input.existingAnalysis ?? await this.runExistingAnalysis(input);
    
    // 既存の 12次元特徴量や主要値を features に展開
    const features: Record<string, number | string | boolean> = {
      regime: analysis.regime,
      trend_direction: analysis.reasoning?.trendAnalysis ? 1 : 0,
      trend_strength: analysis.quickScores?.trendStrength ?? 50,
      momentum: analysis.quickScores?.momentum ?? 50,
      volatility: analysis.quickScores?.volatility ?? 50,
      support_proximity: analysis.quickScores?.supportProximity ?? 50,
      resistance_proximity: analysis.quickScores?.resistanceProximity ?? 50,
      confidence: analysis.confidence,
      // 12次元特徴量があればそれも展開
    };
    
    return {
      lensName: this.name,
      lensVersion: this.version,
      features,
      computedAt: new Date(),
      computeDurationMs: Date.now() - start,
      confidence: analysis.confidence / 100,
    };
  }
  
  private async runExistingAnalysis(input: LensInput): Promise<MarketAnalysis> {
    // 既存の marketAnalystService 等を呼び出す
    // 実装時に既存コードのインポート経路を確認すること
  }
}
```

### 4.3 TimeSessionLens

`src/side-b/lenses/TimeSessionLens.ts`

時刻から主要市場セッションの状態を判定する。LLM不要、純粋な時刻計算のみ。

出力する features:
- `utc_hour`: number (0-23)
- `utc_minute`: number (0-59)
- `tokyo_active`: boolean (東京時間 JST 9-15 ≒ UTC 0-6)
- `london_active`: boolean (ロンドン時間 UTC 8-16)
- `ny_active`: boolean (NY時間 UTC 13-21)
- `overlap_london_ny`: boolean (UTC 13-16)
- `overlap_tokyo_london`: boolean (UTC ~8)
- `minutes_since_tokyo_open`: number (-1 if not today)
- `minutes_since_london_open`: number (-1 if not today)
- `minutes_since_ny_open`: number (-1 if not today)
- `day_of_week`: number (0=日曜 6=土曜)
- `is_weekend`: boolean
- `is_monday_open`: boolean (月曜の最初の4時間)
- `is_friday_close`: boolean (金曜の最後の4時間)

**注意**: FX の週末(土曜 UTC ~22-月曜 UTC ~22)の判定も含める。

### 4.4 LensAggregator

`src/side-b/lenses/LensAggregator.ts`

複数のレンズを登録・管理し、並列実行して統合結果を返すクラス。

```typescript
export class LensAggregator {
  private lenses: Map<string, Lens> = new Map();
  
  register(lens: Lens): void {
    if (this.lenses.has(lens.name)) {
      throw new Error(`Lens ${lens.name} already registered`);
    }
    this.lenses.set(lens.name, lens);
  }
  
  unregister(lensName: string): void {
    this.lenses.delete(lensName);
  }
  
  getRegisteredLenses(): string[] {
    return Array.from(this.lenses.keys());
  }
  
  async computeAll(input: LensInput): Promise<LensFeatureSnapshot> {
    const start = Date.now();
    
    // 並列実行(Promise.allSettled で片方のレンズ失敗が全体を止めない設計)
    const results = await Promise.allSettled(
      Array.from(this.lenses.values()).map(lens => lens.compute(input))
    );
    
    const features = new Map<string, LensFeature>();
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const lens = Array.from(this.lenses.values())[i];
      
      if (result.status === 'fulfilled') {
        features.set(lens.name, result.value);
      } else {
        console.error(`[LensAggregator] ${lens.name} failed:`, result.reason);
        // 失敗したレンズは features に含めない(nullを入れない)
      }
    }
    
    return {
      timestamp: input.timestamp,
      symbol: input.symbol,
      features,
      totalComputeDurationMs: Date.now() - start,
    };
  }
}

// シングルトン or デフォルトインスタンス
export const defaultLensAggregator = new LensAggregator();
defaultLensAggregator.register(new CurrentAnalysisLens());
defaultLensAggregator.register(new TimeSessionLens());
```

### 4.5 AITradeNote スキーマ拡張

`src/side-b/models/aiTradeNote.ts` の `AITradeNote` 型に以下をオプショナル追加:

```typescript
export interface AITradeNote {
  // ... 既存フィールド ...
  
  /** 
   * レンズ特徴量スナップショット(フェーズ1で追加)
   * トレード時点での全レンズ出力
   */
  lensSnapshot?: {
    timestamp: string;
    features: Record<string, Record<string, number | string | boolean>>;
    // 例: { "current_analysis": { "regime": "uptrend", ... }, "time_session": { "ny_active": true, ... } }
  };
}
```

**重要**: 既存のデータ読み取りコードが破綻しないよう、必ず `?` で optional にする。

### 4.6 テスト

`src/side-b/tests/lenses/` に以下のテストを作成:

- `lensAggregator.test.ts`
  - レンズ登録・削除のテスト
  - 並列実行の結果統合テスト
  - 一部レンズ失敗時の他レンズ結果保持テスト
- `timeSessionLens.test.ts`
  - 各時間帯の境界値テスト(UTC 0時、8時、13時、21時、22時)
  - 週末判定テスト
  - 同じ入力で同じ出力(決定性)テスト
- `currentAnalysisLens.test.ts`
  - 既存 MarketAnalysis の結果を正しくラップしているかのテスト
  - モック MarketAnalysis に対する features 展開テスト

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと(意図的な制限)

- レンズの出力を PDCA ループに統合すること(フェーズ2で)
- 新レンズを Strategy Thinker のプロンプトに反映すること(フェーズ2で)
- ダウ理論レンズ、ボラ状態レンズの実装(フェーズ3で)
- エッジ台帳の類似度検索への活用(後のフェーズで)
- UI への反映(後のフェーズで)

### 5.2 レンズ実装のよくある罠

- **時刻をローカルタイムゾーンで処理してしまう** → 必ず UTC で処理、表示時だけ変換
- **ランダム要素を入れてしまう** → レンズは決定的でなければならない
- **他レンズの出力を参照したくなる** → 禁止。必要なら元データから再計算
- **重い処理を入れる** → レンズは軽量に。重い処理が必要ならこのフェーズの範囲外として相談

### 5.3 エッジケース

- OHLCV データが不足している場合 → `confidence: 0` を設定し、features は空でも可
- タイムスタンプが未来の場合 → 例外を投げる
- 同じレンズを2回登録 → 2回目はエラー

---

## 6. 完了報告時に含めること

Claude Code が「完了しました」と報告する際、以下を含める:

1. 作成/変更したファイルの一覧
2. 追加したテストの実行結果(全て通ることの確認)
3. 既存テストの実行結果(全て通ることの確認)
4. `TimeSessionLens` の実行サンプル出力
5. `LensAggregator.computeAll()` のサンプル出力
6. 次フェーズ(フェーズ2)に向けた引き継ぎメモ(あれば)

---

## 7. レビュー観点(ユーザー側で確認すること)

Claude Code の報告を受けた後、ユーザーは以下をチェック:

- 既存の Side-B パイプラインが従来通り動作するか(実際に1サイクル回す)
- 新しいレンズ基盤が並行して稼働しているか(ログで確認)
- データ構造の後方互換が保たれているか(過去の AITradeNote が読めるか)

問題なければフェーズ2の発注書に進む。
