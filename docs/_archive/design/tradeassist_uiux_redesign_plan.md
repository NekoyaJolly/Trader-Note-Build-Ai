# Trader-Note-Build-Ai UI / UX 再設計案

対象: Side-A / Side-B の情報設計、導線、画面責務、優先実装項目

## 要旨
- 現状の問題は見た目ではなく、成果物・ツール・プロセスの3軸が同一階層で混在している点にある。
- 「Side切替」ではなく「ワークスペース切替」として再定義し、各Sideのホームを“機能一覧”から“作業開始点”へ置き換える。

## エグゼクティブサマリー
- トップページが機能カタログ化しており、初手で何をすべきか分からない。
- ヘッダー・サイドバー・ページ内ローカルナビが競合し、正規導線が不明瞭。
- Side-A / Side-B の区切りは有効だが、現在は切替体験が“モードジャンプ”になっている。
- 改善の中心は、タスクベースの情報設計、デスクトップでの常時ナビ表示、画面責務の明確化である。
- **モバイル**は MT4 / MT5 / cTrader 等と同様に「起動直後からチャートを見せる」体験を優先し、デスクトップのワークベンチ方針と併存させる（詳細は §3-4・§4-6）。

## 1. 現状診断

### 1-1. 問題の構造
| 問題領域 | 現状 | なぜ迷うか | 改善方針 |
|---|---|---|---|
| Home | 機能カード中心 | 作業開始点ではなく、一覧表示に見える | 「今日やること」と「前回の続き」を主軸にする |
| Side切替 | 小型トグルで前回ページに復帰 | ワークスペース切替なのか、単なるページ移動なのか分かりにくい | Side別ホームへ遷移し、前回ページ復帰は補助機能にする |
| サイドバー | カテゴリ・ツール・成果物が混在 | 分類軸が揃っておらず、学習コストが高い | 現在いるSideの地図だけを見せる |
| Side-B内導線 | ページ上部の独自ナビが存在 | ヘッダー／サイドバーとの競合で正規導線が曖昧 | Side-B共通タブへ統一、またはサイドバーへ一本化 |

### 1-2. 核となる論点
- 現在のメニューは「成果物」「ツール」「プロセス」という3つの異なる軸が同列に並ぶため、ユーザーが毎回頭の中で再分類する必要がある。
- Side-A / Side-B の思想は有効だが、現状の切替 UI は「どのワークスペースにいるか」よりも「前にいた画面へ飛ぶ」に寄っている。
- デスクトップで常時ナビが見えないため、情報量の多い業務アプリとしての利点を削いでいる。

## 2. 再設計の基本方針
1. ワークスペース基準: Side-A / Side-B は「モード」ではなく「役割の異なる作業空間」として扱う。  
2. タスク基準: 入口は機能一覧ではなく、実際の作業開始点から設計する。  
3. 責務分離: ダッシュボード、一覧、検証、運転席を明確に分け、1画面1責務を守る。  
4. 常時ナビゲーション: デスクトップでは現在地が常に視認できる構成にする。  

## 3. 情報設計（IA）再構成

### 3-1. グローバル構造
| 領域 | 役割 | 主な入口 |
|---|---|---|
| Header | ワークスペース切替と全体ユーティリティ | Side-A / Side-B / 通知 / 検索 |
| Sidebar | 現在いるワークスペースの地図 | 各Side専用ナビ |
| Page body | いま行う作業に集中する本体 | ホーム / 一覧 / 検証 / 運転席 |

### 3-2. Side-A / Side-B の役割分担
**Side-A**
- 人間の判断と記録のワークスペース
- 入口は「今日やること」「最近のノート」「市場確認」
- ノート・市場分析・戦略・バックテストへ進む

**Side-B**
- AI仮説と検証のワークスペース
- 入口は「全体状況」「要確認」「検証中」
- 仮説一覧・検証キュー・エージェント運用へ進む

### 3-3. 情報の流れ
ノート / 市場分析 → 仮説生成 → 検証 → confirmed / rejected → 比較・AIノート → 人間判断

### 3-4. モバイル（デスクトップとの差分方針）

デスクトップは §4-2 のとおり **常時ナビ + ワークスペース地図**を優先する。一方モバイルは画面が狭いため、次の **チャートファースト** を採用し、上記と矛盾させない。

