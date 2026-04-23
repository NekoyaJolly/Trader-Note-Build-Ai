# 自律型トレーディングAI 設計ドキュメント一式

> 自律型トレーディング AI システム(Side-B)の設計ドキュメント群。プロジェクトの `docs/design/` 配下に配置する想定。
> 最終更新: Phase 5.5 完了時点

---

## 1. 現在の実装ステータス

| フェーズ | 内容 | ステータス |
|---------|------|----------|
| 1 | 並列レンズ基盤(current_analysis, time_session) | ✅ 完了 |
| 2 | AIロール分化(Devil's Advocate, Strategy Thinker 3ステップ) | ✅ 完了 |
| 3 | レンズ拡張(dow_theory, volatility_regime) | ✅ 完了 |
| 4a | エッジ台帳、HypothesisGenerator、Discovery AI | ✅ 完了 |
| 4b(縮小版) | Note 統一基盤、事前スクリーニング | ✅ 完了 |
| 4c | 検証ツール群(WF/MC/BH)+ 2層エージェント | ✅ 完了 |
| 4d | Side-B 検証UI 完全実装 | ✅ 完了 |
| 5A | 戦略 DSL、進化ループ(候補生成まで) | ✅ 完了 |
| 5.5 | スキル基盤 MVP | ✅ 完了 |
| 5B | 進化候補の Phase 4c 接続 | ⏳ 未実装(運用観察後) |
| 6.1 | プロンプト進化基盤 | ⏳ 未実装 |
| 6.2 | Elliott Simple Lens | ⏳ 未実装 |
| 6.3 | SMC Lens | ⏳ 未実装 |

---

## 2. ファイル一覧と役割

### 2.1 全体設計書

| ファイル | 役割 |
|---------|------|
| `DESIGN_DOC_autonomous_trading_architecture.md` | 全体設計書。哲学・アーキテクチャ・最終形を記述 |
| `CLAUDE_md_supplement.md` | 既存 CLAUDE.md への追補。Claude Code が毎回参照する短い指針 |
| `README.md` | このファイル |

### 2.2 実装済みフェーズ仕様書

| ファイル | 内容 |
|---------|------|
| `phase_1_specification.md` | 並列レンズ基盤の最小実装 |
| `phase_2_specification.md` | AIロール分化の最小版 |
| `phase_3_specification.md` | レンズ拡張(ダウ理論、ボラ状態) |
| `phase_4_specification.md` | Phase 4a: エッジ台帳 + エージェント拡張 |
| `phase_4b_specification.md` | Phase 4b 縮小版: Note 統一基盤 + スクリーニング |
| `phase_4c_specification.md` | Phase 4c: 検証ツール群と 2層エージェント |
| `phase_4d_specification.md` | Phase 4d: Side-B 検証UI 完全実装 |
| `phase_5a_specification.md` | Phase 5A: 戦略 DSL + 進化ループ(候補生成まで) |
| `phase_5_5_specification.md` | Phase 5.5: スキル基盤 MVP |

### 2.3 未実装フェーズ仕様書

| ファイル | 内容 |
|---------|------|
| `phase_5b_specification.md` | Phase 5B: 進化候補の Phase 4c 接続(設計ドラフト、運用観察後に着手) |
| `phase_6_specification.md` | Phase 6: プロンプト進化 + Elliott/SMC レンズ(3 サブフェーズ構成) |

### 2.4 退役したファイル

| ファイル | 理由 |
|---------|------|
| `archive/phase_4b_specification_DEPRECATED.md` | Phase 4b 縮小版への移行で退役(新版に置換) |
| `archive/phase_5_specification_DEPRECATED.md` | Phase 5A/5B 分割で退役(新版に置換) |

**注**: DEPRECATED ファイルは `archive/` サブディレクトリに退避し、誤読を防ぐ。Claude Code への発注時は必ず新版を参照するよう明示的に指示する。

---

## 3. ディレクトリ配置のおすすめ

```
project-root/
├── CLAUDE.md                          ← 既存。末尾に CLAUDE_md_supplement.md の内容を追記
└── docs/
    └── design/
        ├── README.md                  ← このファイル
        ├── DESIGN_DOC_autonomous_trading_architecture.md
        ├── phase_1_specification.md
        ├── phase_2_specification.md
        ├── phase_3_specification.md
        ├── phase_4_specification.md
        ├── phase_4b_specification.md
        ├── phase_4c_specification.md
        ├── phase_4d_specification.md
        ├── phase_5a_specification.md
        ├── phase_5_5_specification.md
        ├── phase_5b_specification.md
        ├── phase_6_specification.md
        └── archive/
            ├── phase_4b_specification_DEPRECATED.md
            └── phase_5_specification_DEPRECATED.md
```

---

## 4. 使い方のフロー

### 4.1 初回セットアップ

1. `CLAUDE_md_supplement.md` の内容を、既存の `CLAUDE.md` の末尾に追記
2. `docs/design/` ディレクトリに全ファイルを配置
3. DEPRECATED ファイルを `archive/` に移動
4. 設計書 `DESIGN_DOC_autonomous_trading_architecture.md` を一度通して読む

### 4.2 各フェーズ開始時の発注テンプレ

Claude Code の新しいセッションで発注:

```
フェーズ[N]を着手してほしい。

前提として以下を読み込んで:
- CLAUDE.md (プロジェクトルート)
- docs/design/DESIGN_DOC_autonomous_trading_architecture.md (全体設計)
- docs/design/phase_[N]_specification.md (このフェーズの仕様書)

絶対に読んではいけないファイル:
- docs/design/archive/ 配下の DEPRECATED ファイル

特に徹底してほしい:
1. 「触ってはいけない」リストに載っているファイルは絶対に変更しない
2. 仕様書の「完了条件」を全て満たすまで実装する
3. 不明点があったら勝手に決めず、私に確認する
4. Side-A のコード(src/services/, src/backend/)には手を入れない(協業パートナー原則)

よろしく。
```

### 4.3 各フェーズ完了時の確認

Claude Code が完了報告を出したら:

1. 仕様書の「レビュー観点」を見ながらチェック
2. 既存機能が従来通り動くか確認(実際に1サイクル回す)
3. 問題なければコミット(フェーズ単位で1コミット推奨)
4. 運用観察期間(最低2週間)を挟む

### 4.4 仕様書の更新

実装中に設計の穴や改善が見つかったら:

1. 該当フェーズの仕様書に追記 or 改訂
2. 大きな設計変更の場合は、DEPRECATED 化して新版を作成(Phase 4b, Phase 5 の前例)
3. `DESIGN_DOC` と `README` にも反映
4. **仕様書は生きたドキュメント**

---

## 5. Claude Code への発注のコツ

### 5.1 発注の基本原則

❌ **悪い発注例**
- 「エージェントを賢くして」
- 「レンズを追加してほしい」
- 「この機能作って、ついでにあっちも直して」

⭕ **良い発注例**
- 「phase_3_specification.md の仕様を実装してほしい。完了条件を全て満たすまで」
- 「仕様書の『触ってはいけない』リストに載っているファイルは絶対に変更しないこと」
- 「不明点は勝手に決めず、私に聞いてほしい」

### 5.2 1セッション1フェーズの原則

**1回の Claude Code セッションで扱うのは1フェーズまで**。フェーズ跨ぎの発注は:

- コンテキストが肥大化して精度が落ちる
- 変更範囲が広がりすぎてレビューできない
- 後戻りが難しくなる

フェーズ完了 → 新セッション → 次フェーズ、のリズムを守る。

例外: Phase 6 のように 3 サブフェーズを含むフェーズは、まとめて発注可能(ただし Claude Code が各サブフェーズを順次コミットすること)。

### 5.3 進捗確認のタイミング

長いフェーズでは途中経過を聞く:

- 「ここまでの実装をサマリーで報告してほしい」
- 「残りの完了条件はどれ?」
- 「今の実装で設計書の原則に反しているところはない?」

Claude Code は走り続けると方向がずれることがある。**定期的な自己確認を促す**。

### 5.4 他 AI との壁打ちの価値

大きな設計判断で迷ったら、Claude(設計側)とは別の AI との壁打ちを推奨:

- 実装中の AI は実装の流れに引きずられやすい
- 外部視点で「設計の整合性」を問い直すと、盲点が見つかる
- Phase 5A への縮小判断はこの手法で得られた

この手法は実証済み。「急ぎすぎて意味論を壊すリスク」を回避できる。

---

## 6. 設計ドキュメントの維持管理

### 6.1 設計が変わったとき

実装を進める中で「この設計、実はこうした方がいい」と分かることがある。その時は:

1. まず該当フェーズの **運用を止めない**(動いてるものは動かしたまま)
2. `DESIGN_DOC_autonomous_trading_architecture.md` に **判明した事実** を追記
3. 次フェーズ以降の仕様書に **対応方針** を反映
4. 必要なら過去フェーズの成果物を改修(その場合、旧仕様書を DEPRECATED 化して新版を作成)

### 6.2 フェーズ分割の判断基準

Phase 4 → 4a/4b/4c/4d、Phase 5 → 5A/5B の分割から得た教訓:

以下のシグナルが出たらフェーズ分割を検討:

- 一つのフェーズで複数の独立した機能を扱っている
- 実装途中で構造的問題が判明し、範囲の切り直しが必要
- あるサブ機能だけ先に完成させて運用観察したい
- 設計判断材料が不足しており、運用観察後に続きを設計したい

**小さく分けて確実に進める方が、大きく進めて手戻りするより早い**。

### 6.3 未実装項目のトラッキング

運用観察で見えてきた課題は以下に分類:

- **拡張アイデア**: 新しいレンズ・エージェント・機能
- **改善アイデア**: 既存機能の品質向上
- **発見されたバグ・挙動の癖**

これらは新たなフェーズ or マイクロフェーズとして順次仕様化する。

---

## 7. このアーキテクチャの核心を忘れないために

実装を進める中で細部に埋もれると忘れがちなので、再掲する:

### 7.1 設計哲学 7原則

1. 優先順位ではなく、判断品質のメタルールを与える
2. レンズは排他選択ではなく並列計算
3. LLMに期待することを限定する
4. 検証可能性を絶対に捨てない
5. 人間との共通言語を維持する
6. 勝ちを急がない
7. 協業パートナーとしての Side-A / Side-B

### 7.2 積み上げ順序は交換不可能

柱2(レンズ基盤) → 柱1(エージェント) → 柱3(進化ループ) → 柱4(スキル基盤)。この順でないと後続が成立しない。

### 7.3 Note 統一モデル

全ての戦略的知恵は Note に統一表現される。どんな経路で生まれたアイディアも、最終的には Note として保存され、同じ検証パイプラインを通る。

### 7.4 既存を壊さない

新機能は常にラッパーか拡張として足す。後方互換を維持する。UIを止めない。Side-A と Side-B は協業パートナーであり、互いを壊さない。

### 7.5 勝ちではなく台帳の成長を主指標にする

短期的に勝つ戦略より、検証済みエッジが台帳に積み上がることのほうが重要。

### 7.6 統計的検証を飛ばさない

全ての confirmed は Phase 4c のフル検証(WF/MC/BH)を通っている保証を維持する。意味論的な妥協をしない。

---

## 8. 実装進行履歴(簡潔版)

### 2025〜2026年春(実装開始から Phase 5.5 完了まで)

- 設計書一式作成、Phase 1-3 完了(基盤レンズ整備)
- Phase 4a 完了(エッジ台帳、仮説生成、週次発見)
- Phase 4 分岐判明: Side-A 検証基盤との接続で構造問題、Phase 4a/4b/4c/4d に分割
- Phase 4b 縮小版完了(Note 統一、スクリーニング)
- Phase 4c 完了(2層エージェント、Python 検証ツール群、Docker)
- Phase 4d 完了(Side-B 検証UI)
- Phase 5A 実装完了、その後他 AI との壁打ちで自動 confirmed 昇格が confirmed の意味論を壊すと判明
- Phase 5 → Phase 5A/5B 分割、自動昇格機能を撤退、表示ヘルパーで UI 修正
- Phase 5.5 完了(スキル基盤 MVP)

### 次のステップ

- 運用観察期間(数週間〜数ヶ月)
- Phase 6.1(プロンプト進化基盤)着手
- Phase 6.2(Elliott Simple Lens)
- Phase 6.3(SMC Lens)
- 運用観察データを経て Phase 5B 設計判断

---

## 9. 最後に

このプロジェクトは「設計と実装を並走させる」パターンで進んできた。途中で構造的問題が何度も発覚し、そのたびに設計を書き直してきた。

その過程で得られた最大の教訓は:

**完璧な設計書は最初から書けない。実装で見えた事実を設計書に反映し、設計書で実装を導く。この往復運動こそが、複雑なシステムを育てる正しい方法**。

設計書一式は、あなたの思考の結晶であり、将来の自分(と Claude Code)への指示書でもある。これからも育てていく。

**一歩ずつ。次はフェーズ6。**

実装で詰まったら、また新しいセッションでこの設計書を片手に相談に来て。
