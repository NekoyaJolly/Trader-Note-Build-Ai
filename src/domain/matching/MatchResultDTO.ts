// MatchResultDTO: Prisma 非依存のマッチ結果 DTO
// Layer1/2 のファイル保存を前提とし、通知判定や UI 表示で利用する
export interface MatchResultDTO {
  id: string;
  matchScore: number;
  historicalNoteId: string;
  marketSnapshot: unknown;
  evaluatedAt: Date;
}
