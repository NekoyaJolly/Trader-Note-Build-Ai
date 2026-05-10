#!/usr/bin/env bash
# Copilot レビュー検知フック (Stop hook 用)
#
# 役割: 現在ブランチに紐づく Open PR に未対応の Copilot レビューコメントがあるかを判定し、
#       あれば「copilot-review-responder スキル起動を推奨」する system-reminder 風メッセージを
#       stdout に出力する。Claude Code の Stop hook 経由で次ターンの context に注入される。
#
# 判定ロジック:
#   1. 現在ブランチ (= main 以外) に Open PR があるか
#   2. Copilot (copilot-pull-request-reviewer) の line コメント or レビュー本体があるか
#   3. PR 上の最新「## Copilot レビュー N 件 → 対応完了」サマリコメントより新しい Copilot 投稿があるか
#
# どれか false なら何も出力せず exit 0 (= context 汚染しない)。
#
# 失敗時 (gh 不在 / 認証切れ / network 障害等) も exit 0 で抜ける。
# Stop hook を壊すと Claude Code 全体の応答終了が遅れるため、サイレントに諦める方針。

set +e  # エラーでも抜けず進む

# gh CLI が無ければ何もしない
command -v gh >/dev/null 2>&1 || exit 0
# git ディレクトリ外なら何もしない
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -z "$BRANCH" ] && exit 0
[ "$BRANCH" = "main" ] && exit 0
[ "$BRANCH" = "HEAD" ] && exit 0  # detached

# Open PR を 1 件取る (head=current branch)
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null)
[ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ] && exit 0

# owner/repo を取得
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null)
[ -z "$REPO" ] && exit 0

# Copilot の最新投稿時刻 (line コメント + レビュー本体の中で最大)。
# --paginate で全ページ取得し、各エントリの時刻を行ごとに出力 → sort -r | head -1 で最大値。
# (--paginate を付けないと 30 件超の PR で取りこぼし、誤判定の原因になる。PR #150 review (1) 対応)
COPILOT_LATEST_LINE=$(gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/comments" \
    --jq '.[] | select(.user.login == "Copilot" or .user.login == "copilot-pull-request-reviewer") | .created_at' \
    2>/dev/null | sort -r | head -1)
COPILOT_LATEST_REVIEW=$(gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/reviews" \
    --jq '.[] | select(.user.login == "Copilot" or .user.login == "copilot-pull-request-reviewer") | .submitted_at' \
    2>/dev/null | sort -r | head -1)

# どちらも null/空なら Copilot 未介入 → 終了
COPILOT_LATEST=""
if [ -n "$COPILOT_LATEST_LINE" ] && [ "$COPILOT_LATEST_LINE" != "null" ]; then
    COPILOT_LATEST="$COPILOT_LATEST_LINE"
fi
if [ -n "$COPILOT_LATEST_REVIEW" ] && [ "$COPILOT_LATEST_REVIEW" != "null" ]; then
    if [ -z "$COPILOT_LATEST" ] || [ "$COPILOT_LATEST_REVIEW" \> "$COPILOT_LATEST" ]; then
        COPILOT_LATEST="$COPILOT_LATEST_REVIEW"
    fi
fi
[ -z "$COPILOT_LATEST" ] && exit 0

# 最新の対応完了サマリコメント時刻 (--paginate で 30 件超対応)
SUMMARY_LATEST=$(gh api --paginate "repos/$REPO/issues/$PR_NUMBER/comments" \
    --jq '.[] | select(.body | startswith("## Copilot レビュー")) | .created_at' \
    2>/dev/null | sort -r | head -1)

# サマリ無し or Copilot 投稿の方が新しい → 未対応扱い
NEEDS_RESPONSE=0
if [ -z "$SUMMARY_LATEST" ] || [ "$SUMMARY_LATEST" = "null" ]; then
    NEEDS_RESPONSE=1
elif [ "$COPILOT_LATEST" \> "$SUMMARY_LATEST" ]; then
    NEEDS_RESPONSE=1
fi

if [ "$NEEDS_RESPONSE" = "1" ]; then
    # Stop hook で次ターンに context を注入するには、plain stdout ではなく JSON で
    # hookSpecificOutput.additionalContext を返す必要がある (= UI 表示用 systemMessage と区別)。
    # decision: "block" を併用することで、Stop を取り消して Claude を続行させる
    # (= 即座に skill 起動の判断をさせる)。
    SUMMARY_DISPLAY="${SUMMARY_LATEST:-なし}"
    cat <<JSON
{
  "decision": "block",
  "reason": "未対応 Copilot レビュー検出 (PR #${PR_NUMBER})",
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "🤖 Copilot レビュー検知 (PR #${PR_NUMBER}, branch: ${BRANCH})。未対応の Copilot レビューコメントが検出されました (最新: ${COPILOT_LATEST}, 過去対応サマリ: ${SUMMARY_DISPLAY})。copilot-review-responder スキルを起動して対応してください (Skill tool で skill=\"copilot-review-responder\", args=\"PR #${PR_NUMBER}\")。"
  }
}
JSON
fi

exit 0
