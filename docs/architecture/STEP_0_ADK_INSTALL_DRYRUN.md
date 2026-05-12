# STEP_0_ADK_INSTALL_DRYRUN.md - @google/adk dry install レポート

> **チケット**: Ticket C2
> **作成日**: 2026-05-12
> **方針**: 実インストールは Step 1 で行う。本チケットでは衝突チェックのみ (KICKOFF.md §C2)

---

## 1. 実行コマンドと結果

```bash
npm install --dry-run @google/adk
# exit code: 0
# added 402 packages, and changed 1 package in 18s
```

dry-run は成功し、衝突による error は発生しなかった。

### 1.1 確認した @google/adk バージョン情報

```bash
npm view @google/adk version description peerDependencies
```

| 項目 | 値 |
|------|----|
| version | `1.1.0` |
| description | Google ADK JS |
| peerDependencies | `@mikro-orm/{mariadb,mssql,mysql,postgresql,sqlite}: ^6.6.6` のいずれか |

---

## 2. ⚠️ 重要発見: peer dependency と本プロジェクト ORM の不一致

### 2.1 @google/adk の要件

`@google/adk` v1.1.0 の `peerDependencies` は **MikroORM** ファミリーを要求している:

```json
{
  "@mikro-orm/mariadb": "^6.6.6",
  "@mikro-orm/mssql": "^6.6.6",
  "@mikro-orm/mysql": "^6.6.6",
  "@mikro-orm/postgresql": "^6.6.6",
  "@mikro-orm/sqlite": "^6.6.6"
}
```

### 2.2 本プロジェクトの ORM

本プロジェクトは **Prisma ORM** を採用 (`AGENTS.md` 技術スタックに記載):

- `prisma`: `^6.19.2`
- `@prisma/client`: (`prisma generate` で生成)

MikroORM は導入されていない。

### 2.3 dry-run で error にならなかった理由 (npm の peer deps 挙動)

npm v7+ における peer dependencies の扱いは以下:

- **自動解決を試みる**: npm v7+ は peer dependency を install ツリーに自動で含めようとする (v6 までは無視)
- **競合時は `ERESOLVE` で失敗**: 既存依存と peer dep が両立しない場合 (例: バージョン範囲の交差なし)、実 install 時に `ERESOLVE` エラーで停止
- **挙動はフラグで変わる**:
  - `--legacy-peer-deps`: v6 以前の挙動 (peer dep 不整合を無視して install)
  - `--strict-peer-deps`: warning も error として扱う
  - `--force`: 衝突を強引にスキップして install
- **dry-run の限界**: `npm install --dry-run` は依存解決ツリーをシミュレートするが、本リポジトリ実行時の `added 402 packages` メッセージで peer dep に関する warning が混在しても明示されない場合がある

本 dry-run では:
- `@google/adk` の peer dep `@mikro-orm/*` は**現在の本リポジトリに存在しない**
- npm はこれを「peer dep 不在」として処理した可能性が高い (実 install では warning レベル、`--strict-peer-deps` を付ければ error)
- `ERESOLVE` までは至らなかったため exit 0

→ **「dry-run exit 0 = 安全」とは限らない**。実 install 時の挙動は npm 設定 (`.npmrc` の `legacy-peer-deps` 等) とフラグ次第で変わる。peer dependency 要件は別途レビューが必要。

---

## 3. Step 1 着手時の対応方針

> **2026-05-12 確定**: 以下 3 オプションのうち **オプション A (`--legacy-peer-deps`)** を採用し、加えて **ADK の `DatabaseSessionService` 系 (MikroORM 依存の永続化レイヤー) は不採用** とすることが Nekoさん判断で決定した。
>
> 確定理由:
> - 本プロジェクトは既に Prisma で広範に実装しており、MikroORM を入れると **ORM 二重管理**になる
> - 今後の実装でエージェント (Claude Code) が「どっちの ORM を使うべきか」迷う原因になる
> - Prisma を **ORM の唯一の責務** とする (1 ORM ポリシー)
> - ADK の他機能 (Runner / Sequential / Parallel / Loop / FunctionTool / Tracing) は採用価値が十分残っている
>
> セッション / 状態永続化が必要になった場合は **Prisma ベースで自作する** (急がない、Step 後半で対応)。
>
> 詳細は `docs/architecture/ADK_ADOPTION.md` §2.2 / §2.3 を参照。

