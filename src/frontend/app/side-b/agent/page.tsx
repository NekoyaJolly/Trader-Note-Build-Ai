import { redirect } from "next/navigation";

/**
 * /side-b/agent は運転席 (/side-b) に統合済み (2026-05-31)。
 *
 * 旧「AI Agent 詳細」ページのプラン根拠・緊急キルスイッチ・DB 容量警告・
 * Orchestrator 意思決定履歴・検証可視化はすべて運転席 (/side-b) へ移設した。
 * 本ルートはナビ未接続の孤立ページだったため、旧ブックマーク救済として運転席へ恒久リダイレクトする。
 */
export default function AgentDetailRedirect() {
  redirect("/side-b");
}
