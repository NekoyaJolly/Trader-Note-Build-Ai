# Phase 6.5: OpenRouter 切替手順書

> **対象**: 本番(Cloud Run)の LLM プロバイダーを Gemini 直接接続から OpenRouter プロキシ経由に切り替える
> **作成日**: 2026-04-22
> **前提**: Phase 6.5 コミット(`src/config/index.ts` 変更)が本番デプロイ対象ブランチにマージ済み

---

## 0. 何が変わるか(要約)

| 項目 | 旧 (〜Phase 6) | 新 (Phase 6.5〜) |
|---|---|---|
| LLM プロキシ | Gemini OpenAI 互換エンドポイント直接 | OpenRouter |
| `AI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | `https://openrouter.ai/api/v1` |
| `AI_API_KEY` | Google AI Studio / Gemini のキー (`AIza...`) | OpenRouter のキー (`sk-or-v1-...`) |
| `AI_MODEL` (グローバル) | `gemini-3-flash-preview` 等 | 不要(コード側で `anthropic/claude-sonnet-4.6` フォールバック、設定しなくても動く) |
| エージェント別モデル | ほぼ空文字列 → グローバル既定 | `src/config/index.ts` で全エージェントにハードコード既定値 |

Phase 6.5 以降は **単一 baseURL (OpenRouter) 経由で Claude / Gemini / Qwen を呼び分ける** 設計。

---

## 1. 本番切替手順 (GCP Secret Manager)

### 1.1 前提チェック

- [ ] 対象 GCP プロジェクト名と Cloud Run サービス名を確認 (例: `tradeassist-backend`)
- [ ] Secret Manager への書込権限を持つ GCP アカウントでログイン済み (`gcloud auth login`)
- [ ] ブランチに Phase 6.5 のコミットがマージ済み
- [ ] 必要なら本番に影響の少ない時間帯を選ぶ(LLM 呼び出しタスクが走らない時間)

### 1.2 シークレット更新(新バージョン追加)

Secret Manager は **旧バージョンを残したまま新バージョンを追加** できるため、ロールバックが容易。以下の順で新バージョンを追加する:

```bash
# 変数: 実際のプロジェクト / シークレット名に合わせる
PROJECT=tradeassist-prod
OPENROUTER_KEY="sk-or-v1-XXXX..."  # OpenRouter ダッシュボードで発行したキー

# 1. AI_BASE_URL を OpenRouter に切替
echo -n "https://openrouter.ai/api/v1" | \
  gcloud secrets versions add AI_BASE_URL --data-file=- --project="$PROJECT"

# 2. AI_API_KEY を OpenRouter キーに切替
echo -n "$OPENROUTER_KEY" | \
  gcloud secrets versions add AI_API_KEY --data-file=- --project="$PROJECT"

# 3. AI_MODEL は不要だが、.env 互換性維持のため空文字列版を追加しても良い
#    (Secret Manager はシークレットを丸ごと消す運用は非推奨、
#     空文字版を入れておけば Cloud Run で参照しても害なし)
echo -n "" | \
  gcloud secrets versions add AI_MODEL --data-file=- --project="$PROJECT"
```

### 1.3 Cloud Run への反映

Cloud Run のリビジョンは **起動時にシークレットを読み込む** ため、最新バージョンに更新後は新しいリビジョンをデプロイする必要がある。

```bash
SERVICE=tradeassist-backend
REGION=asia-northeast1

# 既存サービスを新リビジョンで再デプロイ(コード変更なし、シークレット再読み込みのみ)
gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --update-secrets=AI_BASE_URL=AI_BASE_URL:latest,AI_API_KEY=AI_API_KEY:latest,AI_MODEL=AI_MODEL:latest
```

`:latest` を指定すると最新バージョンが自動で反映される。既に `:latest` 参照なら `--update-secrets` 指定は不要で、新リビジョンをデプロイするだけで反映される。

### 1.4 疎通確認

反映後、以下を確認する:

1. **ログ確認**: `gcloud run services logs read "$SERVICE" --project="$PROJECT" --limit=50` で `[Config] ✅ 設定ロード成功` と `DATABASE_URL（ホスト）` のログを確認
2. **ヘルスチェック**: `/health` or 既存のヘルスチェックエンドポイントが 200 を返す
3. **LLM 実呼出確認**: 運用側で手動トリガー可能な軽量なエージェント(例: `PromptMutationAgent` の手動実行、もしくは小さな `HypothesisGenerator` 走行)で OpenRouter 経由のレスポンスを確認
4. **OpenRouter ダッシュボード**: `https://openrouter.ai/activity` で呼出が計上されているか、モデル名が想定通りかを確認

