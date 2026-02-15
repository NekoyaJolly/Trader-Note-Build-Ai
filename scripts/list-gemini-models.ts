/**
 * Gemini（OpenAI互換エンドポイント）で利用可能なモデル一覧を取得して表示するスクリプト
 *
 * - .env を読み込み
 * - AI_BASE_URL / AI_API_KEY を使って models.list() を呼び出す
 * - 返ってきた model.id のみを表示（キー等の機密は出さない）
 */

import 'dotenv/config';
import OpenAI from 'openai';

async function main(): Promise<void> {
  const apiKey = process.env.AI_API_KEY;
  const baseURL = process.env.AI_BASE_URL;

  if (!apiKey) {
    throw new Error('AI_API_KEY が未設定です（.env を確認してください）');
  }
  if (!baseURL) {
    throw new Error('AI_BASE_URL が未設定です（.env を確認してください）');
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  const res = await client.models.list();

  // OpenAI SDK の戻りはページングされる場合があるが、まずは1回目の結果を一覧表示する。
  // （必要なら後でページング対応する）
  const ids = res.data
    .map(m => m.id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .sort();

  if (ids.length === 0) {
    console.log('モデルが0件でした（権限/課金/エンドポイント/レスポンス形式を確認してください）');
    return;
  }

  console.log(`取得モデル数: ${ids.length}`);
  for (const id of ids) {
    console.log(id);
  }
}

main().catch(err => {
  // エラーは要点だけ表示（機密は出さない）
  const message = err instanceof Error ? err.message : String(err);
  console.error('モデル一覧の取得に失敗しました:', message);
  process.exitCode = 1;
});
