/**
 * 認証サービス
 *
 * JWT認証のコアロジックを提供
 * - ユーザー登録（パスワードハッシュ化）
 * - ログイン（トークン発行）
 * - トークン検証・リフレッシュ
 */

import bcrypt from 'bcrypt';
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { PrismaClient, User, UserRole } from '@prisma/client';

// 環境変数から秘密鍵を取得（必須）
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production';

// トークンの有効期限
const ACCESS_TOKEN_EXPIRES_IN = '15m'; // アクセストークン: 15分
const REFRESH_TOKEN_EXPIRES_IN = '7d'; // リフレッシュトークン: 7日

// bcryptのソルトラウンド数
const SALT_ROUNDS = 12;

/**
 * JWTペイロードの型定義
 */
export interface TokenPayload extends JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
}

/**
 * トークンペアの型定義
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // アクセストークンの有効期限（秒）
}

/**
 * ユーザー登録入力
 */
export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * ログイン入力
 */
export interface LoginInput {
  email: string;
  password: string;
}

/**
 * 認証結果（ユーザー情報 + トークン）
 */
export interface AuthResult {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: UserRole;
  };
  tokens: TokenPair;
}

/**
 * 認証サービスクラス
 */
export class AuthService {
  constructor(private prisma: PrismaClient) {}

  /**
   * ユーザー登録
   *
   * 新規ユーザーを作成し、トークンペアを発行
   * @param input - 登録情報（email, password, displayName）
   * @returns 認証結果
   * @throws Error - メールアドレスが既に登録されている場合
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const { email, password, displayName } = input;

    // メールアドレスの重複チェック
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Error('このメールアドレスは既に登録されています');
    }

    // パスワードの強度チェック（最低8文字）
    if (password.length < 8) {
      throw new Error('パスワードは8文字以上で設定してください');
    }

    // パスワードをハッシュ化
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // ユーザーを作成
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: displayName || null,
        role: 'user',
        active: true,
      },
    });

    // トークンペアを生成
    const tokens = this.generateTokenPair(user);

    // リフレッシュトークンをDBに保存
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      tokens,
    };
  }

  /**
   * ログイン
   *
   * メールアドレスとパスワードで認証し、トークンペアを発行
   * @param input - ログイン情報（email, password）
   * @returns 認証結果
   * @throws Error - 認証失敗時
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const { email, password } = input;

    // ユーザーを検索
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // セキュリティ上、ユーザーが存在しないことを明かさない
      throw new Error('メールアドレスまたはパスワードが正しくありません');
    }

    // アカウントが無効化されていないかチェック
    if (!user.active) {
      throw new Error('このアカウントは無効化されています');
    }

    // パスワードを検証
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      throw new Error('メールアドレスまたはパスワードが正しくありません');
    }

    // トークンペアを生成
    const tokens = this.generateTokenPair(user);

    // リフレッシュトークンと最終ログイン日時を更新
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken: tokens.refreshToken,
        lastLoginAt: new Date(),
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      tokens,
    };
  }

  /**
   * トークンリフレッシュ
   *
   * リフレッシュトークンを検証し、新しいトークンペアを発行
   * @param refreshToken - リフレッシュトークン
   * @returns 新しいトークンペア
   * @throws Error - トークンが無効な場合
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    // リフレッシュトークンを検証
    let payload: TokenPayload;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as TokenPayload;
    } catch {
      throw new Error('無効なリフレッシュトークンです');
    }

    // ユーザーを検索し、保存されているリフレッシュトークンと照合
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || user.refreshToken !== refreshToken) {
      throw new Error('無効なリフレッシュトークンです');
    }

    if (!user.active) {
      throw new Error('このアカウントは無効化されています');
    }

    // 新しいトークンペアを生成
    const tokens = this.generateTokenPair(user);

    // 新しいリフレッシュトークンをDBに保存（トークンローテーション）
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return tokens;
  }

  /**
   * ログアウト
   *
   * リフレッシュトークンを無効化
   * @param userId - ユーザーID
   */
  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  /**
   * アクセストークンを検証
   *
   * @param token - アクセストークン
   * @returns トークンペイロード
   * @throws Error - トークンが無効な場合
   */
  verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as TokenPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('アクセストークンの有効期限が切れています');
      }
      throw new Error('無効なアクセストークンです');
    }
  }

  /**
   * ユーザーIDからユーザー情報を取得
   *
   * @param userId - ユーザーID
   * @returns ユーザー情報（パスワードハッシュ除く）
   */
  async getUserById(userId: string): Promise<Omit<User, 'passwordHash' | 'refreshToken'> | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  /**
   * パスワード変更
   *
   * @param userId - ユーザーID
   * @param currentPassword - 現在のパスワード
   * @param newPassword - 新しいパスワード
   * @throws Error - 現在のパスワードが正しくない場合
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('ユーザーが見つかりません');
    }

    // 現在のパスワードを検証
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isValidPassword) {
      throw new Error('現在のパスワードが正しくありません');
    }

    // 新しいパスワードの強度チェック
    if (newPassword.length < 8) {
      throw new Error('パスワードは8文字以上で設定してください');
    }

    // 新しいパスワードをハッシュ化して保存
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        // パスワード変更時はリフレッシュトークンを無効化（全デバイスからログアウト）
        refreshToken: null,
      },
    });
  }

  /**
   * トークンペアを生成
   *
   * @param user - ユーザーエンティティ
   * @returns トークンペア
   */
  private generateTokenPair(user: User): TokenPair {
    const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessTokenOptions: SignOptions = {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    };

    const refreshTokenOptions: SignOptions = {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, accessTokenOptions);
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, refreshTokenOptions);

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15分（秒）
    };
  }
}

// シングルトンインスタンスのエクスポート用ファクトリ
export function createAuthService(prisma: PrismaClient): AuthService {
  return new AuthService(prisma);
}