---

## 2. ロールバック手順

旧 Gemini 構成に即時戻す場合の手順。Secret Manager の **バージョン番号を明示的に戻す** ことで、前バージョンの値を読ませる。

### 2.1 戻すべきバージョンの確認

```bash
gcloud secrets versions list AI_BASE_URL --project="$PROJECT" --limit=5
gcloud secrets versions list AI_API_KEY --project="$PROJECT" --limit=5
gcloud secrets versions list AI_MODEL   --project="$PROJECT" --limit=5
```

出力例:
```
NAME  STATE      CREATED_AT
3     enabled    2026-04-22T12:00:00  (Phase 6.5 切替で追加した OpenRouter 設定)
2     enabled    2026-03-01T09:00:00  (旧 Gemini 設定)
1     enabled    2025-12-15T08:00:00
```

### 2.2 バージョン 2 (旧 Gemini 設定) を再度 latest にする

Secret Manager はバージョンの `latest` を手動で前に戻せないため、**旧バージョンの値を再度新バージョンとして追加する** のが推奨手順:

```bash
# 2.1 で確認した旧 Gemini バージョン(例: バージョン 2)の値を取り出し
OLD_BASE_URL=$(gcloud secrets versions access 2 --secret=AI_BASE_URL --project="$PROJECT")
OLD_API_KEY=$(gcloud secrets versions access 2 --secret=AI_API_KEY --project="$PROJECT")
OLD_MODEL=$(gcloud secrets versions access 2 --secret=AI_MODEL --project="$PROJECT")

# 新しい latest として書き戻す
echo -n "$OLD_BASE_URL" | gcloud secrets versions add AI_BASE_URL --data-file=- --project="$PROJECT"
echo -n "$OLD_API_KEY" | gcloud secrets versions add AI_API_KEY --data-file=- --project="$PROJECT"
echo -n "$OLD_MODEL"   | gcloud secrets versions add AI_MODEL   --data-file=- --project="$PROJECT"
```

### 2.3 Cloud Run で再読み込み

```bash
gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --update-secrets=AI_BASE_URL=AI_BASE_URL:latest,AI_API_KEY=AI_API_KEY:latest,AI_MODEL=AI_MODEL:latest
```

### 2.4 コード側のロールバック (必要な場合)

Phase 6.5 のコードは `config.ai.baseURL` の既定値を OpenRouter に、`config.ai.models.*` を OpenRouter 形式のモデル ID に変更している。

**Secret Manager の `AI_BASE_URL` / `AI_MODEL_*` を Gemini 向けに戻せば、コード変更なしで Gemini に戻せる** (全エージェント別モデル環境変数が設定されていれば、それらが `config.ai.models` のハードコード既定を上書きする)。

コード自体を revert する必要がある極端な場合:

```bash
# Phase 6.5 の 1 コミットだけを revert
git revert <phase-6-5-commit-sha>
git push origin main
# → Cloud Run 自動デプロイ(CI 経由) or 手動再デプロイ
```

---

## 3. ロールバック判断フローチャート

```
LLM 呼出エラー or OpenRouter 課金予想外?
├── Yes → 本番への影響は重大?
│   ├── Yes (即時戻す必要あり) → §2 ロールバック手順を実行
│   └── No (調査の時間がある)  → OpenRouter Activity Dashboard でエラー内容確認
│                                → モデル別に切り戻し(環境変数 `AI_MODEL_<KEY>` を
│                                   Gemini 向けに変更して段階的に戻す)
└── No → そのまま運用継続
```

---

## 4. 事前準備チェックリスト (切替前)

- [ ] OpenRouter のアカウント作成済み
- [ ] OpenRouter キー発行済み (`sk-or-v1-...`)
- [ ] OpenRouter 側の支払い方法 / プリペイドクレジット設定済み
- [ ] Phase 6.5 検証で確認した 7 モデル (下記) が OpenRouter で全て有効であること再確認
  - `anthropic/claude-opus-4.7`
  - `anthropic/claude-opus-4.6`
  - `anthropic/claude-sonnet-4.6`
  - `anthropic/claude-haiku-4.5`
  - `google/gemini-2.5-flash`
  - `google/gemini-3.1-flash-lite-preview`
  - `qwen/qwen3.5-flash-02-23` (現時点では未使用、将来 mutation/crossover の降格候補)
- [ ] OpenRouter の月間予算上限(Spend Limit)を設定済み(意図しない暴走防止)
- [ ] Phase 6.5 コミットがステージング環境でテスト済み
- [ ] GCP Secret Manager の現行バージョン一覧をスクショ等で記録(ロールバック用)

---

## 5. コスト想定

