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
import { PrismaClient, User, CTraderToken } from '@prisma/client';
import { config } from '../../../config';
import { sessionService, CreateSessionPayload } from '../auth/sessionService';

// ========================================
// Zod スキーマ
// ========================================

/**
 * トークンレスポンス（cTrader API）
 * 注意: cTrader API は snake_case と camelCase の両方を返す
 * token_type は返さず、tokenType のみ返す場合がある
 */
export const CTraderTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  // token_type は返されない場合があるため optional に
  token_type: z.string().optional(),
  tokenType: z.string().optional(),
  scope: z.string().optional(),
  // errorCode は null で返されることがある
  errorCode: z.string().nullable().optional(),
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

/**
 * 認証結果
 */
export interface AuthResult {
  user: User;
  token: CTraderToken;
  jwt: string;
  isNewUser: boolean;
}

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
      // 注意: trading スコープは cTrader アプリで有効化が必要
      // 現在は accounts のみで認証（取引履歴・ポジション読み取り）
      scope: 'accounts',
    });
    
    if (state) {
      params.set('state', state);
    }
    
    return `${config.ctrader.authUrl}?${params.toString()}`;
  }
  
  /**
   * 認可コードをトークンに交換し、ユーザーを自動作成・ログイン
   * 
   * フロー:
   * 1. code → token 交換
   * 2. cTrader API でアカウント情報取得
   * 3. accountId で既存ユーザー検索
   * 4. なければ User 新規作成
   * 5. CTraderToken 保存（userId 紐付け）
   * 6. JWT 発行
   * 
   * @param code - 認可コード（Callback から取得）
   * @returns 認証結果（user, token, jwt, isNewUser）
   */
  async exchangeCodeAndLogin(code: string): Promise<AuthResult> {
    // 1. code → token 交換
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
    
    const json: unknown = await response.json();
    const jsonObj = json as Record<string, unknown>;
    console.log('[cTraderAuth] トークンレスポンス受信:', {
      hasAccessToken: !!jsonObj.access_token,
      hasRefreshToken: !!jsonObj.refresh_token,
      expiresIn: jsonObj.expires_in,
    });
    
    const result = CTraderTokenResponseSchema.safeParse(json);
    
    if (!result.success) {
      console.error('[cTraderAuth] レスポンスパースエラー:', jsonObj);
      throw new Error(`cTrader レスポンスパースエラー: ${result.error.message}`);
    }
    
    const tokenData = result.data;
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    
    // 2. アカウントIDを取得（アクセストークンから）
    const accountId = await this.fetchAccountId(tokenData.access_token);
    
    // 3. 既存ユーザーを検索（primaryAccountId で検索）
    let user = await this.prisma.user.findUnique({
      where: { primaryAccountId: accountId },
    });
    
    let isNewUser = false;
    
    // 4. ユーザーが存在しない場合は新規作成
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          primaryAccountId: accountId,
          displayName: `cTrader User ${accountId.substring(0, 8)}`,
          email: null,
          role: 'user',
          active: true,
          lastLoginAt: new Date(),
        },
      });
      isNewUser = true;
      console.log('[cTraderAuth] 新規ユーザー作成:', user.id, accountId);
    } else {
      // 既存ユーザーの最終ログイン日時を更新
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      console.log('[cTraderAuth] 既存ユーザーでログイン:', user.id, accountId);
    }
    
    // 5. CTraderToken を保存（userId 紐付け）
    const token = await this.prisma.cTraderToken.upsert({
      where: { accountId },
      create: {
        userId: user.id,
        accountId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scope: tokenData.scope || null,
      },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scope: tokenData.scope || null,
      },
    });
    
    // 6. JWT を発行
    const sessionPayload: CreateSessionPayload = {
      userId: user.id,
      primaryAccountId: user.primaryAccountId,
      email: user.email || null,
      displayName: user.displayName || null,
      role: user.role,
    };
    
    const jwt = sessionService.generateToken(sessionPayload);
    
    return {
      user,
      token,
      jwt,
      isNewUser,
    };
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
    
    // DB を更新（既存トークンを更新）
    const savedToken = await this.prisma.cTraderToken.update({
      where: { accountId },
      data: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scope: tokenData.scope || null,
      },
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
   * 有効なトークンを取得（最初のアカウント）
   * 
   * @returns トークン情報（存在しない場合は null）
   */
  async getValidToken(): Promise<StoredToken | null> {
    const token = await this.prisma.cTraderToken.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    
    if (!token) {
      return null;
    }
    
    // 有効期限の5分前に更新
    const refreshBuffer = 5 * 60 * 1000;
    if (token.expiresAt.getTime() - refreshBuffer < Date.now()) {
      try {
        return await this.refreshAccessToken(token.accountId);
      } catch (error) {
        console.error('[CTraderAuth] トークン更新エラー:', error);
        return null;
      }
    }
    
    return {
      accountId: token.accountId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
    };
  }
  
  /**
   * 最終接続日時を更新
   * 
   * @param accountId - アカウントID
   */
  async updateLastConnected(accountId: string): Promise<void> {
    await this.prisma.cTraderToken.update({
      where: { accountId },
      data: { lastConnectedAt: new Date() },
    });
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
   * cTrader Open API の ProtoOAGetAccountListByAccessTokenReq コマンドを使用して
   * 実際のアカウント情報を取得し、ctidTraderAccountId を返す
   * 
   * @param accessToken - アクセストークン
   * @returns cTrader アカウントID（ctidTraderAccountId）
   */
  private async fetchAccountId(accessToken: string): Promise<string> {
    // cTrader Layer ライブラリを使用してアカウント情報を取得
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CTraderConnection } = require('@reiryoku/ctrader-layer');

    // WebSocket型定義
    interface CTraderConnectionType {
      open(): Promise<void>;
      close(): Promise<void>;
      sendCommand(command: string, params: Record<string, unknown>): Promise<unknown>;
    }

    interface CTraderAccount {
      ctidTraderAccountId: number;
      isLive: boolean;
      traderLogin?: number;
    }

    interface CTraderAccountListResponse {
      ctidTraderAccount?: CTraderAccount[];
    }

    let connection: CTraderConnectionType | null = null;

    try {
      // 1. Live環境でWebSocket接続を試行
      connection = new CTraderConnection({
        host: 'live.ctraderapi.com',
        port: 5035,
      }) as CTraderConnectionType;

      await connection.open();
      console.log('[CTraderAuth] WebSocket 接続成功 (Live環境)');

      // 2. アプリケーション認証
      await connection.sendCommand('ProtoOAApplicationAuthReq', {
        clientId: config.ctrader.clientId,
        clientSecret: config.ctrader.clientSecret,
      });
      console.log('[CTraderAuth] アプリケーション認証成功');

      // 3. アカウント一覧を取得
      const accountListRes = await connection.sendCommand('ProtoOAGetAccountListByAccessTokenReq', {
        accessToken,
      }) as CTraderAccountListResponse;

      const accounts = accountListRes.ctidTraderAccount || [];
      if (accounts.length === 0) {
        throw new Error('cTrader アカウントが見つかりません');
      }

      // 4. 最初のアカウントのIDを返す
      const selectedAccount = accounts[0];
      const accountId = selectedAccount.ctidTraderAccountId.toString();
      
      console.log('[CTraderAuth] アカウント取得成功:', {
        accountId,
        isLive: selectedAccount.isLive,
        traderLogin: selectedAccount.traderLogin,
      });

      return accountId;

    } catch (error) {
      // Live環境で失敗した場合、Demo環境を試行
      console.warn('[CTraderAuth] Live環境でアカウント取得失敗。Demo環境を試行します:', error);

      try {
        if (connection) {
          await connection.close();
        }

        connection = new CTraderConnection({
          host: 'demo.ctraderapi.com',
          port: 5035,
        }) as CTraderConnectionType;

        await connection.open();
        console.log('[CTraderAuth] WebSocket 接続成功 (Demo環境)');

        await connection.sendCommand('ProtoOAApplicationAuthReq', {
          clientId: config.ctrader.clientId,
          clientSecret: config.ctrader.clientSecret,
        });
        console.log('[CTraderAuth] アプリケーション認証成功 (Demo環境)');

        const accountListRes = await connection.sendCommand('ProtoOAGetAccountListByAccessTokenReq', {
          accessToken,
        }) as CTraderAccountListResponse;

        const accounts = accountListRes.ctidTraderAccount || [];
        if (accounts.length === 0) {
          throw new Error('cTrader アカウントが見つかりません (Demo環境)');
        }

        const selectedAccount = accounts[0];
        const accountId = selectedAccount.ctidTraderAccountId.toString();

        console.log('[CTraderAuth] アカウント取得成功 (Demo環境):', {
          accountId,
          isLive: selectedAccount.isLive,
          traderLogin: selectedAccount.traderLogin,
        });

        return accountId;

      } catch (demoError) {
        console.error('[CTraderAuth] Demo環境でもアカウント取得失敗:', demoError);
        throw new Error(`cTrader アカウント情報の取得に失敗しました: ${demoError instanceof Error ? demoError.message : '不明なエラー'}`);
      }
    } finally {
      // 接続をクリーンアップ
      if (connection) {
        try {
          await connection.close();
          console.log('[CTraderAuth] WebSocket 接続をクローズしました');
        } catch (closeError) {
          console.warn('[CTraderAuth] WebSocket クローズ時のエラー:', closeError);
        }
      }
    }
  }
}
