// Jest セットアップ: 環境変数の読み込みと DATABASE_URL の既定値設定
// すべての時刻は UTC 保存を前提にする（DB 側で timestamptz）
import dotenv from 'dotenv';

dotenv.config();

// DATABASE_URL が未設定の場合、ローカル開発用の既定値を適用
// 注意: DB_URL は非推奨。DATABASE_URL を使用すること
if (!process.env.DATABASE_URL) {
  // ユーザー環境のローカルロールに合わせて調整（ここでは nekoya を既定）
  process.env.DATABASE_URL = 'postgresql://nekoya@localhost:5432/tradeassist';
}
