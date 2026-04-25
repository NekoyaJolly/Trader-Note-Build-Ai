import { splitDateRange } from '../../utils/dateRangeChunks';

describe('splitDateRange', () => {
  it('指定max幅で期間を分割する', () => {
    const chunks = splitDateRange(new Date(0), new Date(10_000), 4_000);
    expect(chunks.map(c => [c.start.getTime(), c.end.getTime()])).toEqual([
      [0, 4_000],
      [4_000, 8_000],
      [8_000, 10_000],
    ]);
  });

  it('end <= start は空配列', () => {
    expect(splitDateRange(new Date(10), new Date(10), 1000)).toEqual([]);
  });
});
