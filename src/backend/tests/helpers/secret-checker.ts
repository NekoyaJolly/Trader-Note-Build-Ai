/**
 * テスト環境のシークレット存在チェック＆条件付きスキップヘルパー
 * 
 * 目的:
 * - 料金が発生するAPI（AI_API_KEY, EODHD_API_KEY）のテストを最小限に抑える
 * - シークレット未設定時にテストをスキップしてCI/CDを継続可能にする
 * - cTrader APIは料金がかからないため全テスト実行
 *
 * 注: 市場データは EODHD を第一選択とするため、市場データ系テストの判定キーは
 *     旧 MARKET_API_KEY (Twelve Data) ではなく EODHD_API_KEY を見る。
 */

/**
 * シークレット存在チェックの戻り値型
 */
export type SecretCheckResult = {
  hasAiApiKey: boolean;
  /** 市場データ (EODHD) API キーの有無。market data 系テストの実行可否判定に使う。 */
  hasMarketApiKey: boolean;
  hasCtraderClientId: boolean;
  hasCtraderClientSecret: boolean;
};

/**
 * 必須シークレットの存在チェック
 *
 * @returns シークレットの存在状態を示すオブジェクト
 */
export const checkRequiredSecrets = (): SecretCheckResult => {
  return {
    hasAiApiKey: !!process.env.AI_API_KEY,
    // 市場データソースは EODHD に統一済 (Twelve Data 撤去)。EODHD_API_KEY を見る。
    hasMarketApiKey: !!process.env.EODHD_API_KEY,
    hasCtraderClientId: !!process.env.CTRADER_CLIENT_ID,
    hasCtraderClientSecret: !!process.env.CTRADER_CLIENT_SECRET,
  };
};

/**
 * cTraderの両方のシークレットが揃っているかチェック
 * 
 * @returns true: CTRADER_CLIENT_ID と CTRADER_CLIENT_SECRET が両方設定されている場合
 *          false: 上記のいずれか、または両方が未設定の場合
 */
export const hasCtraderCredentials = (): boolean => {
  const secrets = checkRequiredSecrets();
  return secrets.hasCtraderClientId && secrets.hasCtraderClientSecret;
};

/**
 * 最小限テストモードかどうかを判定
 * 料金が発生するAPIのテストを最小限に抑える
 * 
 * @returns true: 最小限モード（料金発生APIは基本テストのみ）
 *          false: フルテストモード（全テスト実行）
 */
export const isMinimalTestMode = (): boolean => {
  // CI環境で、かつPRやpush時は最小限モード
  // 環境変数 RUN_FULL_PAID_API_TESTS=true の場合のみフルテスト
  return process.env.CI === 'true' && 
         process.env.RUN_FULL_PAID_API_TESTS !== 'true';
};

/**
 * シークレットが不足している場合にテストをスキップするヘルパー
 * 
 * @param secretName チェックするシークレット名
 * @param testName テスト名（ログ出力用）
 * @returns true: スキップする, false: 実行する
 */
export const skipIfMissingSecret = (
  secretName: keyof ReturnType<typeof checkRequiredSecrets>,
  testName: string
): boolean => {
  const secrets = checkRequiredSecrets();
  if (!secrets[secretName]) {
    console.warn(
      `⚠️  Skipping test "${testName}" - Missing secret: ${secretName}`
    );
    return true;
  }
  return false;
};

/**
 * 料金が発生するテストをスキップするかどうか
 * 最小限モードの場合、基本的なテストのみ実行し拡張テストはスキップ
 * 
 * @param testName テスト名（ログ出力用）
 * @returns true: スキップする, false: 実行する
 */
export const skipIfNotMinimalTest = (testName: string): boolean => {
  if (isMinimalTestMode()) {
    console.warn(
      `⚠️  Skipping extended test "${testName}" - Minimal test mode (paid API cost optimization)`
    );
    return true;
  }
  return false;
};
