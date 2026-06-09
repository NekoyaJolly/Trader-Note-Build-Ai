# Side-A バックテスト導線（役割の整理）

> **責務**: ユーザーと開発者が「どの API が実バックテスト本体で、coverage check は何のためか」を迷わないようにする恒久ドキュメント。
> **背景**: 旧 `POST /api/backtest`（execute / getResult / getHistory）は撤去済み。ノート単位の手動バックテストは廃止され、バックテストはストラテジー側 + analysis-engine に寄せた。`/api/backtest` は **coverage check 専用の縮小版**として残っている。
> **作成**: 2026-06-09（P2）

---

## 3 つの登場人物

| 役割 | 何をするか | 入口 |
|---|---|---|
| **データカバレッジ確認** (`POST /api/backtest/check-coverage`) | 指定期間の OHLCV が足りているか（カバレッジ率）を確認するだけ。**実バックテストはしない**。 | ストラテジー BT 画面の事前チェック |
| **ストラテジーバックテスト**（strategy route 系） | ルール（ストラテジー）を過去データで実行し、トレード一覧・サマリー・ウォークフォワード等を出す **実行本体**。 | `/strategies/[id]/backtest` 画面 |
| **analysis-engine**（Python FastAPI / Cloud Run） | 重い計算（バックテスト実行・指標計算）を担うバックエンド。strategy route から呼ばれる。 | バックエンド内部 |

## ユーザーから見た流れ

1. `/strategies/[id]/backtest` でパラメータ（シンボル・期間・時間足など）を設定する。
2. 実行前に **データカバレッジ確認**（`check-coverage`）が走り、データ不足（カバレッジ率 95% 未満）ならダイアログで警告し、必要なら「API からデータ取得」を促す。
3. データが揃ったら **ストラテジーバックテスト**（実行本体）が走り、結果（サマリー / トレード / チャート / ウォークフォワード / モンテカルロ等）を表示する。

つまり **`/api/backtest`（check-coverage）は「実行前のデータ点検」専用**で、バックテストの実体ではない。

## 旧 API（撤去済み・使わない）

- `POST /api/backtest`（execute）
- `GET /api/backtest/result` / `GET /api/backtest/results`
- `GET /api/backtest/history`

これらは段階的撤去済み。UI / client から呼んでいる箇所は無い（残っていたら dead link なので削除すること）。実バックテストはストラテジー側を使う。

## 関連

- ノート（Side-A）と現在市場の **一致判定 → 通知** は別系統（[golden-path.md](./golden-path.md) 参照）。バックテストとは目的が異なる。
- バックテストコントローラの現状コメントは `src/backend/controllers/backtestController.ts` 冒頭を参照（coverage check 専用 / 旧責務撤去済み / analysis-engine 寄せ込み完了時に全体削除予定）。