| 項目 | 方針 | 補足 |
|---|---|---|
| 起動・ログイン直後 | 原則 **`/market-analysis`（市場分析＝チャート）** を表示 | トレーダーが期待する「開いたらチャート」に合わせる |
| デスクトップとの関係 | デスクトップは引き続き **Side-A ホームを作業起点**（§4-3）とできる | ブレークポイント（例: `md` 未満＝モバイル）で着地点を分岐する |
| ボトムナビ | **左端タブをチャート**（`/market-analysis`）に固定 | 残りスロットでノート・通知・設定等を配分。旧「ホーム」はチャートと役割が被るため省略または「メニュー」へ寄せる |
| ワークスペース切替 | ヘッダーまたはドロワーで Side-A / Side-B を維持 | P3 のタブ型ワークスペース表示と整合させる |
| トレードオフ | 初回ユーザーがアプリ全体の地図に触れる機会が減る | チャート画面上部の最小導線・オンボーディング1枚などで補う（P2 以降で検討可） |

### 3-5. ログイン後遷移の優先順位（仕様・固定）

**この順番は実装・リファクタ時も変えないこと。**（変える場合は本節とテストを同時更新）

1. **明示パス**（いずれか一方）  
   - OAuth の `state`（`AuthContext.login(redirectTo)` が付与）  
   - `/login?next=`（未認証時に `ProtectedRoute` が付与した戻り先）  
   ※ コールバックでは `state` のみ、`/login` 画面では `next` のみが使われる。同一カテゴリの「明示的遷移意図」であり、**どちらも `state` より `next` を優先するような二重定義はしない**（場面が違うだけ）。

2. **安全性チェック済みの内部パス**  
   下記「正規化・拒否」を通過した場合のみ 1. を採用。

3. **デバイス別デフォルト** — `getPostLoginPath()`（デスクトップ→`/`、モバイル→`/market-analysis`）

4. **最終フォールバック** — 3 と同じ（明示なし・不正時）。

**禁止**: 3 だけを常に優先して 1 を無視すること。

**正規化・拒否（`next` / `state` 共通）**

- 段階的 `decodeURIComponent`（多重 `%2F%2F...` 等）のあと検証する。  
- 拒否: `//evil.com`、`http(s)://...`、`javascript:` を含むもの、制御文字、オープンリダイレクトに該当するパターン。  
- **内部パスでも拒否**: `/login`（およびその配下）、`/auth/ctrader/callback`（およびその配下）— ログインループ・認証ループ防止。  
- 上記で拒否された場合は 3 へ落とす。

実装の起点: `src/frontend/lib/postLoginRedirect.ts`（`resolvePostLoginRedirect`、`fullyDecodeRedirectInput`、`isRedirectLoopPath`）、`app/auth/ctrader/callback/page.tsx`、`app/login/page.tsx`、`components/auth/ProtectedRoute.tsx`。

## 4. 画面別再設計案

### 4-1. Header
- Side-A / Side-B はタブ型で明示表示する。小さなトグルより、現在地と切替先が明快になる。
- 切替時のデフォルト遷移先は各Sideのホームとする。前回ページ復帰は「続きから再開」に格下げする。
- 通知・検索はグローバル機能として右側へ集約する。

**実装（P3 完了時点）**: `components/layout/WorkspaceTabs.tsx`（タブ）+ `lib/workspaceSide.ts`（`getWorkspaceSideFromPathname`）。Side-A タブ →`/`、Side-B タブ →`/side-b/dashboard`。アクティブは pathname が `/side-b` 配下か否かで一意。旧スライダー `SideToggle` は廃止。

### 4-2. Sidebar
- デスクトップでは常時表示、タブレット以下では折りたたみまたはオーバーレイにする。
- 現在のSideに属するメニューのみ表示し、カテゴリの混在をやめる。
- アクティブページの親カテゴリは自動展開し、到達先が初見で見える状態にする。

### 4-3. Side-A Home
| ブロック | 内容 | ねらい |
|---|---|---|
| 上段 | 今日の市場要約 / 要確認件数 / 未確認ノート数 | 初手の判断材料を1画面で提示 |
| 中段 | ノートを書く / 市場を見る / 戦略を確認する | 主要導線を3択程度に圧縮 |
| 下段 | 最近のノート / AIの新規仮説 / 前回の続き | 再訪時の復帰を速くする |

**実装（P2 完了時点）**: `app/page.tsx` → `components/home/HomeWorkbench.tsx`。上段 KPI は下書きノート数・未読通知・AI 要確認（Side-B 検証待ち件数）・今日の注目（`daily-status` またはフォールバック文言）。中段は主要3導線。下段は「前回の続き」（`localStorage` + `AppShell` で **pathname のみ** 記録・**7 日 TTL**・失敗時は `Promise.allSettled` で他 KPI を維持）と最近のノート一覧。要約 API の強化は後続で可。