Phase 6.5 段階のエージェント別コスト (1 呼出あたり、Phase 6.5 検証時の実測値から推定):

| エージェント | モデル | 1 呼出コスト (最小) |
|---|---|---|
| meta_evolution | opus-4.7 | $0.000305 |
| strategist | opus-4.7 | $0.000305 |
| hypothesis_generator | opus-4.7 | $0.000305 |
| discovery | opus-4.7 | $0.000305 |
| devils_advocate | opus-4.7 | $0.000305 |
| mutation | sonnet-4.6 | $0.000117 |
| crossover | sonnet-4.6 | $0.000117 |
| prompt_mutation | sonnet-4.6 | $0.000117 |
| plan (StrategyThinker) | sonnet-4.6 | $0.000117 |
| reflection | haiku-4.5 | $0.000038 |
| research | gemini-3.1-flash-lite | $0.000005 |
| trend_specialist | gemini-3.1-flash-lite | $0.000005 |
| oscillator_specialist | gemini-3.1-flash-lite | $0.000005 |
| volatility_volume_specialist | gemini-3.1-flash-lite | $0.000005 |
| lesson_similarity | gemini-3.1-flash-lite | $0.000005 |

※ 実運用時は入力プロンプトが長くなるため **1 呼出あたり数倍〜数十倍** になる想定(例: HypothesisGenerator のレンズダンプ込み呼出は $0.001-0.01 オーダー)

**月間コスト目安 (概算)**:
- 自動実行系がデフォルト無効 (`autoEvolution=false`, `autoTriggerPromptEvolution=false`) の状態では、ユーザー発火ベース + 日次 Discovery + トレード決済ごとの Reflection が主
- 1 日あたり数十 $0.001-0.01 呼出 → 月 $10-50 程度
- `autoEvolution` / `autoTriggerPromptEvolution` を有効化すると月 $100+ に増える可能性、OpenRouter 側の Spend Limit で制御

---

## 6. 既知の留意点

### 6.1 パース層の既知脆弱性 (Phase 6 hotfix 予定)

Phase 6.5 検証で判明:
- PromptMutationAgent / MetaEvolutionAgent のパース層が以下のケースで失敗する
  - Markdown コードフェンスが応答本文に含まれているが、本文そのものはプレーン JSON の場合(フェンス正規表現が誤マッチ)
  - LLM 応答が max_tokens 上限で途中で切れた場合
- **Phase 6.5 の接続層切替そのものには影響しない** (OpenRouter への接続・モデル指定は正常)
- Phase 6 hotfix で `parseProposalArray` / `parseProposalJson` の順序逆転 + `AIProvider.chat()` の `max_tokens` 引数追加で対応予定

### 6.2 `AI_MODEL` 環境変数の扱い

Phase 6.5 以降、**`AI_MODEL` は設定不要** (`config.ai.model` にハードコード既定 `anthropic/claude-sonnet-4.6` が入っている)。

ただし:
- `.env` / Secret Manager に残しておいても害はない(空文字列ならグローバル既定にフォールバック、値があればグローバル既定を上書き)
- 完全に削除するのは Phase 6.5 が安定運用されてから(Phase 7 以降の扱いで別途決める)

### 6.3 OpenRouter 経由の追加レイテンシ

Phase 6.5 検証時の平均レイテンシ:
- Anthropic 直接接続: 未測定 (比較用データなし)
- OpenRouter 経由: 400ms (Qwen 最速) - 2070ms (Opus 4.7 最遅)

プロキシ層があるため直接接続よりわずかに遅い可能性があるが、**用途上問題となるレベルではない** (エージェントは非同期に走る設計)。

---

## 7. 関連コミット

- `feat(side-b): Phase 6 Step 1 - プロンプト進化基盤を導入` (Phase 6 の下地)
- `feat(side-b): Phase 6.5 - OpenRouter 切替 + エージェント別モデル設定` (このドキュメントの対象)

---

## 8. 今後のメモ

### 8.1 段階的最適化候補 (運用観察後)

- `mutation` / `crossover` を Qwen 系に降格検討 (呼出頻度が極めて高いためコスト効果大)
- 専門家 3 体 (trend/oscillator/volatility_volume) は Gemini 3.1 Flash Lite で十分な精度が出ているかを確認し、不足なら Haiku 4.5 に昇格
- `strategist` / `hypothesis_generator` は運用精度を見て Opus 4.7 → Sonnet 4.6 に降格も選択肢

### 8.2 Phase 6 hotfix 後に対応予定

- パース層の堅牢化
- `max_tokens` のエージェント別既定値の整理 (MetaEvolution は 4096 以上、他は 2048-2500 等)
