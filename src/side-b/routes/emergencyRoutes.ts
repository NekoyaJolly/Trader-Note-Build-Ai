/**
 * 緊急停止・キルスイッチ API
 *
 * エンドポイント:
 * - POST /api/side-b/emergency/stop   - 緊急停止（キルスイッチ作動＆一括決済）
 * - POST /api/side-b/emergency/resume - 緊急停止解除
 * - GET  /api/side-b/emergency/status - 現在の状態取得
 */

import { Router } from 'express';
import { prisma } from '../../backend/db/client';
import { createSystemStateRepository } from '../repositories/systemStateRepository';
import { CTraderAuthService } from '../../backend/services/ctrader/ctraderAuthService';
import { CTraderProvider } from '../../infrastructure/market/CTraderProvider';
import { CTraderAccountService } from '../../backend/services/ctrader/ctraderAccountService';
import { mailService } from '../services/mailService';
import { requireAuth, requireRole } from '../../middleware/authMiddleware';

const router = Router();

// 緊急操作APIは管理者権限のみに制限
router.use(requireAuth);
router.use(requireRole(['admin']));

const systemStateRepository = createSystemStateRepository();

/**
 * GET /api/side-b/emergency/status
 * キルスイッチと連続エラー数を取得
 */
router.get('/status', async (req, res) => {
  try {
    const isStopped = await systemStateRepository.getBoolean('emergency_stop', false);
    const consecutiveErrors = await systemStateRepository.getInt('consecutive_errors', 0);

    return res.json({
      success: true,
      data: {
        isEmergencyStopped: isStopped,
        consecutiveErrors,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '状態取得エラー';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/side-b/emergency/stop
 * 緊急停止＆一括決済を実行
 */
router.post('/stop', async (req, res) => {
  try {
    console.log('[Emergency] 緊急キルスイッチがONになりました。一括決済を実行します。');

    // 1. キルスイッチをONに設定
    await systemStateRepository.setBoolean('emergency_stop', true);

    const closeSummary: string[] = [];

    // 2. cTrader 側の実ポジションを一括決済
    try {
      const tokens = await prisma.cTraderToken.findMany();
      console.log(`[Emergency] 登録トークン数: ${tokens.length} 件に対して一括決済を実行します。`);

      for (const token of tokens) {
        let provider: CTraderProvider | null = null;
        try {
          const authService = new CTraderAuthService(prisma);
          provider = new CTraderProvider(authService, token.accountId);
          await provider.connect();
          const accountService = new CTraderAccountService(provider, token.accountId);

          const positions = await accountService.getPositions();
          if (positions.length > 0) {
            console.log(`[Emergency] アカウント ${token.accountId} のポジション数: ${positions.length}`);
            for (const pos of positions) {
              await accountService.closePosition(pos.positionId);
              closeSummary.push(`cTrader Account ${token.accountId}: Position ${pos.positionId} (${pos.symbol}) closed`);
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[Emergency] アカウント ${token.accountId} の決済処理でエラーが発生しました:`, errMsg);
          closeSummary.push(`cTrader Account ${token.accountId}: 決済失敗 - ${errMsg}`);
        } finally {
          if (provider) {
            try {
              await provider.disconnect();
            } catch (cleanupErr) {
              console.error('[Emergency] プロバイダー切断エラー:', cleanupErr);
            }
          }
        }
      }
    } catch (dbErr) {
      const dbErrMsg = dbErr instanceof Error ? dbErr.message : 'Unknown error';
      console.error('[Emergency] cTraderトークン情報の取得に失敗しました:', dbErrMsg);
      closeSummary.push(`cTrader DBトークン取得失敗: ${dbErrMsg}`);
    }

    // 3. 仮想トレード (VirtualTrade) の全 open トレードを一括強制クローズ
    try {
      const openVirtualTrades = await prisma.virtualTrade.findMany({
        where: { status: 'open' },
      });

      if (openVirtualTrades.length > 0) {
        console.log(`[Emergency] 仮想オープンポジション ${openVirtualTrades.length} 件を強制決済します。`);
        for (const trade of openVirtualTrades) {
          // 強制的に closed に更新
          await prisma.virtualTrade.update({
            where: { id: trade.id },
            data: {
              status: 'closed',
              exitPrice: trade.actualEntry ?? trade.plannedEntry, // 手動クローズなのでエントリー値(実エントリー優先)で決済したと仮定
              exitReason: 'manual_close',
              pnlPips: 0,
              pnlAmount: 0,
              exitedAt: new Date(),
            },
          });
          closeSummary.push(`Virtual Trade ${trade.id} (${trade.symbol}) closed`);
        }
      }
    } catch (virtualErr) {
      const virtualErrMsg = virtualErr instanceof Error ? virtualErr.message : 'Unknown error';
      console.error('[Emergency] 仮想トレードの決済処理に失敗しました:', virtualErrMsg);
      closeSummary.push(`Virtual Trade 決済失敗: ${virtualErrMsg}`);
    }

    // 4. 管理者への緊急アラートメール送信
    const mailSubject = '緊急停止(キルスイッチ)が実行されました';
    const mailText = [
      'システムのキルスイッチが作動しました。すべての新規取引プロセスは待機モードに強制されます。',
      '',
      '=== 決済処理サマリー ===',
      closeSummary.length > 0 ? closeSummary.join('\n') : '決済対象のポジションはありませんでした。',
    ].join('\n');

    await mailService.sendAlertMail(mailSubject, mailText);

    return res.json({
      success: true,
      message: '緊急停止とポジションの一括決済を実行しました。',
      data: {
        closeSummary,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '緊急停止の実行中にエラーが発生しました。';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/side-b/emergency/resume
 * 緊急停止を解除
 */
router.post('/resume', async (req, res) => {
  try {
    console.log('[Emergency] 緊急キルスイッチを解除します。');

    // 1. キルスイッチをOFFにし、エラーカウントをリセット
    await systemStateRepository.setBoolean('emergency_stop', false);
    await systemStateRepository.setInt('consecutive_errors', 0);

    // 2. メールで通知
    await mailService.sendAlertMail(
      '緊急停止が解除されました',
      '管理者の指示によりシステムのキルスイッチが解除されました。通常のOrchestratorサイクルが再開されます。'
    );

    return res.json({
      success: true,
      message: '緊急停止状態を解除しました。通常のサイクルを再開します。',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '緊急停止解除中にエラーが発生しました。';
    return res.status(500).json({ success: false, error: message });
  }
});

export const emergencyRouter = router;
