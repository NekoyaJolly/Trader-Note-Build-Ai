/**
 * cTrader OAuth 認証サービス
 * 
 * 目的: cTrader Open API の OAuth 2.0 認証フローを管理
 * 
 * フロー:
 * 1. ユーザーが認証URL にリダイレクト
 * 2. cTrader で認証後、Vercel Callback に code が返る
 * 3. Vercel → Railway API で code を送信
 * 4. Railway が code → token 交換し、DB に保存
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { config } from '../../../config';

// ========================================
// Zod スキーマ
// ========================================

/**
 * トークンレスポンス（cTrader API）
 */
export const CTraderTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string().optional(),
});

export type CTraderTokenResponse = z.infer<typeof CTraderTokenResponseSchema>;

/**
 * トークン交換リクエスト
 */
export const ExchangeCodeRequestSchema = z.object({
  code: z.string().min(1, 'code は必須です'),
});

export type ExchangeCodeRequest = z.infer<typeof ExchangeCodeRequestSchema>;

/**
 * 保存済みトークン情報
 */
export const StoredTokenSchema = z.object({
  accountId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.date(),
  scope: z.string().nullable(),
});

export type StoredToken = z.infer<typeof StoredTokenSchema>;

// ========================================
// cTrader 認証サービス
// ========================================

export class CTraderAuthService {
  private prisma: PrismaClient;
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }
  
  /**
   * 認証URL を生成
   * 
   * @param state - CSRF 防止用の state パラメータ（オプション）
   * @returns 認証URL
   */
  generateAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: config.ctrader.clientId,
      redirect_uri: config.ctrader.redirectUri,
      response_type: 'code',
      scope: 'accounts trading',
    });
    
    if (state) {
      params.set('state', state);
    }
    
    return `${config.ctrader.authUrl}?${params.toString()}`;
  }
  
  /**
   * 認可コードをトークンに交換
   * 
   * @param code - 認可コード（Callback から取得）
   * @returns トークン情報
   */
  async exchangeCode(code: string): Promise<StoredToken> {
    const response = await fetch(config.ctrader.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.ctrader.clientId,
        client_secret: config.ctrader.clientSecret,
        redirect_uri: config.ctrader.redirectUri,
      }).toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[cTraderAuth] トークン交換失敗:', {
        status: response.status,
        error: errorText,
        tokenUrl: config.ctrader.tokenUrl,
        redirectUri: config.ctrader.redirectUri,
      });
      throw new Error(`cTrader トークン交換エラー: ${response.status} ${errorText}`);
    }
    
    const json = await response.json();
    console.log('[cTraderAuth] トークンレスポンス受信:', {
      hasAccessToken: !!json.access_token,
      hasRefreshToken: !!json.refresh_token,
      expiresIn: json.expires_in,
    });
    
    const result = CTraderTokenResponseSchema.safeParse(json);
    
    if (!result.success) {
      console.error('[cTraderAuth] レスポンスパースエラー:', json);
      throw new Error(`cTrader レスポンスパースエラー: ${result.error.message}`);
    }
    
    const tokenData = result.data;
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    
    // アカウントIDを取得（アクセストークンから）
    // 注意: cTrader API ではトークンからアカウントIDを取得する追加APIコールが必要
    // ここでは一時的に 'default' を使用し、後で実際のアカウントIDに更新
    const accountId = await this.fetchAccountId(tokenData.access_token);
    
    // DB に保存
    const savedToken = await this.saveToken({
      accountId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scope: tokenData.scope || null,
    });
    
    return savedToken;
  }
  
  /**
   * リフレッシュトークンでアクセストークンを更新
   * 
   * @param accountId - アカウントID
   * @returns 更新されたトークン情報
   */
  async refreshAccessToken(accountId: string): Promise<StoredToken> {
    const existingToken = await this.prisma.cTraderToken.findUnique({
      where: { accountId },
    });
    
    if (!existingToken) {
      throw new Error(`アカウント ${accountId} のトークンが見つかりません`);
    }
    
    const response = await fetch(config.ctrader.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: existingToken.refreshToken,
        client_id: config.ctrader.clientId,
        client_secret: config.ctrader.clientSecret,
      }).toString(),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`cTrader トークン更新エラー: ${response.status} ${errorText}`);
    }
    
    const json = await response.json();
    const result = CTraderTokenResponseSchema.safeParse(json);
    
    if (!result.success) {
      throw new Error(`cTrader レスポンスパースエラー: ${result.error.message}`);
    }
    
    const tokenData = result.data;
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    
    // DB を更新
    const savedToken = await this.saveToken({
      accountId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scope: tokenData.scope || null,
    });
    
    return savedToken;
  }
  
  /**
   * 有効なアクセストークンを取得（必要に応じて自動更新）
   * 
   * @param accountId - アカウントID
   * @returns アクセストークン
   */
  async getValidAccessToken(accountId: string): Promise<string> {
    const token = await this.prisma.cTraderToken.findUnique({
      where: { accountId },
    });
    
    if (!token) {
      throw new Error(`アカウント ${accountId} のトークンが見つかりません`);
    }
    
    // 有効期限の5分前に更新
    const refreshBuffer = 5 * 60 * 1000;
    if (token.expiresAt.getTime() - refreshBuffer < Date.now()) {
      const refreshedToken = await this.refreshAccessToken(accountId);
      return refreshedToken.accessToken;
    }
    
    return token.accessToken;
  }
  
  /**
   * 接続状態を確認
   * 
   * @returns 接続済みアカウントのリスト
   */
  async getConnectionStatus(): Promise<{
    connected: boolean;
    accounts: Array<{
      accountId: string;
      expiresAt: Date;
      lastConnectedAt: Date | null;
    }>;
  }> {
    const tokens = await this.prisma.cTraderToken.findMany({
      select: {
        accountId: true,
        expiresAt: true,
        lastConnectedAt: true,
      },
    });
    
    return {
      connected: tokens.length > 0,
      accounts: tokens,
    };
  }
  
  /**
   * 接続を解除（トークン削除）
   * 
   * @param accountId - アカウントID
   */
  async disconnect(accountId: string): Promise<void> {
    await this.prisma.cTraderToken.delete({
      where: { accountId },
    });
  }
  
  /**
   * 全接続を解除
   */
  async disconnectAll(): Promise<void> {
    await this.prisma.cTraderToken.deleteMany();
  }
  
  // ========================================
  // 内部メソッド
  // ========================================
  
  /**
   * アクセストークンからアカウントIDを取得
   * 
   * 注意: cTrader Open API では別途 API コールが必要
   * 実装は cTrader API ドキュメントを参照
   */
  private async fetchAccountId(accessToken: string): Promise<string> {
    // TODO: cTrader API でアカウント情報を取得
    // 一時的にデフォルト値を返す
    // 実際の実装では ProtoOAGetAccountListReq を送信してアカウントIDを取得
    return `ctrader_${Date.now()}`;
  }
  
  /**
   * トークンを DB に保存
   */
  private async saveToken(token: {
    accountId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope: string | null;
  }): Promise<StoredToken> {
    const saved = await this.prisma.cTraderToken.upsert({
      where: { accountId: token.accountId },
      create: {
        accountId: token.accountId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scope: token.scope,
      },
      update: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scope: token.scope,
      },
    });
    
    return {
      accountId: saved.accountId,
      accessToken: saved.accessToken,
      refreshToken: saved.refreshToken,
      expiresAt: saved.expiresAt,
      scope: saved.scope,
    };
  }
}
