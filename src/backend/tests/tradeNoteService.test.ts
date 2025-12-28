/**
 * TradeNoteService の基本テスト
 *
 * 目的:
 * - トレードノートが生成できること（AI キー無し時はフォールバック要約）
 * - ファイル保存と読み込みが機能すること
 * - 日付フィールドが Date に復元されること
 *
 * 前提:
 * - data/notes 配下に JSON を保存する（config.paths.notes）
 * - 外部 API は呼ばず、AI はフォールバック要約を使用
 */
import fs from 'fs';
import path from 'path';

// 日本語コメント: uuid は ESM のため、Jest( ts-jest ) では直接読み込むと失敗する場合がある。
// テストでは uuid.v4 をシンプルにモックして回避する。
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));

import { TradeNoteService } from '../../services/tradeNoteService';
import { Trade } from '../../models/types';
import { config } from '../../config';

describe('TradeNoteService', () => {
  const service = new TradeNoteService();
  const notesDir = path.join(process.cwd(), config.paths.notes);
  const createdFiles: string[] = [];

  // 後片付け: テストで作成したノートファイルを削除する
  afterAll(() => {
    for (const file of createdFiles) {
      try {
        fs.unlinkSync(file);
      } catch (_) {
        // 既に削除済みでも無視
      }
    }
  });

  test('generateNote は要約と特徴量を含むノートを生成する', async () => {
    // 日本語コメント: シンプルなテスト用トレードデータを用意
    const trade: Trade = {
      id: 'trade-test-1',
      timestamp: new Date('2024-12-01T12:00:00.000Z'),
      symbol: 'BTCUSD',
      side: 'buy',
      price: 50000,
      quantity: 0.01,
    };

    // 市場コンテキストは省略（extractFeatures はデフォルト値を使用）
    const note = await service.generateNote(trade);

    expect(note).toBeTruthy();
    expect(note.id).toBeDefined();
    expect(note.tradeId).toBe(trade.id);
    expect(note.aiSummary).toBeTruthy(); // フォールバックでも非空文字列を期待
    expect(Array.isArray(note.features)).toBe(true);
    // 日本語コメント: 現状の特徴量は 7 要素（価格, 数量, RSI, MACD, 出来高, トレンド, サイド）
    expect(note.features.length).toBe(7);
    expect(note.createdAt instanceof Date).toBe(true);
  });

  test('saveNote と loadAllNotes / getNoteById が正しく動作する', async () => {
    const trade: Trade = {
      id: 'trade-test-2',
      timestamp: new Date('2024-12-02T09:30:00.000Z'),
      symbol: 'ETHUSD',
      side: 'sell',
      price: 2500,
      quantity: 0.5,
    };

    const note = await service.generateNote(trade, {
      // 日本語コメント: extractFeatures にのみ利用される簡易コンテキスト
      indicators: { rsi: 42, macd: -0.5, volume: 1000 },
      trend: 'bearish',
    });

    await service.saveNote(note);

    // 保存ファイルのパスを控えて後で削除
    const savedPath = path.join(notesDir, `${note.id}.json`);
    createdFiles.push(savedPath);
    expect(fs.existsSync(savedPath)).toBe(true);

    // 読み込み: すべて取得して当該ノートを特定
    const all = await service.loadAllNotes();
    const found = all.find((n) => n.id === note.id);
    expect(found).toBeTruthy();
    expect(found!.symbol).toBe('ETHUSD');
    // 日本語コメント: 日付の復元（string -> Date）を検証
    expect(found!.timestamp instanceof Date).toBe(true);
    expect(found!.createdAt instanceof Date).toBe(true);

    // 単体取得: getNoteById でも同様に取得可能
    const byId = await service.getNoteById(note.id);
    expect(byId).not.toBeNull();
    expect(byId!.id).toBe(note.id);
    expect(byId!.timestamp instanceof Date).toBe(true);
    expect(byId!.createdAt instanceof Date).toBe(true);
  });
});
