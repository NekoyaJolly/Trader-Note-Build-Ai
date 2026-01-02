/**
 * Phase 2: ノート承認フローのテスト
 * 
 * テスト対象:
 * - TradeNoteService の承認/非承認/編集メソッド
 * - ステータス遷移の正当性
 * - マッチングサービスの承認済みフィルタリング
 */

import { TradeNoteService, NoteUpdatePayload } from '../../services/tradeNoteService';
import { TradeNote, NoteStatus } from '../../models/types';
import { MatchingService } from '../../services/matchingService';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// テスト用のノートディレクトリ
const TEST_NOTES_DIR = path.join(process.cwd(), 'data/notes');

/**
 * テスト用ノートを作成するヘルパー関数
 */
function createTestNote(overrides: Partial<TradeNote> = {}): TradeNote {
  const id = uuidv4();
  return {
    id,
    tradeId: `trade-${id}`,
    timestamp: new Date(),
    symbol: 'BTC/USD',
    side: 'buy',
    entryPrice: 50000,
    quantity: 0.1,
    marketContext: {
      timeframe: '15m',
      trend: 'bullish',
      indicators: { rsi: 55, macd: 0.5, volume: 1000000 },
    },
    aiSummary: 'テスト用のAI要約です。',
    features: [50000, 0.1, 55, 0.5, 1000000, 1, 1],
    createdAt: new Date(),
    status: 'draft',
    ...overrides,
  };
}

describe('TradeNoteService - 承認フロー', () => {
  let noteService: TradeNoteService;
  let testNoteIds: string[] = [];

  beforeEach(() => {
    // Phase 8: テストではFSモードを使用（レガシー互換性テスト）
    noteService = new TradeNoteService('fs');
    testNoteIds = [];
  });

  afterEach(async () => {
    // テストで作成したノートを削除
    for (const noteId of testNoteIds) {
      const filepath = path.join(TEST_NOTES_DIR, `${noteId}.json`);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    }
  });

  describe('approveNote', () => {
    it('draft ノートを承認できる', async () => {
      // 準備: draft ノートを作成
      const note = createTestNote({ status: 'draft' });
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.approveNote(note.id);

      // 検証
      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeDefined();
      expect(result.archivedAt).toBeUndefined();
    });

    it('rejected ノートを承認できる（後戻り可能）', async () => {
      // 準備: rejected ノートを作成
      const note = createTestNote({ status: 'archived', archivedAt: new Date() });
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.approveNote(note.id);

      // 検証
      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeDefined();
      // archivedAt は削除される
      expect(result.archivedAt).toBeUndefined();
    });

    it('既に approved のノートは何も変更しない', async () => {
      // 準備
      const activatedAt = new Date('2024-01-01');
      const note = createTestNote({ status: 'active', activatedAt });
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.approveNote(note.id);

      // 検証: activatedAt は更新されない
      expect(result.status).toBe('active');
      expect(new Date(result.activatedAt!).getTime()).toBe(activatedAt.getTime());
    });

    it('存在しないノートは例外を投げる', async () => {
      await expect(noteService.approveNote('non-existent-id'))
        .rejects.toThrow('ノートが見つかりませんでした');
    });
  });

  describe('rejectNote', () => {
    it('draft ノートを非承認にできる', async () => {
      // 準備
      const note = createTestNote({ status: 'draft' });
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.rejectNote(note.id);

      // 検証
      expect(result.status).toBe('archived');
      expect(result.archivedAt).toBeDefined();
    });

    it('approved ノートを非承認にできる', async () => {
      // 準備
      const note = createTestNote({ status: 'active', activatedAt: new Date() });
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.rejectNote(note.id);

      // 検証
      expect(result.status).toBe('archived');
      expect(result.archivedAt).toBeDefined();
      // activatedAt は履歴として保持
      expect(result.activatedAt).toBeDefined();
    });
  });

  describe('revertToDraft', () => {
    it('approved ノートを draft に戻せる', async () => {
      // 準備
      const note = createTestNote({ status: 'active', activatedAt: new Date() });
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.revertToDraft(note.id);

      // 検証
      expect(result.status).toBe('draft');
      // 履歴として activatedAt は保持
      expect(result.activatedAt).toBeDefined();
    });

    it('rejected ノートを draft に戻せる', async () => {
      // 準備
      const note = createTestNote({ status: 'archived', archivedAt: new Date() });
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.revertToDraft(note.id);

      // 検証
      expect(result.status).toBe('draft');
    });
  });

  describe('updateNote', () => {
    it('AI 要約を更新できる', async () => {
      // 準備
      const note = createTestNote();
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.updateNote(note.id, {
        aiSummary: '更新されたAI要約',
      });

      // 検証
      expect(result.aiSummary).toBe('更新されたAI要約');
      expect(result.lastEditedAt).toBeDefined();
    });

    it('ユーザーメモを追加できる', async () => {
      // 準備
      const note = createTestNote();
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.updateNote(note.id, {
        userNotes: 'ユーザーによる追記メモ',
      });

      // 検証
      expect(result.userNotes).toBe('ユーザーによる追記メモ');
    });

    it('タグを設定できる', async () => {
      // 準備
      const note = createTestNote();
      await noteService.saveNote(note);
      testNoteIds.push(note.id);

      // 実行
      const result = await noteService.updateNote(note.id, {
        tags: ['レンジ相場', 'RSI反転', 'ブレイクアウト'],
      });

      // 検証
      expect(result.tags).toEqual(['レンジ相場', 'RSI反転', 'ブレイクアウト']);
    });
  });

  describe('loadActiveNotes', () => {
    it('承認済みノートのみを返す', async () => {
      // 準備: 各ステータスのノートを作成
      const draftNote = createTestNote({ status: 'draft' });
      const approvedNote = createTestNote({ status: 'active', activatedAt: new Date() });
      const rejectedNote = createTestNote({ status: 'archived', archivedAt: new Date() });

      await noteService.saveNote(draftNote);
      await noteService.saveNote(approvedNote);
      await noteService.saveNote(rejectedNote);

      testNoteIds.push(draftNote.id, approvedNote.id, rejectedNote.id);

      // 実行
      const result = await noteService.loadActiveNotes();

      // 検証
      const resultIds = result.map((n) => n.id);
      expect(resultIds).toContain(approvedNote.id);
      expect(resultIds).not.toContain(draftNote.id);
      expect(resultIds).not.toContain(rejectedNote.id);
    });
  });

  describe('loadNotesByStatus', () => {
    it('指定ステータスのノートのみを返す', async () => {
      // 準備
      const draftNote = createTestNote({ status: 'draft' });
      const approvedNote = createTestNote({ status: 'active', activatedAt: new Date() });

      await noteService.saveNote(draftNote);
      await noteService.saveNote(approvedNote);

      testNoteIds.push(draftNote.id, approvedNote.id);

      // 実行 & 検証
      const drafts = await noteService.loadNotesByStatus('draft');
      const approved = await noteService.loadNotesByStatus('active');

      expect(drafts.map((n) => n.id)).toContain(draftNote.id);
      expect(approved.map((n) => n.id)).toContain(approvedNote.id);
    });
  });

  describe('getStatusCounts', () => {
    it('ステータス別の件数を正しく集計する', async () => {
      // 準備: 既存ノートの件数を取得
      const initialCounts = await noteService.getStatusCounts();

      // 新規ノートを追加
      const draftNote1 = createTestNote({ status: 'draft' });
      const draftNote2 = createTestNote({ status: 'draft' });
      const approvedNote = createTestNote({ status: 'active', activatedAt: new Date() });
      const rejectedNote = createTestNote({ status: 'archived', archivedAt: new Date() });

      await noteService.saveNote(draftNote1);
      await noteService.saveNote(draftNote2);
      await noteService.saveNote(approvedNote);
      await noteService.saveNote(rejectedNote);

      testNoteIds.push(draftNote1.id, draftNote2.id, approvedNote.id, rejectedNote.id);

      // 実行
      const result = await noteService.getStatusCounts();

      // 検証: 追加分のカウント
      expect(result.draft).toBe(initialCounts.draft + 2);
      expect(result.active).toBe(initialCounts.active + 1);
      expect(result.archived).toBe(initialCounts.archived + 1);
      expect(result.total).toBe(initialCounts.total + 4);
    });
  });
});

