/**
 * CLI MarketSnapshot 生成 & MatchEvaluation 実行スクリプト（検証フェーズ専用）
 * 
 * 目的:
 * 1. 既存 Trade に含まれる symbol を抽出
 * 2. MarketSnapshot（15m/60m）を生成・保存（MarketIngestService 利用）
 * 3. 全 TradeNote × 最新 MarketSnapshot を一致判定（MatchEvaluationService 利用）
 * 4. Phase4 の通知トリガロジックで NotificationLog を生成（NotificationTriggerService 利用）
 * 
 * 絶対遵守:
 * - API エンドポイント追加・変更なし
 * - UI の変更なし
 * - Prisma スキーマ・マイグレーション変更なし
 * - 新規ライブラリ追加禁止
 * - ログ・コメントはすべて日本語
 * 
 * 実行方法:
 * DB_URL="postgresql://nekoya@localhost:5432/tradeassist_test" \
 * npx ts-node scripts/run-market-match.ts
 */

import { prisma } from '../src/backend/db/client';
import { MarketIngestService } from '../src/backend/services/ingest/marketIngestService';
import { MatchEvaluationService } from '../src/backend/services/matching/matchEvaluationService';
import { NotificationTriggerService } from '../src/services/notification/notificationTriggerService';
import { TradeNoteGeneratorService } from '../src/services/note-generator/tradeNoteGeneratorService';

async function main() {
  console.log('=== CLI: MarketSnapshot 生成 & MatchEvaluation 実行 開始 ===\n');

  // 進捗サマリ用のカウンタ
  let snapshotOk = false;
  let matchCount = 0;
  let notificationCount = 0;

  try {
    // ===== DB 接続確認 =====
    console.log('DB 接続確認中...');
    await prisma.$connect();
    const tradeTotal = await prisma.trade.count();
    console.log(`Trade 件数: ${tradeTotal}`);
    if (tradeTotal === 0) {
      console.error('トレードデータが存在しません。CSV インポート後に再実行してください。');
      process.exit(1);
    }

    // ===== シンボル抽出（Trade から distinct） =====
    console.log('シンボル抽出中（Trade テーブルから重複除去）...');
    const tradeSymbols = await prisma.trade.findMany({
      select: { symbol: true },
      distinct: ['symbol'],
    });
    const symbols = tradeSymbols.map((t) => t.symbol);
    console.log(`対象シンボル: ${symbols.join(', ')}`);
    if (symbols.length === 0) {
      console.error('対象シンボルが取得できませんでした。処理を終了します。');
      process.exit(1);
    }

    // ===== MarketSnapshot 生成（15m / 60m） =====
    console.log('\n[Step 1] MarketSnapshot 生成（15m / 60m）...');
    const ingestService = new MarketIngestService();

    // 各シンボルについて 15m/60m を生成・保存
    for (const symbol of symbols) {
      try {
        console.log(`  → ${symbol} の 15m/60m スナップショット取得・保存...`);
        await ingestService.ingestSymbol(symbol);
      } catch (err) {
        console.error('市場データ取得または保存時のエラー:', err);
        console.error('即時終了します。');
        process.exit(1);
      }
    }

    // 保存確認（件数を確認）
    const snapshotTotal = await prisma.marketSnapshot.count();
    console.log(`  ✓ MarketSnapshot 総数: ${snapshotTotal}`);
    snapshotOk = snapshotTotal > 0;

    // ===== TradeNote 生成（未存在時のみ） =====
    console.log('\n[Step 1.5] TradeNote の初期生成（未存在時のみ）...');
    const noteCount = await prisma.tradeNote.count();
    if (noteCount === 0) {
      console.log('TradeNote が存在しないため、全 Trade からノートを生成します...');
      const trades = await prisma.trade.findMany({ orderBy: { timestamp: 'asc' } });
      const generator = new TradeNoteGeneratorService();
      try {
        const results = await generator.batchGenerateNotes(trades);
        console.log(`  ✓ 生成完了: ${results.length} 件のノートを作成`);
      } catch (err) {
        console.error('TradeNote 生成エラー:', err);
        // ノート生成に失敗した場合は一致判定が行えないため終了
        process.exit(1);
      }
    } else {
      console.log(`既存の TradeNote 件数: ${noteCount}（生成はスキップ）`);
    }

    // ===== MatchEvaluation 実行 =====
    console.log('\n[Step 2] TradeNote × 最新 MarketSnapshot の一致判定...');
    const matchService = new MatchEvaluationService();
    const matchResults = await matchService.evaluateAllNotes();
    matchCount = matchResults.length;
    console.log(`  ✓ MatchResult 生成件数: ${matchCount}`);

    // ===== Notification 生成（Phase4 ロジック利用） =====
    console.log('\n[Step 3] 通知トリガ実行（In-App ログ記録）...');
    const triggerService = new NotificationTriggerService();

    // 生成された MatchResult を取り直し、関連データを含めて通知判定
    for (const mr of matchResults) {
      try {
        const full = await prisma.matchResult.findUnique({
          where: { id: mr.id },
          include: { note: true, marketSnapshot: true },
        });
        if (!full || !full.note || !full.marketSnapshot) {
          console.warn(`  - 関連データ不足のため通知スキップ: matchResultId=${mr.id}`);
          continue;
        }
        const result = await triggerService.evaluateAndNotify(full, 'in_app');
        if (result.status === 'sent') {
          notificationCount += 1;
        }
      } catch (err) {
        console.error(`通知判定・記録エラー (matchResultId=${mr.id}):`, err);
        // 異常系でも処理は続行（他件への影響を避ける）
      }
    }

    console.log(`  ✓ NotificationLog 生成件数（sent）: ${notificationCount}`);

    // ===== 完了レポート出力（必須フォーマット） =====
    console.log('\n=== 検証フェーズ 完了レポート ===');
    console.log(`- MarketSnapshot 生成: ${snapshotOk ? 'OK（15m / 60m）' : '未生成'}`);
    console.log(`- MatchResult 生成: ${matchCount > 0 ? `OK（件数: ${matchCount}）` : '未生成'}`);
    console.log(`- NotificationLog 生成: ${notificationCount > 0 ? `OK（件数: ${notificationCount}）` : '未生成'}`);
    console.log('- Prisma エラー: なし');
  } catch (error) {
    // 予期しない例外は即時終了（Prisma エラー含む）
    console.error('\n❌ 重大なエラーが発生しました:');
    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.stack);
    } else {
      console.error(error);
    }
    process.exit(1);
  } finally {
    // Prisma 切断
    await prisma.$disconnect();
    console.log('\nDB 接続を切断しました。');
  }
}

// 実行
main()
  .then(() => {
    console.log('\n=== CLI 実行 正常終了 ===');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nCLI 実行 エラー終了:', err);
    process.exit(1);
  });
