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

// レンズ類似度シャドー評価 (Phase α-2) はテストでは既定 OFF にする。
// 理由: runMatchingPipeline 内のシャドー評価が実 DB / analysis-engine に触れると
// 既存ユニットテストが外部依存を持ってしまうため。シャドー評価自体のテストは
// モック注入 + 明示的な 'true' 上書きで行う (matchingService.test.ts 参照)。
if (process.env.LENS_SHADOW_EVALUATION === undefined) {
  process.env.LENS_SHADOW_EVALUATION = 'false';
}

// マッチングエンジン (Phase α-3) はテストでは既定 legacy にする。
// 理由: 既存ユニットテスト群は旧 12 次元経路の挙動を検証しており、本番既定 (lens) のまま
// 走らせると外部依存 (lensSnapshot/市場データ) が必要になるため。lens 経路のテストは
// 明示的な 'lens' 上書き + モック注入で行う (matchingService.test.ts 参照)。
if (process.env.MATCHING_ENGINE === undefined) {
  process.env.MATCHING_ENGINE = 'legacy';
}