### 3.1 オプション A: peer dependency を無視してインストール (✅ **採用**)

```bash
npm install @google/adk --legacy-peer-deps
# または .npmrc に legacy-peer-deps=true を追記
```

メリット:
- 既存の Prisma 構成を維持できる
- @google/adk が **MikroORM を実行時に利用しない**機能 (Runner / Sequential / FunctionTool / Tracing 等) であれば動作する

デメリット:
- @google/adk が内部で **MikroORM の API を呼び出す**場面 (例: 永続化、状態管理) があると runtime error
- 将来の @google/adk 更新で MikroORM 依存が深まる可能性

### 3.2 オプション B: @google/adk のドキュメントを精読し、MikroORM 利用範囲を特定

公式ドキュメントで以下を確認:
- @google/adk の Runner / Agent クラスが MikroORM に直接依存するか
- MikroORM はオプショナル機能 (Session / State persistence など) のみで使われるか
- ADK が `tools/` や `tracing/` 部分で MikroORM を利用しないことを確認

確認結果次第で:
- **MikroORM が必須機能 (例: Agent 実行コア) で使われる場合**: @google/adk 採用の見直し or MikroORM 並存の検討
- **MikroORM がオプショナル機能のみで使われる場合**: オプション A (`--legacy-peer-deps`) で進める

### 3.3 オプション C: ADK_ADOPTION.md §5 撤退基準の再確認

撤退基準 #4「Google が ADK を deprecated 宣言」は満たしていないが、**peerDeps の不整合**は本プロジェクトでの ADK 採用に追加リスクをもたらす。Step 1 着手前にユーザー判断を仰ぐべき事項として ADK_ADOPTION.md に追記候補。

---

## 4. dry-run で確認された追加パッケージ概要

合計 **402 packages** が新規追加される。主な内訳:

### 4.1 ADK 関連
- `@google/adk` 本体 (バージョン 1.1.0)
- `@protobufjs/*` (gRPC / protobuf 経由の通信)
- `gtoken` (Google OAuth token 取得)
- `fetch-blob`, `formdata-polyfill`, `data-uri-to-buffer` (fetch ポリフィル)

### 4.2 esbuild 全プラットフォーム
- `@esbuild/*` 全 OS/CPU 組み合わせ (23 個): linux-x64, darwin-arm64, win32-x64, freebsd-*, openbsd-*, sunos-x64, android-*, etc.
- これは esbuild の標準的なインストール挙動 (optionalDependencies)

### 4.3 ロギング・カラーリング
- `winston` 関連 (`color`, `color-string`, `color-name`, `kuler`, `enabled`, `@so-ric/colorspace`)
- 既存ロガーとの統合方針は Step 2 (Tracing) で検討

### 4.4 既存パッケージのバージョン変更
- `dotenv: 17.2.3 → 17.3.1` (minor bump、breaking change なし想定)

---

## 5. 実インストールは Step 1 で実施

KICKOFF.md §C2 の禁止事項に従い、本チケットでは `npm install @google/adk` を実行しない。`package.json` への追加もしない。Step 1 (Skill → ADK FunctionTool アダプター) のキックオフ時に:

1. オプション A/B/C の判断 (peer deps 対応方針)
2. 実インストール (`--legacy-peer-deps` 等)
3. `package.json` への記載
4. `package-lock.json` の commit

を行う。

---

## 6. 監査スナップショット

- 計測日: 2026-05-12
- 計測コマンド: `npm install --dry-run @google/adk`
- npm バージョン: ローカルの `npm --version` 出力 (本書記録時点では未取得、必要なら別途確認)
- node バージョン: `package.json` `engines` または `.nvmrc` 参照 (CI 側は v22 を使用、`ci.yml` 参照)
- 生ログ: `tmp` 領域に保存 (PR には含めない、本書の数値が正)
