# LAST_MILE_INTEGRATION.md — Last-Mile Shared Context 導入手順 (Phase 11)

> **位置づけ**: TradeAssist (Trader-Note-Build-Ai) における `last-mile-shared-context` 導入の作業手順 / MCP 設定 / 実地検査の証跡。
> **規約の正本**: `/AGENTS.md` の「Last-Mile Shared Context Rule」セクション (規約はそちら、本ファイルは手順)。
> **上流**: https://github.com/NekoyaJolly/last-mile-shared-context

---

## 1. 構成サマリ

| レイヤー | 何が入ったか | 配置場所 |
|---|---|---|
| 配布物 | `last-mile-context-*-0.1.0.tgz` 8 本 (schema / core / cdp-collector / cli / mcp-server / playwright-adapter / app-bridge / react-bridge) | `vendor/last-mile-context/` |
| Backend 依存 | schema / core / cdp-collector / cli / mcp-server / playwright-adapter (tarball 直接参照) | `package.json` devDependencies + `overrides` |
| Frontend 依存 | schema / app-bridge / react-bridge | `src/frontend/package.json` dependencies + `overrides` |
| 設定 | プロジェクト固有の `appName` / `environment` / `redaction` ホワイトリスト | `lastmile.config.json` |
| UI 連携 | Dashboard 1 画面で `setAiDebugContext` + `mergeAiDebugContext` + `CopyAiDebugContextButton` | `src/frontend/app/side-b/dashboard/page.tsx` |
| 規約 | 9 項目 / Domain ID マッピング / cTrader OAuth 取得手順 | `/AGENTS.md` §「Last-Mile Shared Context Rule」 |
| MCP | `lastmile-mcp` を VSCode/Claude Code MCP に登録 | `.vscode/mcp.json` |
| 取得物 | Bundle JSON / screenshot / console / network 派生 | `.last-mile/latest/` (`.gitignore` 済) |

依存方向: `last-mile-context` (vendor) → アプリ (frontend / backend) の単方向。アプリ側から `last-mile-context` を改変することはしない (改変が必要なら上流リポジトリ側で対応)。

---

## 2. インストール / セットアップ

```powershell
# 1. backend 依存
npm install

# 2. frontend 依存
cd src/frontend; npm install; cd ../..

# 3. (任意) doctor で CDP 接続を確認 — Chrome 起動前は失敗しても OK
npx lastmile doctor
```

`vendor/last-mile-context/*.tgz` は `file:./vendor/last-mile-context/...` 指定でロックファイルに固定済。CI / 他マシンで再現可能。

---

## 3. UI で AI Debug Context を有効化する (Dashboard 例)

`src/frontend/app/side-b/dashboard/page.tsx` を参照。要点は 3 つ:

1. `enableAiDebugContextWindowPublish({ allowProduction: false })` を mount 時 1 回呼ぶ (production では NO-OP)。
2. 画面の初期状態を `setAiDebugContext(initialContext)` で公開。
3. state が変わるたびに `mergeAiDebugContext({...})` で差分更新。

公開された context は `window.__AI_DEBUG_CONTEXT__` に置かれ、

- **CDP collector (CLI / MCP)** が `Runtime.evaluate` で読み取り Bundle に含める
- **`CopyAiDebugContextButton`** (dev のみ表示) でクリップボード経由で AI に貼れる

の 2 経路で AI に渡る。

**Domain ID マッピング (TradeAssist 固有)** は `/AGENTS.md` §5 を参照。Dashboard では `target.type='dashboard'` / `target.id='overview'` 固定で、`relatedIds.latestDiscoveryHypothesisId` のみ流す。**token / 取引額 / cTrader accountId は流さない** 原則。

---

## 4. Bundle 取得手段

### 4.1 CLI 経路

```powershell
# 1. Chrome を debugging port 付きで起動 (1 回のみ)
$chromeProfile = "$PWD\.chrome-lastmile-trader-note"
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=$chromeProfile

# 2. その Chrome で TradeAssist にログイン (cTrader OAuth 1 回完了させる)

# 3. 観測したい画面を表示した状態で collect
npx lastmile collect `
  --last-action "..." `
  --expected "..." `
  --actual "..." `
  --out .last-mile/latest
```

出力: `last-mile-bundle.json` / `screenshot.png` / `console.json` / `network.json`。

### 4.2 MCP 経路

`.vscode/mcp.json` の `lastmile-mcp` サーバーが Claude Code / VSCode から呼び出せる。
ツールは 8 種 (collect / page / screenshot / console / network / debug context / validate / mask)。
Claude Code でこのリポジトリを開けば自動で起動候補に出る。AI が `collect_last_mile_bundle` を呼べば CLI と同等の Bundle を取得できる。

### 4.3 手動経路 (Copy AI Context ボタン)

Dashboard 画面右上の **Copy AI Context** (dev のみ) → clipboard へ context JSON がコピー → AI チャットに貼り付け。CDP に attach しなくても `debugContext` だけは AI に渡せる。

---

## 5. 原因分類

`@last-mile-context/core` の `classifyIssue(bundle)` を使う。判定優先順は:

