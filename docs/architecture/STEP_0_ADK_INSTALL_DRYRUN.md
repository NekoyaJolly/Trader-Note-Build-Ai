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

### 2.3 dry-run で error にならなかった理由

npm の挙動として、peer dependency の不足は以下のように扱われる:

- **v7 以降**: peer dependency が見つからない場合は **warning** (error にはならない)
- **v7 未満**: peer dependency 不足を完全に無視
- `--dry-run` フラグは衝突レポートを表示するが、peer dependency 不足の warning は本 dry-run の最後尾の `added 402 packages, and changed 1 package` メッセージに集約されてしまい、目立たない

→ **「dry-run が exit 0 を返した = 安全」とは限らない**。peer dependency 要件は別途レビューが必要。

---

## 3. Step 1 着手時の対応方針 (推奨)

### 3.1 オプション A: peer dependency を無視してインストール

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
