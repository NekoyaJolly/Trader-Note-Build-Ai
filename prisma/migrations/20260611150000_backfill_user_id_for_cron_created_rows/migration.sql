-- ============================================================
-- Phase α-4: cron 生成行の userId 再バックフィル（データのみ・非破壊・冪等）
--
-- 背景: α-2 (20260610130000) の初回バックフィル以降、create 経路の userId 配線が
-- 未実装だったため、matching pipeline / strategy-alerts cron が生成した
-- MatchResult / Notification は userId=NULL のまま蓄積されていた。
-- α-4 で全 query がユーザー分離されると NULL 行はユーザーから不可視になるため、
-- 配線完了と同時に既存 NULL 行を最古ユーザーへ帰属させる。
--
-- 本番はこれまで単一ユーザー運用のため、α-2 と同じ「最古ユーザー」規則で安全。
-- User が 0 件の環境（新規環境）ではサブクエリが NULL を返し、何も変更されない。
-- スキーマ変更は無し。
-- ============================================================

UPDATE "Trade" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "TradeNote" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
-- MatchResult.noteId は TradeNote への FK (UUID) のため、永続化済みの行は全て
-- Side-A ノート由来 (Side-B 仮想ノートのマッチは FK 違反で元々永続化されない)
UPDATE "MatchResult" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "Notification" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "Strategy" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