1. `server.errors[]` あり → `Server`
2. `network.failedRequests[]` に `status>=500` → `API` / それ以外 (4xx, abort) → `Network`
3. `console.errors[]` あり → `UI`
4. `userObservation.expected !== actual` で上記なし → `UX`
5. console warning のみ → `UX` 候補
6. 何もなし → `NoIssue` / `Unknown`

詳細な対応規約は `/AGENTS.md` §「Last-Mile Shared Context Rule」§3〜§4 を参照。

---

## 6. 実地検査の証跡 (本 PR で取得済)

### 6.1 実 issue: cTrader OAuth client_id 空送信

| 項目 | 値 |
|---|---|
| URL | `https://connect.spotware.com/apps/auth?client_id=&...&state=%2Fside-b%2Fdashboard` |
| `lastAction` | `/login で『cTrader でログイン』ボタンを押下 → cTrader OAuth へリダイレクト` |
| `expected` | cTrader ログインフォームが表示され、認証後 `/side-b/dashboard` へ戻る |
| `actual` | cTrader 側で `An Error Occurred: Bad Request` (HTTP 400) が表示される。`client_id=` が空のまま送信されている |

Bundle: `.last-mile/latest/last-mile-bundle.json` (commit 対象外、`.gitignore`)。

### 6.2 検証コマンドと結果

```powershell
# schema 再検証 → OK
npx lastmile validate .last-mile/latest/last-mile-bundle.json
# [lastmile validate] OK: ...\last-mile-bundle.json (protocolVersion=0.1.0, collector=cdp)

# 原因分類 → UX (cTrader 側へ redirect 済のため localhost の console/network は取れず、
# userObservation の expected/actual のみで判定。本来の原因は backend env なので
# 実修正は下記「ラストマイル仮説」を参照)
node --input-type=module -e "
import { classifyIssue } from '@last-mile-context/core';
import fs from 'node:fs';
const b = JSON.parse(fs.readFileSync('.last-mile/latest/last-mile-bundle.json','utf8'));
console.log(JSON.stringify(classifyIssue(b), null, 2));
"
# {
#   "primary": "UX",
#   "candidates": ["UX"],
#   "reasons": ["userObservation.expected differs from actual (no console/network/server signal)"]
# }
```

### 6.3 ラストマイル仮説 (Bundle 由来)

`client_id=` が空文字で送信されているため、`CTRADER_CLIENT_ID` env が backend に設定されていない、または OAuth redirect URL を組み立てる側で空チェックなしに展開している可能性が高い。具体修正は本 PR スコープ外 (別 issue / 別 PR で対応)。本 PR の役目は「**観測導線が通っていること**」を証明することのみ。

### 6.4 Bundle 分類が UX になった理由 (本 PR で学んだこと)

CDP collector は **attach した時点の Chrome タブ** を観測するため、`/login` から cTrader へ redirect された後に collect すると、観測対象は cTrader のページになる。localhost の console / network は別タブの履歴扱いで Bundle には乗らない。redirect を伴う issue では、

- `/login` 画面で `lastmile collect` してから OAuth ボタンを押す (失敗側で再 collect)
- もしくは backend ログを別途 `server.errors[]` / `server.hints[]` に手動で混ぜる

のどちらかが必要。これは Phase 12+ で改善する余地あり (今回は規約に追記しない、運用 tip 留め)。

---

## 7. 完了確認 (本 PR の DoD)

| 項目 | 結果 |
|---|---|
| UI で `DebugContextProvider` が有効 | ✅ `src/frontend/app/side-b/dashboard/page.tsx` で `enableAiDebugContextWindowPublish` + `setAiDebugContext` 実装 |
| 画面状態の context snapshot が取得できる | ✅ Dashboard で `window.__AI_DEBUG_CONTEXT__` に load 状態が反映される |
| CLI collect が JSON を出力できる | ✅ `.last-mile/latest/last-mile-bundle.json` が schema OK |
| MCP 経由で同等構造の context を取得できる | ✅ `.vscode/mcp.json` に `lastmile-mcp` 登録 |
| 実 issue 1 件を Bundle 分類できる | ✅ §6.2 で `classifyIssue` → `UX` |
| 回帰テストが通る | ✅ `npm test` / `cd src/frontend && npm test` (本 PR 説明欄に結果) |
| AGENTS.md に今後の導入ルールが反映 | ✅ `/AGENTS.md` §「Last-Mile Shared Context Rule」追加済み |

---

## 8. 次にやること (本 PR ではやらない)

- 他画面 (`/side-b/hypotheses` / `/side-b/agent` / `/side-b/validation` / `/side-b/evolution`) への DebugContextProvider 展開
- `classifyIssue` の Trader-Note-Build-Ai 固有兆候 (e.g. `databaseHealth='down'` を `Server` 寄せ) への拡張
- 解決済ラストマイル issue の `tests/e2e/` Playwright 再現 (`generatePlaywrightTestFromBundle` 雛形)
- MCP ツールの追加 (e.g. cTrader OAuth 認証セッション再利用)

これらは Phase 12 以降のスコープ。
