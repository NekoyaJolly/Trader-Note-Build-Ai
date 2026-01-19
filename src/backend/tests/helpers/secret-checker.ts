/**
 * テスト環境のシークレット存在チェック＆条件付きスキップヘルパー
 * 
 * 目的:
 * - 料金が発生するAPI（AI_API_KEY, MARKET_API_KEY）のテストを最小限に抑える
 * - シークレット未設定時にテストをスキップしてCI/CDを継続可能にする
 * - cTrader APIは料金がかからないため全テスト実行
 */

/**
 * 必須シークレットの存在チェック
 */
export const checkRequiredSecrets = () => {
  return {
    hasAiApiKey: !!process.env.AI_API_KEY,
    hasMarketApiKey: !!process.env.MARKET_API_KEY,
    hasCtraderClientId: !!process.env.CTRADER_CLIENT_ID,
    hasCtraderClientSecret: !!process.env.CTRADER_CLIENT_SECRET,
  };
};

/**
 * cTraderの両方のシークレットが揃っているかチェック
 */
export const hasCtraderCredentials = () => {
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
export const isMinimalTestMode = () => {
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
