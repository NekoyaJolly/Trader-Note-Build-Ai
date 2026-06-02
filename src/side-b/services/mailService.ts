/**
 * MailService
 *
 * アラートメールの送信、及び外部からのインバウンドWebhook経由の
 * メール受信処理をハンドリングします。
 */

import nodemailer from 'nodemailer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createSystemStateRepository } from '../repositories/systemStateRepository';
import type { InboundMail } from '../../schemas/api/sideB';

function hashMailToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function isMailSecurityTokenValid(providedToken: string, expectedToken: string): boolean {
  return timingSafeEqual(hashMailToken(providedToken), hashMailToken(expectedToken));
}

export class MailService {
  private readonly systemStateRepository = createSystemStateRepository();

  /**
   * メールを送信する
   */
  async sendAlertMail(subject: string, text: string): Promise<boolean> {
    const host = process.env.SMTP_HOST;
    const portStr = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const to = process.env.ALERT_MAIL_TO;
    const from = process.env.ALERT_MAIL_FROM || 'noreply@tradeassist.ai';

    if (!host || !portStr || !user || !pass || !to) {
      console.warn('[MailService] SMTP設定が不足しているため、メール送信をスキップします。');
      console.log(`[MailService] 送信予定メール - 件名: ${subject}`);
      return false;
    }

    const port = parseInt(portStr, 10);

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to,
        subject: `[TradeAssist Alert] ${subject}`,
        text,
      });

      console.log(`[MailService] メールを送信しました: ${to} - ${subject}`);
      return true;
    } catch (error) {
      console.error('[MailService] メールの送信に失敗しました:', error);
      return false;
    }
  }

  /**
   * 受信したメールを処理する (インバウンドWebhook用)
   */
  async handleInboundMail(payload: InboundMail): Promise<{ success: boolean; message: string }> {
    const securityToken = process.env.MAIL_SECURITY_TOKEN;
    if (!securityToken) {
      return { success: false, message: 'MAIL_SECURITY_TOKEN が設定されていません。' };
    }

    const { subject, text, from } = payload;
    console.log(`[MailService] メール受信: ${from} - ${subject}`);

    // 本文からセキュリティトークンとコマンドをパース
    // 形式例:
    // TOKEN: my-secret-token
    // ACTION: STOP  (または ACTION: RESUME)
    const tokenRegex = /TOKEN:\s*([^\s]+)/i;
    const actionRegex = /ACTION:\s*(STOP|RESUME)/i;

    const tokenMatch = text.match(tokenRegex);
    const actionMatch = text.match(actionRegex);

    if (!tokenMatch) {
      return { success: false, message: 'セキュリティトークンが本文に含まれていません。' };
    }

    const providedToken = tokenMatch[1];
    if (!isMailSecurityTokenValid(providedToken, securityToken)) {
      return { success: false, message: 'セキュリティトークンが一致しません。' };
    }

    if (!actionMatch) {
      return { success: false, message: 'ACTION指示が本文に含まれていません。' };
    }

    const action = actionMatch[1].toUpperCase();

    if (action === 'STOP') {
      const alreadyStopped = await this.systemStateRepository.getBoolean('emergency_stop', false);
      if (alreadyStopped) {
        await this.systemStateRepository.recordEmergencyAuditBestEffort({
          action: 'stop',
          source: 'mail',
          actor: 'mail-webhook',
          reason: 'already_stopped',
        });
        return { success: true, message: '緊急停止は既に有効です。' };
      }

      await this.systemStateRepository.setBoolean('emergency_stop', true);
      await this.systemStateRepository.recordEmergencyAuditBestEffort({
        action: 'stop',
        source: 'mail',
        actor: 'mail-webhook',
        reason: 'mail_stop_command',
      });
      console.log('[MailService] インバウンドメールにより緊急停止(キルスイッチ)がONになりました。');
      await this.sendAlertMail(
        '緊急停止が実行されました (メール指示)',
        `受信メール (${from}) の指示により、キルスイッチがONになりました。すべてのOrchestratorサイクルは待機モードに強制され、新規注文は行われません。`
      );
      return { success: true, message: '緊急停止を実行しました。' };
    } else if (action === 'RESUME') {
      const alreadyRunning = !(await this.systemStateRepository.getBoolean('emergency_stop', false));
      if (alreadyRunning) {
        await this.systemStateRepository.recordEmergencyAuditBestEffort({
          action: 'resume',
          source: 'mail',
          actor: 'mail-webhook',
          reason: 'already_running',
        });
        return { success: true, message: '緊急停止は既に解除されています。' };
      }

      await this.systemStateRepository.setBoolean('emergency_stop', false);
      await this.systemStateRepository.setInt('consecutive_errors', 0); // エラーカウントもリセット
      await this.systemStateRepository.recordEmergencyAuditBestEffort({
        action: 'resume',
        source: 'mail',
        actor: 'mail-webhook',
        reason: 'mail_resume_command',
      });
      console.log('[MailService] インバウンドメールにより緊急停止が解除されました。');
      await this.sendAlertMail(
        '緊急停止が解除されました (メール指示)',
        `受信メール (${from}) の指示により、キルスイッチが解除されました。Orchestratorサイクルが再開されます。`
      );
      return { success: true, message: '緊急停止を解除しました。' };
    }

    return { success: false, message: '無効なACTIONです。' };
  }
}

export const mailService = new MailService();
