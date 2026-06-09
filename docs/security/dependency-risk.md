# 依存関係リスク台帳

> **責務**: `npm audit` で検出された脆弱性のうち、即時解消できない（破壊的アップグレードを伴う / upstream 都合）ものについて、影響範囲・暫定緩和・次アクションを記録する恒久ドキュメント。
> **方針**: `npm audit fix --force` を無条件に実行しない（破壊的変更を伴うため）。critical/high を中心に、互換性を確認しながら対応する。
> **最終更新**: 2026-06-09（P1: matching pipeline run observability PR で棚卸し）

---

## サマリー（2026-06-09 時点）

| スコープ | critical | high | moderate | 即時解消 |
|---|---|---|---|---|
| root | 1 | 1 | 9 | 不可（全て破壊的アップグレード or upstream 都合） |
| src/frontend | 0 | 0 | 2 | 不可（Next.js upstream 都合） |

このPR（observability）では **依存を変更していない**。理由: いずれの修正も破壊的変更を伴い、cTrader 接続 / Google Cloud / Next.js といった本番クリティカル経路の互換性検証が別途必要なため、「1 PR 1 目的」に従い観測性PRには含めず、本台帳に残存理由と次アクションを記録する。

---

## root: critical / high

### protobufjs `<=7.5.7`（CRITICAL）/ @reiryoku/ctrader-layer（HIGH, 同根）

- **検出経路**: `@reiryoku/ctrader-layer/node_modules/protobufjs`。`@reiryoku/ctrader-layer` 自体も「脆弱な protobufjs/uuid に依存」として HIGH 判定される（critical と同根）。
- **advisory**: 任意コード実行 / prototype pollution / 複数の DoS 等（GHSA-xq3m-2v4x-88gg ほか多数）。
- **現状の罠**: `package.json` の `overrides` が `@reiryoku/ctrader-layer` → `protobufjs: 5.0.1` を**強制ピン**している。5.0.1 は 7.5.7 より**さらに古く脆弱**で、パッチ版に上がっていない。
- **realistic exploitability（本デプロイにおける現実的リスク）**: protobufjs がデコードするのは **cTrader Open API サーバー（信頼された TLS エンドポイント）から受信する protobuf メッセージ**であり、攻撃者が任意入力を流し込める経路ではない。任意ユーザー入力を protobufjs に通す箇所は無い。したがって本番での悪用可能性は低いと評価する（ただし依存自体の脆弱性は残存）。
- **なぜ即時解消しないか**: override をパッチ版 protobufjs（7.x 系）に上げると、`@reiryoku/ctrader-layer` が期待する protobufjs API と非互換になり **cTrader 接続（本番 OAuth・WebSocket）を壊すリスク**がある。検証には cTrader 認証情報での実接続確認が必要で、本 PR の範囲（本番 secret 不使用）を超える。
- **次アクション（専用セキュリティ PR）**:
  1. `@reiryoku/ctrader-layer` の protobufjs 互換レンジを確認し、override を可能な最大のパッチ版へ更新できるか検証する。
  2. ローカルで cTrader 接続スモーク（認証 → WebSocket → メッセージデコード）を通してから上げる。
  3. ctrader-layer が新しい protobufjs に対応できない場合は、ライブラリ自体の更新 / 代替 / fork パッチを検討する。

---

## root: moderate

### uuid `<11.1.1`（moderate）

- **検出経路**: 直接依存 `uuid@^9.0.1` + Google Cloud 系の transitive（gaxios / googleapis-common / googleapis / teeny-request / retry-request / @google-cloud/storage / @google/adk 経由）。
- **advisory**: `v3/v5/v6` で `buf` 引数指定時に buffer 境界チェックが欠落（GHSA-w5hq-g745-h8pq）。
- **realistic exploitability**: 本コードベースの uuid 利用は **v4（`uuidv4()`）のみ**で、advisory が対象とする v3/v5/v6 + `buf` 引数の経路は使っていない。実利用上の影響は無いと評価する。
- **なぜ即時解消しないか**: `npm audit fix --force` は `@google/adk@0.1.3`（破壊的ダウングレード）をインストールするため不可。直接依存の `uuid` は `^11` へ上げられる見込みだが、Google Cloud 系 transitive の uuid は upstream 更新待ちで完全解消しない。
- **次アクション**: 直接依存 `uuid` の `^11` 化を別 PR で検証（`uuidv4` は v11 でも互換）。Google Cloud / ADK 系は upstream の更新に追従。

### Google Cloud / googleapis チェーン（moderate, 上記 uuid 同根）

- gaxios / googleapis-common / googleapis / teeny-request / retry-request / @google-cloud/storage / @google-cloud/opentelemetry-cloud-monitoring-exporter / @google/adk は、いずれも上記 uuid への依存が根。`@google/adk` を破壊的に下げない限り transitive で残存する。upstream 更新に追従する。

---

## src/frontend: moderate

### postcss `<8.5.10`（moderate）

- **検出経路**: `next/node_modules/postcss`（Next.js 16.2.7 がバンドルする postcss）。
- **advisory**: CSS Stringify 出力での `</style>` 未エスケープによる XSS（GHSA-qx2v-qp2m-jg93）。
- **realistic exploitability**: postcss はビルド時に**自分たちが管理する CSS / Tailwind 出力**を処理する用途で、信頼できない第三者 CSS を実行時に流す経路は無い。実利用上の影響は低い。
- **なぜ即時解消しないか**: `npm audit fix --force` は `next@9.3.3`（現行 16.x からの大幅な破壊的ダウングレード）をインストールするため不可。
- **次アクション**: Next.js の upstream リリースが patched postcss を取り込むのを待って Next を更新する（Next のバンドル依存のため個別 pin は避ける）。

---

## 運用メモ

- 監査の再実行: `npm audit --audit-level=moderate` / `cd src/frontend && npm audit --audit-level=moderate`
- 本台帳は脆弱性が解消/変化したら更新する。critical/high が増えた場合は専用セキュリティ PR を検討する。