### 4-4. Side-B Dashboard
| ブロック | 内容 | ねらい |
|---|---|---|
| 最上段 | 要確認 / 検証中 / confirmed / rejected のKPI | 全体状況を一目で把握 |
| 中央 | 仮説一覧 / 検証キュー / エージェント / 比較 へのクイックリンク | Side-B内の正規ハブにする |
| 下段 | 最近のconfirmed・rejected・Discovery要約 | 変化点の確認を高速化 |

### 4-5. Side-B Agent（/side-b）
- 役割は「AIの運転席」に限定する。操作・監視・思考ログ・最近結果だけに集中させる。
- ここにハブ機能を持たせすぎない。俯瞰は dashboard、一覧は hypotheses、進行管理は validation に委ねる。
- ページ上部に Side-B 共通タブを配置する場合は、dashboard / hypotheses / validation / agent / comparison の5本程度に絞る。

**実装（P4 完了時点）**: Side-B のナビは **`lib/navigation/sideBNav.ts` を単一ソース**とする。`Sidebar` の「AI・台帳」ブロックと `app/side-b/page.tsx` 上部タブは同じ `SIDE_B_WORKSPACE_ITEMS` から生成。ラベル・href・順序・運転席タブ表示（`showInAgentTabStrip`）を二重定義しない。アクティブ判定は **`lib/navigation/navActive.ts` の `isNavHrefActive`**（`/side-b` は運転席のみ厳密一致）。

### 4-6. モバイル導線（実装メモ）

- **認証後リダイレクト**: モバイル幅のみ `router.push('/market-analysis')`。実装候補: `src/frontend/app/login/page.tsx`（`matchMedia` 等、hydration 後のクライアントのみで分岐）。
- **ボトムナビ**: `src/frontend/components/layout/BottomNavigation.tsx` で第1項目を `/market-analysis` に変更し、ラベルは「チャート」等ユーザー向け表記に統一（P5 と連携）。
- **Side-B**: モバイルでも §4-4・§4-5 の責務分離は維持。チャート画面から Side-B へはヘッダー／ドロワー経由でよい。

## 5. 実装優先順位
| 優先 | 対象 | 実装内容 | 期待効果 |
|---|---|---|---|
| P1 | AppShell / Sidebar | デスクトップ常時表示、アクティブ親自動展開 | 現在地把握が大幅に改善 |
| P2 | Home | ワークベンチ化、最近の更新と続きから導線を追加（§4-3 実装済） | 初手の迷いを削減 |
| P3 | Header / WorkspaceTabs | タブ化、Side別ホーム遷移（§4-1 実装済）、workspaceSide 共通化 | 切替の文脈が明瞭になる |
| P4 | /side-b | 運転席化、sideBNav 単一ソース・navActive 共通化（§4-5 実装済） | 役割の衝突を解消 |
| P5 | 文言・ラベル | 管理用名称からユーザー行動ベース名称へ変更 | 初見理解を補助 |
| Pm（並行可） | Login / BottomNavigation | モバイルのみログイン後→`/market-analysis`、ボトム左端＝チャート（§3-4・§4-6） | MT系に近い即時チャート体験 |

## 6. 成功判定の基準
- 初回利用者が 10秒以内に「どこから始めるか」を判断できる。
- Side-A / Side-B 切替後に、現在のワークスペースと主要導線が一目で分かる。
- デスクトップ表示で、ナビゲーションを閉じなくても日常操作が完結する。
- Side-B において、俯瞰・一覧・検証・運転席の責務が画面名だけで想像できる。
- **モバイル**: ログイン直後にチャート（`/market-analysis`）が表示され、ボトムナビ左端から常に戻れる。

## 7. 確認対象ファイル（実装着手の起点）
- src/frontend/components/home/HomeWorkbench.tsx（P2 ホーム本体）
- src/frontend/lib/lastSideAPath.ts（前回の続き）
- src/frontend/lib/postLoginRedirect.ts（ログイン後遷移）
- src/frontend/app/page.tsx
- src/frontend/components/layout/Header.tsx
- src/frontend/components/layout/WorkspaceTabs.tsx（P3 ワークスペースタブ）
- src/frontend/lib/workspaceSide.ts（Side 判定の単一ソース）
- src/frontend/components/layout/Sidebar.tsx
- src/frontend/lib/navigation/sideBNav.ts（P4 Side-B ナビ）
- src/frontend/lib/navigation/navActive.ts（アクティブ判定）
- src/frontend/components/layout/AppShell.tsx
- src/frontend/app/side-b/page.tsx
- src/frontend/app/side-b/dashboard/page.tsx
- src/frontend/app/login/page.tsx（モバイル着地点分岐）
- src/frontend/app/market-analysis/page.tsx（チャート本体・モバイルファーストの着地点）
- src/frontend/components/layout/BottomNavigation.tsx（モバイル第1タブ＝チャート）