describe('MatchingService - 承認済みフィルタ', () => {
  let noteService: TradeNoteService;
  let testNoteIds: string[] = [];

  beforeEach(() => {
    // Phase 8: テストではFSモードを使用（レガシー互換性テスト）
    noteService = new TradeNoteService('fs');
    testNoteIds = [];
  });

  afterEach(async () => {
    // テストで作成したノートを削除
    for (const noteId of testNoteIds) {
      const filepath = path.join(TEST_NOTES_DIR, `${noteId}.json`);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    }
  });

  it('loadActiveNotes は draft ノートを除外する', async () => {
    // 準備
    const draftNote = createTestNote({ status: 'draft' });
    await noteService.saveNote(draftNote);
    testNoteIds.push(draftNote.id);

    // 実行
    const approvedNotes = await noteService.loadActiveNotes();

    // 検証
    const ids = approvedNotes.map((n) => n.id);
    expect(ids).not.toContain(draftNote.id);
  });

  it('loadActiveNotes は rejected ノートを除外する', async () => {
    // 準備
    const rejectedNote = createTestNote({ status: 'archived', archivedAt: new Date() });
    await noteService.saveNote(rejectedNote);
    testNoteIds.push(rejectedNote.id);

    // 実行
    const approvedNotes = await noteService.loadActiveNotes();

    // 検証
    const ids = approvedNotes.map((n) => n.id);
    expect(ids).not.toContain(rejectedNote.id);
  });
});
